# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""macOS Apple Silicon (0.1.0): repackaging of the upstream application.

The native macOS shell of upstream (Objective-C, desktop-apps/macos) can only be
compiled with Xcode and the Apple SDK. AuxiNux Office 0.1.0 therefore starts from the
pinned upstream application (ONLYOFFICE-arm.dmg, SHA-256 in upstream.lock.json) and
replaces, without recompiling anything:

  - the start page and the editors' interface (built from the patched sources, as for
    Linux and Windows) and the privacy-unfriendly plugins;
  - the identity: Info.plist, names in every localization (.strings), icons of the
    application and of the document types, legal files;
  - Sparkle automatic updates (disabled) and the online help URL (removed).

The bundle is then re-signed (ad hoc by default, rcodesign) and packed into
dist/macos/AuxiNuxOffice-<version>-arm64.zip. Limitations: docs/MACOS.md."""

import json
import os
import plistlib
import re
import shutil
import stat
import struct
import zipfile
from pathlib import Path

from .common import (BUILD_DIR, DIST_DIR, ROOT, TOOLCHAINS_DIR, download, extract_tar, fail, info, lock, ok,
                     product, rmtree, run, step, version, warn, which, write_text)

GEN = ROOT / "branding" / "generated"
APP_NAME = "AuxiNux Office"
JS = BUILD_DIR / "js"

# Types de documents d'upstream (Resources/file-<ext>.icns) -> icône AuxiNux du type
FILE_ICON_KIND = {
    "mime-document": "doc docx docxf dotx epub fb2 fodt htm html hwp hwpx mht odt oform ott pages rtf vsdx",
    "mime-spreadsheet": "csv fods numbers ods ots xls xlsb xlsm xlsx xltx",
    "mime-presentation": "key odp otp pot potx pps ppsx ppt pptm pptx",
    "mime-pdf": "djvu oxps pdf xps",
    "mime-text": "txt xml",
}
# Noms de produits ONLYOFFICE à conserver (services en ligne, pas l'application)
_UPSTREAM_SERVICES = r"(?!\s?(?:Docs|DocSpace|Workspace|Cloud|Personal|Groups|Mail)\b)"


def stage_app():
    return BUILD_DIR / "stage" / "macos" / f"{APP_NAME}.app"


# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------

def seven_zip():
    """7-Zip (lecture des DMG et volumes HFS+) : système, sinon paquet Debian extrait localement."""
    for name in ("7zz", "7z"):
        if which(name):
            return which(name)
    from .toolchain import TOOLS_ROOT, local_tool_env
    local_tool_env(["7z"])
    exe = TOOLS_ROOT / "usr" / "lib" / "7zip" / "7z"
    if not exe.exists():
        fail("7-Zip introuvable : installer le paquet 7zip (Debian/Ubuntu) ou relancer avec --local-deps")
    return exe


def extract_dmg(archive, dest):
    """Extrait le contenu du volume HFS+ d'une image DMG (liens symboliques conservés)."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    run([seven_zip(), "x", "-snl", "-y", f"-o{dest}", archive], quiet=True, log_file=dest.parent / "dmg-extract.log")


def rcodesign():
    spec = lock()["toolchains"]["rcodesign"]
    home = TOOLCHAINS_DIR / f"rcodesign-{spec['version']}"
    found = list(home.rglob("rcodesign")) if home.exists() else []
    if found:
        return found[0]
    archive = download(spec["url"], TOOLCHAINS_DIR / "downloads" / spec["url"].rsplit("/", 1)[-1],
                       sha256=spec["sha256"])
    extract_tar(archive, home)
    found = [f for f in home.rglob("rcodesign") if f.is_file()]
    if not found:
        fail("rcodesign introuvable dans l'archive")
    found[0].chmod(0o755)
    return found[0]


# ---------------------------------------------------------------------------
# Identité
# ---------------------------------------------------------------------------

def rebrand_text(text):
    text = text.replace("ONLYOFFICE Desktop Editors", APP_NAME)
    return re.sub(r"ONLYOFFICE" + _UPSTREAM_SERVICES, APP_NAME, text)


_STRINGS_PAIR = re.compile(r'("(?:[^"\\]|\\.)*")(\s*=\s*)"((?:[^"\\]|\\.)*)"')


def _read_strings(path):
    data = path.read_bytes()
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16"), "utf-16"
    return data.decode("utf-8-sig"), "utf-8"


def rebrand_strings_file(path):
    """Remplace le nom du produit dans les valeurs (jamais dans les clés) d'un fichier .strings."""
    text, enc = _read_strings(path)
    new = _STRINGS_PAIR.sub(lambda m: m.group(1) + m.group(2) + '"' + rebrand_text(m.group(3)) + '"', text)
    if new != text:
        path.write_bytes(new.encode(enc))
        return True
    return False


_STORYBOARD_COMMENT = re.compile(r'/\* Class = "[^"]+"; (\w+) = "((?:[^"\\]|\\.)*)"; ObjectID = "([^"]+)"; \*/')


def english_storyboard_overrides(resources):
    """Les menus anglais viennent des storyboards compilés de Base.lproj : on crée
    en.lproj/<storyboard>.strings pour leurs textes contenant le nom d'upstream (les
    commentaires des traductions françaises donnent le texte de base et l'identifiant)."""
    count = 0
    for fr in sorted((resources / "fr.lproj").glob("*.strings")):
        if not (resources / "Base.lproj" / (fr.stem + ".storyboardc")).exists():
            continue
        text, _ = _read_strings(fr)
        lines = []
        for prop, base, oid in _STORYBOARD_COMMENT.findall(text):
            if "ONLYOFFICE" in base:
                lines.append(f'"{oid}.{prop}" = "{rebrand_text(base)}";')
        if lines:
            target = resources / "en.lproj" / fr.name
            target.parent.mkdir(exist_ok=True)
            existing = target.read_text(encoding="utf-8") if target.exists() else ""
            write_text(target, existing + "\n".join(lines) + "\n")
            count += len(lines)
    return count


def write_icns(pngs, dest):
    """Fichier .icns (PNG intégrés) : pngs = {taille en pixels: chemin PNG}."""
    types = [("icp4", 16), ("ic11", 32), ("icp5", 32), ("ic12", 64), ("ic07", 128), ("ic13", 256),
             ("ic08", 256), ("ic14", 512), ("ic09", 512)]
    chunks = b""
    for code, size in types:
        if size in pngs:
            data = Path(pngs[size]).read_bytes()
            chunks += code.encode() + struct.pack(">I", len(data) + 8) + data
    Path(dest).write_bytes(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def _icon_pngs(name):
    return {s: GEN / "png" / f"{s}x{s}" / f"{name}.png" for s in (16, 32, 64, 128, 256, 512)
            if (GEN / "png" / f"{s}x{s}" / f"{name}.png").exists()}


def brand_info_plist(contents, p):
    path = contents / "Info.plist"
    with open(path, "rb") as fh:
        plist = plistlib.load(fh)
    prod = p["product"]
    plist.update({
        "CFBundleName": APP_NAME,
        "CFBundleDisplayName": APP_NAME,
        "CFBundleIdentifier": p["linux"]["app_id"],
        "CFBundleExecutable": APP_NAME,
        "CFBundleShortVersionString": version(),
        "CFBundleVersion": version(),
        "CFBundleIconFile": "AppIcon",
        "NSHumanReadableCopyright": f"© {prod['copyright_first_year']} {prod['copyright_holder']} — AGPL-3.0. "
                                    f"Basé sur ONLYOFFICE (Ascensio System SIA) ; projet indépendant.",
        # Sparkle : aucune vérification ni installation automatique de mise à jour
        "SUEnableAutomaticChecks": False,
        "SUAutomaticallyUpdate": False,
        "SUAllowsAutomaticUpdates": False,
        "CFBundleURLTypes": [{"CFBundleTypeRole": "Editor",
                              "CFBundleURLSchemes": [p["windows"]["url_protocol"]]}],
    })
    for key in ("CFBundleIconName", "SUFeedURL", "SUPublicEDKey", "SUScheduledCheckInterval", "ASCWebappsHelpUrl"):
        plist.pop(key, None)
    for key, value in list(plist.items()):
        if key.endswith("UsageDescription") and isinstance(value, str):
            plist[key] = rebrand_text(value)
    # Types de documents : AuxiNux Office se propose sans revendiquer le rôle par défaut
    for doc in plist.get("CFBundleDocumentTypes", []):
        doc["LSHandlerRank"] = "Alternate"
    with open(path, "wb") as fh:
        plistlib.dump(plist, fh, fmt=plistlib.FMT_XML)
    return plist


def brand_bundle(app, p):
    contents = app / "Contents"
    resources = contents / "Resources"
    # Exécutable principal au nom du produit
    old_exe = contents / "MacOS" / "ONLYOFFICE"
    if not old_exe.exists():
        fail(f"exécutable d'upstream introuvable : {old_exe}")
    old_exe.rename(contents / "MacOS" / APP_NAME)
    brand_info_plist(contents, p)
    changed = [f for f in resources.glob("*.lproj/*.strings") if rebrand_strings_file(f)]
    overrides = english_storyboard_overrides(resources)
    info(f"textes : {len(changed)} fichiers .strings, {overrides} titres de menus anglais")
    # Icônes : application, types de documents ; images de l'onglet d'accueil (essai : elles
    # ne s'appliquent que si macOS les préfère au catalogue Assets.car compilé)
    write_icns(_icon_pngs("auxioffice"), resources / "AppIcon.icns")
    for kind, exts in FILE_ICON_KIND.items():
        pngs = _icon_pngs(kind)
        for ext in exts.split():
            target = resources / f"file-{ext}.icns"
            if target.exists():
                write_icns(pngs, target)
    for name, logo in (("logo-tab-dark", "shell-logo-light"), ("logo-tab-light", "shell-logo-dark")):
        shutil.copy2(GEN / "png" / f"{logo}.png", resources / f"{name}.png")
        shutil.copy2(GEN / "png" / f"{logo}@2x.png", resources / f"{name}@2x.png")


# ---------------------------------------------------------------------------
# Étapes
# ---------------------------------------------------------------------------

def assemble(args):
    from .assemble import _copy_engine
    from .fetch import engine_dir
    from .legal import install_legal_files
    step("Assemblage de l'application macOS (Apple Silicon)")
    eng = engine_dir("macos")
    if not (eng / "Contents" / "Info.plist").exists():
        fail("application macOS d'upstream absente : lancer l'étape fetch (cible macos)")
    app = stage_app()
    rmtree(app.parent)
    app.parent.mkdir(parents=True)
    _copy_engine(eng, app)
    resources = app / "Contents" / "Resources"

    startpage, webapps = JS / "startpage", JS / "web-apps"
    for f in (startpage / "index.html", startpage / "noconnect.html", webapps / "apps"):
        if not f.exists():
            fail(f"sortie JS manquante : {f} (étape build)")
    shutil.copy2(startpage / "index.html", resources / "login" / "index.html")
    shutil.copy2(startpage / "noconnect.html", resources / "login" / "noconnect.html")
    rmtree(resources / "editors" / "web-apps")
    shutil.copytree(webapps, resources / "editors" / "web-apps", symlinks=True)
    for guid, label in product().get("privacy", {}).get("removed_plugins", {}).items():
        plugin = resources / "editors" / "sdkjs-plugins" / guid
        if plugin.exists():
            rmtree(plugin)
            info(f"plugin retiré (confidentialité) : {label}")

    brand_bundle(app, product())
    # Mentions légales : à côté de la page d'accueil (liens relatifs de l'écran À propos)
    install_legal_files(resources, "macos")
    write_text(resources / "license" / "README.txt",
               "LICENSE.html : licence du programme d'origine (ONLYOFFICE).\n"
               "Mentions d'AuxiNux Office : ../LICENSE.txt, ../NOTICE.txt, ../licenses/index.html\n")
    sign(app, args)
    total = sum(f.stat().st_size for f in app.rglob("*") if f.is_file() and not f.is_symlink())
    ok(f"application macOS : {app} ({total // (1024 * 1024)} Mio)")


def sign(app, args):
    """Signature ad hoc (ou Developer ID si AUXI_MACOS_P12 / AUXI_MACOS_P12_PASSWORD sont définis)."""
    exe = rcodesign()
    cmd = [exe, "sign"]
    p12 = os.environ.get("AUXI_MACOS_P12")
    if p12:
        cmd += ["--p12-file", p12, "--p12-password-file", os.environ.get("AUXI_MACOS_P12_PASSWORD_FILE", ""),
                "--code-signature-flags", "runtime", "--for-notarization"]
        info("signature Developer ID (AUXI_MACOS_P12)")
    else:
        warn("signature ad hoc : macOS demandera une confirmation au premier lancement (voir docs/MACOS.md)")
    run([*cmd, app], log_file=BUILD_DIR / "stage" / "macos" / "rcodesign.log")
    good, detail = signature_check(app)
    if not good:
        fail(f"signature inattendue : {detail}")
    ok(f"bundle signé ({detail})")


def signature_check(app):
    """Signature du binaire principal : identifiant AuxiNux, ad hoc ou certificat (CMS)."""
    res = run([rcodesign(), "print-signature-info", app / "Contents" / "MacOS" / APP_NAME],
              check=False, capture=True, quiet=True)
    out = res.stdout
    ident = re.search(r"identifier: (\S+)", out)
    flags = re.search(r"flags: CodeSignatureFlags\(([^)]*)\)", out)
    kind = "ad hoc" if flags and "ADHOC" in flags.group(1) else ("certificat" if "cms: null" not in out else "?")
    good = res.returncode == 0 and ident and ident.group(1) == product()["linux"]["app_id"] and kind != "?"
    return good, f"{ident.group(1) if ident else '?'}, {kind}, {flags.group(1) if flags else '?'}"


def _zip_bundle(app, dest):
    """Archive .zip conservant liens symboliques et droits d'exécution (comme ditto -c -k)."""
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted([app, *app.rglob("*")]):
            rel = path.relative_to(app.parent).as_posix()
            st = os.lstat(path)
            if path.is_symlink():
                zi = zipfile.ZipInfo(rel)
                zi.create_system = 3
                zi.external_attr = (stat.S_IFLNK | 0o755) << 16
                z.writestr(zi, os.readlink(path))
            elif path.is_dir():
                zi = zipfile.ZipInfo(rel + "/")
                zi.create_system = 3
                zi.external_attr = (stat.S_IFDIR | 0o755) << 16 | 0x10
                z.writestr(zi, b"")
            else:
                zi = zipfile.ZipInfo(rel)
                zi.create_system = 3
                zi.external_attr = (stat.S_IFREG | (st.st_mode & 0o777)) << 16
                zi.compress_type = zipfile.ZIP_DEFLATED
                with open(path, "rb") as fh:
                    z.writestr(zi, fh.read())


def package(args):
    import hashlib
    from . import update_info
    app = stage_app()
    if not (app / "Contents" / "MacOS" / APP_NAME).exists():
        fail(f"{app} absent : lancer l'étape assemble (cible macos)")
    step("Archive macOS")
    dist = DIST_DIR / "macos"
    dist.mkdir(parents=True, exist_ok=True)
    out = dist / f"AuxiNuxOffice-{version()}-arm64.zip"
    if out.exists():
        out.unlink()
    _zip_bundle(app, out)
    ok(f"{out} ({out.stat().st_size // (1024 * 1024)} Mio)")
    update_info.write("macos", [f for f in dist.iterdir() if f.is_file()], arch="arm64")
    lines = []
    for f in sorted(dist.glob("*")):
        if f.is_file() and f.name != "SHA256SUMS":
            h = hashlib.sha256(f.read_bytes()).hexdigest()
            lines.append(f"{h}  {f.name}")
    write_text(dist / "SHA256SUMS", "\n".join(lines) + "\n")
    ok(f"sommes de contrôle : {dist / 'SHA256SUMS'}")


def test_static(r, stage_app_dir):
    """Contrôles de l'application macOS (les tests fonctionnels se font sur un Mac)."""
    contents = stage_app_dir / "Contents"
    with open(contents / "Info.plist", "rb") as fh:
        plist = plistlib.load(fh)
    p = product()
    r.add("Info.plist : identité AuxiNux", plist.get("CFBundleName") == APP_NAME
          and plist.get("CFBundleIdentifier") == p["linux"]["app_id"]
          and plist.get("CFBundleShortVersionString") == version(),
          f"{plist.get('CFBundleName')} {plist.get('CFBundleIdentifier')} {plist.get('CFBundleShortVersionString')}")
    r.add("mises à jour Sparkle désactivées", "SUFeedURL" not in plist and plist.get("SUEnableAutomaticChecks") is False)
    r.add("exécutable principal", (contents / "MacOS" / plist.get("CFBundleExecutable", "")).is_file())
    leftovers = []
    for f in (contents / "Resources").glob("*.lproj/*.strings"):
        text, _ = _read_strings(f)
        for m in _STRINGS_PAIR.finditer(text):
            if re.search(r"ONLYOFFICE" + _UPSTREAM_SERVICES, m.group(3)):
                leftovers.append(f"{f.parent.name}/{f.name}")
                break
    r.add("textes de l'interface : nom AuxiNux", not leftovers, ", ".join(leftovers[:4]) or "aucun « ONLYOFFICE »")
    good, detail = signature_check(stage_app_dir)
    r.add("signature du bundle", good, detail)
    r.add("tests fonctionnels macOS", False, "à exécuter sur un Mac Apple Silicon (docs/MACOS.md)", skipped=True)
