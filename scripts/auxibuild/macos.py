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
  - Sparkle automatic updates (disabled) and the online help URL (removed);
  - privacy: the bundle executable becomes a small AuxiNux launcher that starts the upstream
    shell ("AuxiNux Office Engine") with the Chromium privacy switches; x2t is replaced by the
    AuxiNux guard (no download of a document's remote resources); the dormant Google Analytics
    address of the shell is removed; web layers hardened (privacy.py).

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

from .common import (BUILD_DIR, copyright_notice, DIST_DIR, IS_MACOS_HOST, ROOT, TOOLCHAINS_DIR, download, extract_tar, fail, info, lock, ok,
                     product, rmtree, run, step, version, warn, which, write_text)

GEN = ROOT / "branding" / "generated"
APP_NAME = "AuxiNux Office"
# Shell d'upstream renommé : l'exécutable du bundle (APP_NAME) est le lanceur AuxiNux qui
# l'exécute avec les commutateurs de confidentialité du moteur web.
ENGINE_NAME = "AuxiNux Office Engine"
HELPERS_DIR = BUILD_DIR / "native" / "macos" / "helpers"
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


# Dossier du bundle sans espace : le shell d'upstream construit certaines adresses de fichiers
# par NSURLComponents à partir du chemin (menu Aide > Remerciements, Accord de licence), ce qui
# échoue si le chemin contient une espace. Le Finder et le Dock affichent quand même
# « AuxiNux Office » (CFBundleDisplayName localisé, LSHasLocalizedDisplayName).
BUNDLE_DIR = "AuxiNuxOffice.app"


def stage_app():
    return BUILD_DIR / "stage" / "macos" / BUNDLE_DIR


# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------

def seven_zip():
    """7-Zip (lecture des DMG et volumes HFS+, sans montage) : système, Homebrew sur Mac
    (brew install sevenzip, installé par build.sh), sinon paquet Debian extrait localement."""
    for name in ("7zz", "7z"):
        if which(name):
            return which(name)
    if IS_MACOS_HOST:
        fail("7-Zip introuvable : brew install sevenzip (installé par ./build.sh)")
    from .toolchain import TOOLS_ROOT, local_tool_env
    local_tool_env(["7z"])
    exe = TOOLS_ROOT / "usr" / "lib" / "7zip" / "7z"
    if not exe.exists():
        fail("7-Zip introuvable : installer le paquet 7zip (Debian/Ubuntu) ou relancer avec --local-deps")
    return exe


def extract_dmg(archive, dest):
    """Extrait le contenu du volume d'une image DMG (liens symboliques conservés) avec 7-Zip,
    sur Mac comme sous Linux : pas de montage (hdiutil peut être refusé par macOS, par exemple
    quand le projet est sur un autre disque que le disque système)."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    rmtree(dest.parent / (dest.name + ".mnt"))   # point de montage laissé par une ancienne version
    run([seven_zip(), "x", "-snl", "-y", f"-o{dest}", archive], quiet=True, log_file=dest.parent / "dmg-extract.log")


def rcodesign():
    spec = lock()["toolchains"]["rcodesign_macos" if IS_MACOS_HOST else "rcodesign"]
    home = TOOLCHAINS_DIR / f"rcodesign-{spec['version']}-{'macos' if IS_MACOS_HOST else 'linux'}"
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


def _set_strings(path, entries):
    """Fixe des valeurs dans un fichier .strings (remplace la valeur si la clé existe, sinon ajoute)."""
    if path.exists():
        text, enc = _read_strings(path)
    else:
        text, enc = "", "utf-16"
    for key, value in entries.items():
        pattern = re.compile(r'^(\s*"' + re.escape(key) + r'"\s*=\s*)"(?:[^"\\]|\\.)*";', re.M)
        line = '"' + value.replace('"', '\\"') + '";'
        if pattern.search(text):
            text = pattern.sub(lambda m: m.group(1) + line, text)
        else:
            text += ("\n" if text and not text.endswith("\n") else "") + f'"{key}" = {line}\n'
    path.write_bytes(text.encode(enc) if enc != "utf-16" else b"\xff\xfe" + text.encode("utf-16-le"))


def localize_about(resources, p):
    """Fenêtre « À propos » native : nom, copyright (pris dans InfoPlist.strings localisé),
    « Community version » remplacé par « Version » ; messages anglais nommant le produit."""
    prod = p["product"]
    # Les mentions d'origine exigées par la licence sont accessibles par « Accord de licence ».
    copyright_fr = f"{copyright_notice()}. Logiciel libre (AGPL v3)."
    copyright_en = f"{copyright_notice()}. Free software (AGPL v3)."

    count = 0
    for lproj in sorted(resources.glob("*.lproj")):
        fr = lproj.name.startswith("fr")
        _set_strings(lproj / "InfoPlist.strings", {
            "CFBundleName": APP_NAME, "CFBundleDisplayName": APP_NAME,
            "NSHumanReadableCopyright": copyright_fr if fr else copyright_en})
        if (lproj / "Localizable.strings").exists() or lproj.name == "en.lproj":
            _set_strings(lproj / "Localizable.strings", {"Community version %@": "Version %@"})
        count += 1
    # Anglais : les clés sources contenant le nom d'upstream s'affichent telles quelles
    keys = {}
    for f in resources.glob("*.lproj/Localizable.strings"):
        text, _ = _read_strings(f)
        for m in _STRINGS_PAIR.finditer(text):
            key = m.group(1)[1:-1]
            if re.search(r"ONLYOFFICE" + _UPSTREAM_SERVICES, key):
                keys[key] = rebrand_text(key)
    if keys:
        _set_strings(resources / "en.lproj" / "Localizable.strings", keys)
    return count


def write_license_html(dest):
    """« Accord de licence » de la fenêtre À propos : licence et mentions d'AuxiNux Office."""
    import html
    from .common import UPSTREAM_SRC
    lic = (UPSTREAM_SRC / "desktop-apps" / "LICENSE").read_text(encoding="utf-8")
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    write_text(dest, "<!DOCTYPE html><html lang=\"fr\"><head><meta charset=\"utf-8\">"
               f"<title>{APP_NAME} — licence</title><style>body{{font:13px -apple-system,sans-serif;"
               "margin:24px;max-width:780px}pre{white-space:pre-wrap;font:12px Menlo,monospace}</style></head><body>"
               f"<h2>{APP_NAME}</h2><pre>{html.escape(notice)}</pre><hr>"
               f"<h3>GNU Affero General Public License v3 + conditions additionnelles</h3>"
               f"<pre>{html.escape(lic)}</pre></body></html>\n")


def hide_catalog_images(car, names):
    """Rend des images du catalogue compilé Assets.car introuvables (nom modifié sur place,
    même longueur, ordre du tri conservé) : macOS charge alors les images du même nom placées
    dans Resources/ (versions AuxiNux)."""
    data = bytearray(car.read_bytes())
    for name in names:
        old = name.encode()
        if data.count(old) != 1:
            fail(f"{car.name} : entrée {name} introuvable ou ambiguë ({data.count(old)})")
        i = data.find(old)
        data[i:i + len(old)] = old[:-1] + b"_"
    car.write_bytes(bytes(data))


# Adresses ONLYOFFICE compilées dans le shell macOS (menu Aide, page produit, inscription)
UPSTREAM_URLS = [
    ("http://helpcenter.onlyoffice.com/%@ONLYOFFICE-Editors/index.aspx", True),
    ("https://onlyoffice.com/desktopeditors.aspx", False),
    ("https://onlyoffice.com/registration.aspx?desktop=true", False),
]


# Adresse de collecte de Google Analytics du shell macOS (CocoaAnalytics, code inactif chez
# upstream) : remplacée par une adresse inerte de même longueur.
UPSTREAM_TRACKERS = ["http://google-analytics.com/collect"]


def compiled_shell():
    from .macos_shell import built_executable
    return built_executable() is not None


def patch_binary_trackers(exe):
    data = bytearray(Path(exe).read_bytes())
    for url in UPSTREAM_TRACKERS:
        old = url.encode() + b"\0"
        if data.count(old) == 0 and compiled_shell():
            continue
        if data.count(old) != 1:
            fail(f"adresse de traçage introuvable ou ambiguë dans le shell macOS : {url}")
        new = ("about:blank#" + "x" * len(url))[:len(url)]
        i = data.find(old)
        data[i:i + len(url)] = new.encode()
    Path(exe).write_bytes(bytes(data))


LIBSYSTEM_TBD = """--- !tapi-tbd
tbd-version:     4
targets:         [ arm64-macos ]
install-name:    '/usr/lib/libSystem.B.dylib'
current-version: 1351
exports:
  - targets:         [ arm64-macos ]
    symbols:         [ ___stderrp, __NSGetExecutablePath, _execv, _fclose, _fopen, _fputs, _fread,
                       _free, _fwrite, _malloc, _memcpy, _strlen, _strncmp, _strrchr, _strstr,
                       dyld_stub_binder ]
...
"""


def build_helpers():
    """Lanceur du bundle et garde x2t, arm64 (macOS 11+). Depuis Linux : clang et ld64.lld de LLVM,
    sans SDK Apple (bibliothèque système décrite par un fichier .tbd minimal). Sur un Mac : clang
    de Xcode."""
    from .build_auxitext import X2T_GUARD_SRC, engine_switches
    out = HELPERS_DIR
    rmtree(out)
    out.mkdir(parents=True)
    sources = {"launcher": (ROOT / "src" / "launcher" / "auxioffice_macos.c",
                            [f'-DAUXI_ENGINE_SWITCHES="{engine_switches()}"', f'-DAUXI_ENGINE_BINARY="{ENGINE_NAME}"']),
               "x2t-guard": (X2T_GUARD_SRC, ["-DAUXI_MACOS_NO_SDK"])}
    common = ["-target", "arm64-apple-macos11", "-O2", "-Wall", "-Wextra", "-Werror", "-ffreestanding",
              "-fno-stack-protector", "-fno-builtin"]
    if IS_MACOS_HOST:
        cc, env, link = ["xcrun", "clang"], None, ["-lSystem"]
    else:
        from .wincross import _llvm_ld_path, find_llvm
        llvm = find_llvm()
        if not llvm or not (llvm / "ld64.lld").exists():
            fail("clang/ld64.lld (LLVM) introuvables : nécessaires pour le lanceur macOS (--local-deps)")
        write_text(out / "libSystem.tbd", LIBSYSTEM_TBD)
        cc, env = [llvm / "clang"], {"LD_LIBRARY_PATH": _llvm_ld_path(llvm)}
        link = ["-nostdlib", "-fuse-ld=lld", "-Wl,-platform_version,macos,11.0,11.0", "-Wl,-fixup_chains",
                f"-L{out}", "-lSystem"]
    for name, (src, defines) in sources.items():
        run([*cc, *common, *defines, src, *link, "-o", out / name], env=env)
    ok(f"lanceur et garde x2t macOS : {out}")
    return out / "launcher", out / "x2t-guard"


def patch_binary_urls(exe, website):
    """Remplace sur place (même longueur, binaire re-signé ensuite) les adresses ONLYOFFICE du
    shell par le site AuxiNux. L'adresse d'aide garde son unique « %@ » (code de langue)."""
    data = bytearray(Path(exe).read_bytes())
    base = website.rstrip("/") + "/"
    for url, has_format in UPSTREAM_URLS:
        old = url.encode() + b"\0"
        if data.count(old) == 0 and compiled_shell():
            info(f"adresse absente du shell compilé : {url}")
            continue
        if data.count(old) != 1:
            fail(f"adresse d'upstream introuvable ou ambiguë dans le shell macOS : {url}")
        new = base + ("?langue=%@" if has_format else "")
        if len(new) > len(url):
            fail(f"adresse AuxiNux trop longue pour remplacer {url}")
        new = new + ("&" if "?" in new else "?") if len(new) < len(url) else new
        new = (new + "x" * len(url))[:len(url)] if len(new) < len(url) else new
        i = data.find(old)
        data[i:i + len(url)] = new.encode()
    Path(exe).write_bytes(bytes(data))


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
        "LSHasLocalizedDisplayName": True,
        "NSHumanReadableCopyright": f"{copyright_notice()}. Logiciel libre (AGPL v3).",
        # Sparkle : aucune vérification ni installation automatique de mise à jour
        "SUEnableAutomaticChecks": False,
        "SUAutomaticallyUpdate": False,
        "SUAllowsAutomaticUpdates": False,
        "CFBundleURLTypes": [{"CFBundleTypeRole": "Editor",
                              "CFBundleURLSchemes": [p["windows"]["url_protocol"]]}],
    })
    # NSAppTransportSecurity : l'exception d'upstream autorise le HTTP non chiffré ; retirée.
    for key in ("CFBundleIconName", "SUFeedURL", "SUPublicEDKey", "SUScheduledCheckInterval", "ASCWebappsHelpUrl",
                "NSAppTransportSecurity"):
        plist.pop(key, None)
    for key, value in list(plist.items()):
        if key.endswith("UsageDescription") and isinstance(value, str):
            plist[key] = rebrand_text(value)
    # Types de documents : AuxiNux Office se propose sans revendiquer le rôle par défaut
    for doc in plist.get("CFBundleDocumentTypes", []):
        doc["LSHandlerRank"] = "Alternate"
        if isinstance(doc.get("CFBundleTypeName"), str):
            doc["CFBundleTypeName"] = rebrand_text(doc["CFBundleTypeName"])
    for key in ("UTExportedTypeDeclarations", "UTImportedTypeDeclarations"):
        for decl in plist.get(key, []):
            if isinstance(decl.get("UTTypeDescription"), str):
                decl["UTTypeDescription"] = rebrand_text(decl["UTTypeDescription"])
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
    engine = contents / "MacOS" / ENGINE_NAME
    from .macos_shell import built_executable
    compiled = built_executable()
    if compiled:
        # Shell compilé depuis les sources patchées (Xcode, macos_shell.py) à la place de celui d'upstream
        shutil.copy2(compiled, old_exe)
        old_exe.chmod(0o755)
        info("shell macOS : exécutable compilé depuis les sources patchées (desktop-apps 0013)")
    else:
        info("shell macOS : exécutable d'upstream (non recompilé)")
    old_exe.rename(engine)
    patch_binary_urls(engine, p["product"]["website"])
    patch_binary_trackers(engine)
    launcher, guard = build_helpers()
    shutil.copy2(launcher, contents / "MacOS" / APP_NAME)
    (contents / "MacOS" / APP_NAME).chmod(0o755)
    converter = resources / "converter"
    (converter / "x2t").rename(converter / "x2t-engine")
    shutil.copy2(guard, converter / "x2t")
    (converter / "x2t").chmod(0o755)
    brand_info_plist(contents, p)
    changed = [f for f in resources.glob("*.lproj/*.strings") if rebrand_strings_file(f)]
    overrides = english_storyboard_overrides(resources)
    localized = localize_about(resources, p)
    info(f"textes : {len(changed)} fichiers .strings, {overrides} titres de menus anglais, "
         f"{localized} langues (À propos)")
    write_license_html(resources / "license" / "LICENSE.html")
    hide_catalog_images(resources / "Assets.car", ("logo-tab-dark", "logo-tab-light"))
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
    from .privacy import harden
    harden(resources / "login" / "index.html", resources / "editors")
    integrate_auxitext(app)
    # Mentions légales : à côté de la page d'accueil (liens relatifs de l'écran À propos)
    install_legal_files(resources, "macos")
    write_text(resources / "license" / "README.txt",
               "LICENSE.html : licence du programme d'origine (ONLYOFFICE).\n"
               "Mentions d'AuxiNux Office : ../LICENSE.txt, ../NOTICE.txt, ../licenses/index.html\n")
    sign(app, args)
    total = sum(f.stat().st_size for f in app.rglob("*") if f.is_file() and not f.is_symlink())
    ok(f"application macOS : {app} ({total // (1024 * 1024)} Mio)")


def integrate_auxitext(app):
    """AuxiText.app (compilé sur un Mac) dans AuxiNuxOffice.app/Contents/Applications/ ;
    la page d'accueil affiche alors la tuile « Nouveau fichier texte » (auxitext://new)."""
    built = BUILD_DIR / "native" / "macos" / "AuxiText.app"
    if not built.exists():
        warn("AuxiText.app absent (non compilé sur un Mac) : pas d'éditeur de texte brut dans ce paquet")
        return False
    dest = app / "Contents" / "Applications" / "AuxiText.app"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(built, dest, symlinks=True)
    home = app / "Contents" / "Resources" / "login" / "index.html"
    text = home.read_text(encoding="utf-8")
    marker = "window.AUXINUX_BRANDING={"
    if text.count(marker) != 1:
        fail(f"page d'accueil : {marker!r} introuvable ou ambigu")
    home.write_text(text.replace(marker, marker + "macTextEditor:!0,"), encoding="utf-8")
    install_text_redirect(app)
    ok("AuxiText intégré (Contents/Applications/AuxiText.app)")
    return True


def install_text_redirect(app):
    """Éditeur de documents : un fichier texte brut ouvert par le shell d'upstream (qui l'envoie à
    AuxiWriter) est renvoyé à AuxiText (src/macos/auxinux-mac-text.js)."""
    from .build_auxitext import text_extensions
    main = app / "Contents" / "Resources" / "editors" / "web-apps" / "apps" / "documenteditor" / "main"
    page = main / "index.html"
    shutil.copy2(ROOT / "src" / "macos" / "auxinux-mac-text.js", main / "auxinux-mac-text.js")
    exts = json.dumps([e for e in text_extensions().split(";") if e])
    tag = (f"<script>window.AUXINUX_TEXT_EXTENSIONS={exts};</script>"
           '<script src="auxinux-mac-text.js"></script>')
    text = page.read_text(encoding="utf-8")
    if "auxinux-mac-text.js" in text:
        return
    if text.count("</head>") != 1:
        fail(f"{page} : balise </head> introuvable ou ambiguë")
    page.write_text(text.replace("</head>", tag + "</head>"), encoding="utf-8")
    info("fichiers texte ouverts dans AuxiWriter : renvoyés à AuxiText")


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
    from .assemble import check_shippable
    check_shippable(app)
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
            value = m.group(3)
            if re.search(r"ONLYOFFICE" + _UPSTREAM_SERVICES, value):
                leftovers.append(f"{f.parent.name}/{f.name}")
                break
    r.add("textes de l'interface : nom AuxiNux", not leftovers, ", ".join(leftovers[:4]) or "aucun « ONLYOFFICE »")
    rights = [f.parent.name for f in (contents / "Resources").glob("*.lproj/InfoPlist.strings")
              if any(m.group(1) == '"NSHumanReadableCopyright"'
                     and not ("AuxiNux" in m.group(3) and "Ascensio System SIA" in m.group(3))
                     for m in _STRINGS_PAIR.finditer(_read_strings(f)[0]))]
    r.add("copyright (Projet AuxiNux et Ascensio System SIA) dans toutes les langues", not rights,
          ", ".join(rights[:4]) or copyright_notice())
    car = (contents / "Resources" / "Assets.car").read_bytes()
    r.add("onglet d'accueil : logo ONLYOFFICE du catalogue neutralisé",
          b"logo-tab-dark" not in car and b"logo-tab-light" not in car
          and (contents / "Resources" / "logo-tab-dark.png").exists())
    exe = (contents / "MacOS" / ENGINE_NAME).read_bytes()
    left = [u for u, _ in UPSTREAM_URLS if u.encode() in exe]
    r.add("shell : adresses ONLYOFFICE remplacées (Aide…)", not left, ", ".join(left) or "site AuxiNux")
    r.add("shell : adresse Google Analytics retirée", not any(u.encode() in exe for u in UPSTREAM_TRACKERS))
    launcher = (contents / "MacOS" / APP_NAME).read_bytes()
    from .build_auxitext import engine_switches
    r.add("lanceur du bundle : commutateurs de confidentialité du moteur web",
          launcher[:4] == b"\xcf\xfa\xed\xfe" and engine_switches().encode() in launcher
          and ENGINE_NAME.encode() in launcher, engine_switches())
    guard = (contents / "Resources" / "converter" / "x2t").read_bytes()
    r.add("convertisseur : garde réseau AuxiNux (x2t -> x2t-engine)",
          b"allowNetworkRequest" in guard and (contents / "Resources" / "converter" / "x2t-engine").is_file())
    r.add("Info.plist : pas d'exception NSAppTransportSecurity", "NSAppTransportSecurity" not in plist)
    r.add("Info.plist sans mention ONLYOFFICE", "ONLYOFFICE" not in str(plist), "")
    text_app = contents / "Applications" / "AuxiText.app"
    if text_app.exists():
        with open(text_app / "Contents" / "Info.plist", "rb") as fh:
            tplist = plistlib.load(fh)
        home = (contents / "Resources" / "login" / "index.html").read_text(encoding="utf-8", errors="ignore")
        r.add("AuxiText intégré (adresse auxitext://, tuile de l'accueil)",
              tplist.get("CFBundleURLTypes", [{}])[0].get("CFBundleURLSchemes") == ["auxitext"]
              and "macTextEditor:!0" in home and (text_app / "Contents" / "MacOS" / "auxitext").exists())
    else:
        r.add("AuxiText", False, "non compilé : construire sur un Mac avec ./build.sh", skipped=True)
    good, detail = signature_check(stage_app_dir)
    r.add("signature du bundle", good, detail)
    r.add("tests fonctionnels macOS", False, "à exécuter sur un Mac Apple Silicon (docs/MACOS.md)", skipped=True)
