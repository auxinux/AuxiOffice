# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Linux packages: auxinux-office_<version>_amd64.deb and AuxiNuxOffice-<version>-x86_64.AppImage,
built from the assembled tree (build/stage/linux/auxioffice)."""

import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .common import (BUILD_DIR, DIST_DIR, ROOT, TOOLCHAINS_DIR, download, fail, info, lock, ok, product,
                     rmtree, run, source_date_epoch, step, version, warn, write_text)
from .assemble import check_shippable, stage_dir

GEN = ROOT / "branding" / "generated"
FILETYPES = json.loads((ROOT / "packaging" / "common" / "filetypes.json").read_text(encoding="utf-8"))
ICON_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512]
APP_ICONS = {"": "auxioffice", ".Writer": "auxiwriter", ".Sheet": "auxisheet", ".Present": "auxipresent",
             ".PDF": "auxipdf", ".Text": "auxitext"}


# ---------------------------------------------------------------------------
# Intégration au bureau (communes au .deb et à l'AppImage)
# ---------------------------------------------------------------------------

def desktop_files(p, exec_cmd):
    app_id = p["linux"]["app_id"]
    apps = p["apps"]
    office_mimes = [m for k in ("writer", "sheet", "present", "pdf") for m in FILETYPES[k]["mime"]]

    def entry(suffix, name, generic_en, generic_fr, comment_en, comment_fr, exec_args, categories, mimes,
              wmclass, keywords, actions=""):
        # Une seule entrée déclare la classe de fenêtre du shell : sinon le bureau (Wayland,
        # barre des tâches) choisit au hasard l'une d'elles pour nommer la fenêtre (« AuxiPresent »).
        wmclass_line = f"StartupWMClass={wmclass}\n" if wmclass else ""
        return f"""[Desktop Entry]
Version=1.0
Type=Application
Name={name}
GenericName={generic_en}
GenericName[fr]={generic_fr}
Comment={comment_en}
Comment[fr]={comment_fr}
Exec={exec_cmd} {exec_args}
Icon={app_id}{suffix}
Terminal=false
StartupNotify=true
{wmclass_line}Categories={categories}
Keywords={keywords}
MimeType={';'.join(mimes)};
{actions}"""

    actions = """Actions=NewDocument;NewSpreadsheet;NewPresentation;NewText;

[Desktop Action NewDocument]
Name=New document
Name[fr]=Nouveau document
Exec={e} --new-document

[Desktop Action NewSpreadsheet]
Name=New spreadsheet
Name[fr]=Nouvelle feuille de calcul
Exec={e} --new-spreadsheet

[Desktop Action NewPresentation]
Name=New presentation
Name[fr]=Nouvelle présentation
Exec={e} --new-presentation

[Desktop Action NewText]
Name=New text file
Name[fr]=Nouveau fichier texte
Exec={e} --new-text
""".format(e=exec_cmd)
    office_class = p["product"]["name"]
    return {
        f"{app_id}.desktop": entry(
            "", p["product"]["name"], "Office Suite", "Suite bureautique",
            "Edit documents, spreadsheets, presentations and PDF files offline",
            "Créez et modifiez documents, feuilles de calcul, présentations et PDF hors ligne",
            "%F", "Office;", office_mimes, office_class,
            "office;document;spreadsheet;presentation;pdf;docx;xlsx;pptx;bureautique;", actions),
        f"{app_id}.Writer.desktop": entry(
            ".Writer", apps["writer"]["name"], "Word Processor", "Traitement de texte",
            "Create and edit text documents (DOCX, ODT, DOC, RTF)",
            "Créez et modifiez des documents texte (DOCX, ODT, DOC, RTF)",
            "--app=writer %F", "Office;WordProcessor;", FILETYPES["writer"]["mime"], "",
            "word;docx;odt;rtf;document;texte;"),
        f"{app_id}.Sheet.desktop": entry(
            ".Sheet", apps["sheet"]["name"], "Spreadsheet", "Tableur",
            "Create and edit spreadsheets (XLSX, ODS, XLS, CSV)",
            "Créez et modifiez des feuilles de calcul (XLSX, ODS, XLS, CSV)",
            "--app=sheet %F", "Office;Spreadsheet;", FILETYPES["sheet"]["mime"], "",
            "excel;xlsx;ods;csv;tableur;calcul;"),
        f"{app_id}.Present.desktop": entry(
            ".Present", apps["present"]["name"], "Presentation", "Présentation",
            "Create and show presentations (PPTX, ODP, PPT)",
            "Créez et projetez des présentations (PPTX, ODP, PPT)",
            "--app=present %F", "Office;Presentation;", FILETYPES["present"]["mime"], "",
            "powerpoint;pptx;odp;diaporama;slides;"),
        f"{app_id}.PDF.desktop": entry(
            ".PDF", apps["pdf"]["name"], "PDF Viewer", "Lecteur PDF",
            "View, search and print PDF documents", "Consultez, recherchez et imprimez des documents PDF",
            "--app=pdf %F", "Office;Viewer;", FILETYPES["pdf"]["mime"], "",
            "pdf;viewer;lecteur;djvu;xps;"),
        f"{app_id}.Text.desktop": entry(
            ".Text", apps["text"]["name"], "Text Editor", "Éditeur de texte",
            "Edit plain text files (TXT, Markdown, JSON, YAML, XML, INI, logs)",
            "Modifiez des fichiers texte brut (TXT, Markdown, JSON, YAML, XML, INI, journaux)",
            "--app=text %F", "Utility;TextEditor;", FILETYPES["text"]["mime"], "AuxiText",
            "text;editor;txt;markdown;json;yaml;texte;éditeur;"),
    }


def metainfo(p):
    app_id = p["linux"]["app_id"]
    prod = p["product"]
    date = __import__("datetime").datetime.fromtimestamp(source_date_epoch(), __import__("datetime").timezone.utc).strftime("%Y-%m-%d")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- Copyright 2026 Projet AuxiNux -->
<component type="desktop-application">
  <id>{app_id}</id>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>AGPL-3.0-only</project_license>
  <name>{prod['name']}</name>
  <summary>Free office suite: documents, spreadsheets, presentations, PDF and plain text</summary>
  <summary xml:lang="fr">Suite bureautique libre : documents, feuilles de calcul, présentations, PDF et texte brut</summary>
  <description>
    <p>AuxiNux Office is the free office suite of the AuxiNux ecosystem. It works offline, without account,
    advertising or telemetry, and is compatible with Microsoft Office formats (DOCX, XLSX, PPTX) and OpenDocument.</p>
    <p xml:lang="fr">AuxiNux Office est la suite bureautique libre de l'écosystème AuxiNux. Elle fonctionne hors ligne,
    sans compte, publicité ni télémétrie, et reste compatible avec les formats Microsoft Office (DOCX, XLSX, PPTX)
    et OpenDocument.</p>
    <p>It includes AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF and AuxiText.</p>
  </description>
  <launchable type="desktop-id">{app_id}.desktop</launchable>
  <url type="homepage">{prod['website']}</url>
  <developer id="ca.auxinux"><name>{prod['vendor']}</name></developer>
  <content_rating type="oars-1.1"/>
  <provides><binary>auxioffice</binary></provides>
  <releases>
    <release version="{version()}" date="{date}"/>
  </releases>
</component>
"""


def install_desktop_integration(root, p, exec_cmd):
    """Fichiers .desktop, icônes hicolor et métadonnées AppStream sous <root>/usr/share."""
    share = root / "usr" / "share"
    app_id = p["linux"]["app_id"]
    for name, content in desktop_files(p, exec_cmd).items():
        write_text(share / "applications" / name, content)
    for suffix, icon in APP_ICONS.items():
        for size in ICON_SIZES:
            dst = share / "icons" / "hicolor" / f"{size}x{size}" / "apps" / f"{app_id}{suffix}.png"
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(GEN / "png" / f"{size}x{size}" / f"{icon}.png", dst)
        dst = share / "icons" / "hicolor" / "scalable" / "apps" / f"{app_id}{suffix}.svg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(GEN / "svg" / f"{icon}.svg", dst)
    write_text(share / "metainfo" / f"{app_id}.metainfo.xml", metainfo(p))


def validate_desktop_files(root, local_deps=False):
    env = {}
    validator = shutil.which("desktop-file-validate")
    if not validator and local_deps:
        from .toolchain import local_tool_env, TOOLS_ROOT
        env = local_tool_env(["desktop-file-validate"])
        validator = str(TOOLS_ROOT / "usr" / "bin" / "desktop-file-validate")
    if not validator or not Path(validator).exists():
        warn("desktop-file-validate absent : validation des fichiers .desktop ignorée")
        return
    for f in sorted((root / "usr" / "share" / "applications").glob("*.desktop")):
        res = run([validator, f], env=env, quiet=True, check=False, capture=True)
        if res.returncode != 0 or res.stdout.strip():
            print(res.stdout + res.stderr)
            fail(f"fichier .desktop invalide : {f.name}")
    ok("fichiers .desktop valides (desktop-file-validate)")


# ---------------------------------------------------------------------------
# .deb
# ---------------------------------------------------------------------------

def _elf_files(tree):
    for f in tree.rglob("*"):
        if f.is_file() and not f.is_symlink():
            with open(f, "rb") as fh:
                if fh.read(4) == b"\x7fELF":
                    yield f


def compute_depends(tree):
    """Dépendances système calculées par dpkg-shlibdeps (les bibliothèques embarquées sont ignorées)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        write_text(tmp / "debian" / "control", "Source: auxinux-office\n\nPackage: auxinux-office\nArchitecture: amd64\n")
        bundled = sorted({str(f.parent) for f in tree.rglob("*.so*")})
        cmd = ["dpkg-shlibdeps", "-O", "--ignore-missing-info", "-xlibc6-dbg"] + [f"-l{d}" for d in bundled]
        binaries = [str(f) for f in _elf_files(tree)]
        res = subprocess.run(cmd + binaries, cwd=tmp, capture_output=True, text=True)
        if res.returncode != 0:
            print(res.stderr[-3000:])
            fail("dpkg-shlibdeps a échoué")
        m = re.search(r"shlibs:Depends=(.*)", res.stdout)
        return m.group(1).strip() if m else ""


def debian_copyright(p):
    prod = p["product"]
    return f"""Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: {prod['name']}
Upstream-Contact: {p['linux']['maintainer']}
Source: {prod['source_url']}
Comment: AuxiNux Office est un projet indépendant basé sur ONLYOFFICE Desktop Editors
 (https://github.com/ONLYOFFICE/DesktopEditors). ONLYOFFICE est une marque d'Ascensio
 System SIA. Mentions complètes : /usr/lib/auxinux-office/NOTICE.txt et
 /usr/lib/auxinux-office/licenses/index.html

Files: *
Copyright: 2026 Projet AuxiNux
           2009-2026 Ascensio System SIA
License: AGPL-3.0-only-with-additional-terms
 Ce programme est distribué sous la GNU Affero General Public License version 3
 avec les conditions additionnelles du programme d'origine (section 7) : voir
 /usr/lib/auxinux-office/LICENSE.txt. Le code propre à AuxiNux est aussi disponible
 sous AGPL-3.0-or-later.

Files: usr/lib/auxinux-office/lib*.so* usr/lib/auxinux-office/converter/*
       usr/lib/auxinux-office/editors/* usr/lib/auxinux-office/fonts/* usr/lib/auxinux-office/dictionaries/*
Copyright: voir /usr/lib/auxinux-office/licenses/
License: various
 Chromium Embedded Framework (BSD-3-Clause), Qt 5 (LGPL-3.0), ICU (Unicode-3.0),
 V8 (BSD-3-Clause), polices (Apache-2.0, OFL-1.1…), dictionnaires (GPL, LGPL, MPL…).
 Le détail figure dans /usr/lib/auxinux-office/licenses/ et dans chaque répertoire.
"""


def build_deb(p):
    step("Paquet .deb")
    stage = stage_dir("linux")
    if not stage.exists():
        fail("arbre d'installation absent : lancer l'étape assemble")
    pkg = p["linux"]["package"]
    work = BUILD_DIR / "package" / "deb" / "root"
    rmtree(work.parent)
    libdir = work / p["linux"]["install_dir"].lstrip("/")
    libdir.parent.mkdir(parents=True)
    shutil.copytree(stage, libdir, symlinks=True)
    write_text(libdir / "converter" / "package.config", "package = deb\n")
    bindir = work / "usr" / "bin"
    bindir.mkdir(parents=True)
    (bindir / "auxioffice").symlink_to(f"../lib/{libdir.name}/auxioffice")
    (bindir / "auxitext").symlink_to(f"../lib/{libdir.name}/auxitext")
    install_desktop_integration(work, p, "auxioffice")
    doc = work / "usr" / "share" / "doc" / pkg
    write_text(doc / "copyright", debian_copyright(p))
    changelog = (f"{pkg} ({version()}) stable; urgency=medium\n\n"
                 f"  * Version {version()} d'AuxiNux Office (voir CHANGELOG.md du dépôt source).\n\n"
                 f" -- {p['linux']['maintainer']}  "
                 f"{__import__('email.utils').utils.formatdate(source_date_epoch())}\n")
    with gzip.GzipFile(doc / "changelog.gz", "wb", mtime=source_date_epoch()) as gz:
        gz.write(changelog.encode("utf-8"))
    validate_desktop_files(work, getattr(p, 'local_deps', False))

    depends = compute_depends(libdir)
    info(f"Depends calculé : {depends}")
    size_kb = sum(f.stat().st_size for f in work.rglob("*") if f.is_file() and not f.is_symlink()) // 1024
    control = f"""Package: {pkg}
Version: {version()}
Architecture: amd64
Maintainer: {p['linux']['maintainer']}
Installed-Size: {size_kb}
Depends: {depends}, xdg-utils
Recommends: fonts-dejavu-core, fonts-liberation, fonts-crosextra-carlito, fonts-crosextra-caladea
Suggests: gstreamer1.0-libav, gstreamer1.0-plugins-good
Section: editors
Priority: optional
Homepage: {p['product']['website']}
Description: AuxiNux Office - suite bureautique libre
 Suite bureautique libre de l'écosystème AuxiNux : AuxiWriter (traitement de
 texte), AuxiSheet (tableur), AuxiPresent (présentations), AuxiPDF (lecteur PDF)
 et AuxiText (éditeur de texte brut). Compatible avec les formats Microsoft
 Office (DOCX, XLSX, PPTX) et OpenDocument. Fonctionne hors ligne, sans compte,
 sans publicité ni télémétrie.
"""
    debian = work / "DEBIAN"
    write_text(debian / "control", control)
    md5 = []
    for f in sorted(work.rglob("*")):
        if f.is_file() and not f.is_symlink() and "DEBIAN" not in f.parts:
            md5.append(f"{hashlib.md5(f.read_bytes()).hexdigest()}  {f.relative_to(work)}")
    write_text(debian / "md5sums", "\n".join(md5) + "\n")
    for d in [work] + [x for x in work.rglob("*") if x.is_dir()]:
        d.chmod(0o755)
    out = DIST_DIR / "linux" / f"{pkg}_{version()}_amd64.deb"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    run(["fakeroot", "dpkg-deb", "--build", "--root-owner-group", "-Zxz", "-z6", work, out],
        env={"SOURCE_DATE_EPOCH": str(source_date_epoch())})
    run(["dpkg-deb", "--info", out], quiet=True, capture=True)
    ok(f"{out.name} ({out.stat().st_size // (1024 * 1024)} Mio)")
    return out


# ---------------------------------------------------------------------------
# AppImage
# ---------------------------------------------------------------------------

def build_appimage(p):
    step("AppImage")
    stage = stage_dir("linux")
    tools = lock()["toolchains"]
    tool = download(tools["appimagetool"]["url"], TOOLCHAINS_DIR / "downloads" / "appimagetool-1.9.1-x86_64.AppImage",
                    sha256=tools["appimagetool"]["sha256"])
    tool.chmod(0o755)
    runtime = download(tools["appimage_runtime"]["url"], TOOLCHAINS_DIR / "downloads" / "type2-runtime-20251108-x86_64",
                       sha256=tools["appimage_runtime"]["sha256"])
    appdir = BUILD_DIR / "package" / "appimage" / "AuxiNuxOffice.AppDir"
    rmtree(appdir.parent)
    libdir = appdir / p["linux"]["install_dir"].lstrip("/")
    libdir.parent.mkdir(parents=True)
    shutil.copytree(stage, libdir, symlinks=True)
    write_text(libdir / "converter" / "package.config", "package = appimage\n")
    install_desktop_integration(appdir, p, "auxioffice")
    app_id = p["linux"]["app_id"]
    shutil.copy2(appdir / "usr" / "share" / "applications" / f"{app_id}.desktop", appdir / f"{app_id}.desktop")
    shutil.copy2(GEN / "png" / "256x256" / "auxioffice.png", appdir / f"{app_id}.png")
    shutil.copy2(GEN / "png" / "256x256" / "auxioffice.png", appdir / ".DirIcon")
    write_text(appdir / "AppRun", """#!/bin/sh
# AuxiNux Office — point d'entrée de l'AppImage
HERE="$(dirname "$(readlink -f "$0")")"
export AUXI_PACKAGE=appimage
exec "$HERE%s/auxioffice" "$@"
""" % p["linux"]["install_dir"])
    (appdir / "AppRun").chmod(0o755)
    out = DIST_DIR / "linux" / f"AuxiNuxOffice-{version()}-x86_64.AppImage"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    env = {"ARCH": "x86_64", "SOURCE_DATE_EPOCH": str(source_date_epoch())}
    if not shutil.which("file"):
        if not getattr(p, "local_deps", False) and not os.environ.get("AUXI_LOCAL_DEPS"):
            fail("appimagetool nécessite la commande « file » (paquet file) ; ou relancer avec --local-deps")
        from .toolchain import local_tool_env
        env.update(local_tool_env(["file"]))
    run([tool, "--appimage-extract-and-run", "--no-appstream", "--runtime-file", runtime, "--comp", "zstd",
         appdir, out], env=env, log_file=BUILD_DIR / "package" / "appimage" / "appimagetool.log")
    out.chmod(0o755)
    ok(f"{out.name} ({out.stat().st_size // (1024 * 1024)} Mio)")
    return out


class _Product(dict):
    """product.json + options de la ligne de commande utiles à l'empaquetage."""


def package(args):
    p = _Product(product())
    p.local_deps = args.local_deps
    check_shippable(stage_dir("linux"))
    formats = [f.strip() for f in (args.formats or "deb,appimage").split(",") if f.strip()]
    produced = []
    if "deb" in formats:
        produced.append(build_deb(p))
    if "appimage" in formats:
        produced.append(build_appimage(p))
    from . import update_info
    update_info.write("linux", [f for f in (DIST_DIR / "linux").iterdir() if f.is_file()])
    sums = DIST_DIR / "linux" / "SHA256SUMS"
    lines = []
    for f in sorted((DIST_DIR / "linux").glob("*")):
        if f.is_file() and f.name != "SHA256SUMS":
            h = hashlib.sha256()
            with open(f, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            lines.append(f"{h.hexdigest()}  {f.name}")
    write_text(sums, "\n".join(lines) + "\n")
    ok(f"sommes de contrôle : {sums}")
