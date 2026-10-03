# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""macOS shell compiled from the patched sources (desktop-apps/macos, Xcode), on a Mac only.

The upstream Xcode project expects the full upstream build (build_tools/out/mac_*/...). AuxiNux
compiles only the shell executable: the frameworks it links against (ascdocumentscore, Chromium
Embedded Framework, ooxmlsignature, hunspell) are taken from the pinned upstream application,
exposed where the project looks for them; the build scripts that copy resources and libraries
are skipped (AUXINUX_BUILD, patch desktop-apps 0013) and the resource folders are empty
placeholders. macos.py then puts the executable in place of the upstream one, in the bundle
assembled from the upstream application (same version: same frameworks, storyboards, resources).

Patches applied to the macOS shell (desktop-apps 0013, compiled with -D_AUXINUX): Help menu
pages, plain text files opened in AuxiText."""

import os
import shutil
from pathlib import Path

from .common import BUILD_DIR, IS_MACOS_HOST, UPSTREAM_SRC, fail, info, ok, rmtree, run, step, warn, which

OUT = BUILD_DIR / "native" / "macos" / "shell"
SCHEME = "ONLYOFFICE-arm"
PRODUCT = "ONLYOFFICE"


def built_executable():
    """Exécutable du shell compilé par build(), ou None (application d'upstream utilisée telle quelle)."""
    exe = OUT / "bin" / PRODUCT
    return exe if exe.exists() else None


def _xcode_ok():
    if not IS_MACOS_HOST or not which("xcodebuild"):
        return False
    res = run(["xcodebuild", "-version"], check=False, capture=True, quiet=True)
    return res.returncode == 0


def _link(target, link):
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink() or link.exists():
        if link.is_dir() and not link.is_symlink():
            rmtree(link)
        else:
            link.unlink()
    link.symlink_to(target)


def _prepare_tree(engine_app):
    """Bibliothèques de l'application d'upstream là où le projet Xcode les cherche, dossiers de
    ressources vides (copiés par Xcode, remplacés ensuite par l'assemblage AuxiNux)."""
    contents = engine_app / "Contents"
    for arch in ("mac_arm64", "mac_64"):
        base = UPSTREAM_SRC / "build_tools" / "out" / arch / "onlyoffice" / "desktopeditors"
        for fw in ("ascdocumentscore.framework", "Chromium Embedded Framework.framework", "hunspell.framework"):
            _link(contents / "Frameworks" / fw, base / fw)
        _link(contents / "Resources" / "converter", base / "converter")
    project = UPSTREAM_SRC / "desktop-apps" / "macos"
    for name in ("editors", "converter", "login", "providers", "license"):
        (project / "Vendor" / "ONLYOFFICE" / name).mkdir(parents=True, exist_ok=True)
    # Dossier « dictionaries » référencé par le projet (../../../../dictionaries depuis ses ressources)
    (UPSTREAM_SRC / "dictionaries").mkdir(parents=True, exist_ok=True)
    return project


def build(args):
    """Compile le shell macOS (Xcode). Sans Xcode, ou en cas d'échec, l'exécutable d'upstream est
    gardé et le message indique le journal à transmettre."""
    from .fetch import engine_dir
    step("Shell macOS compilé (Xcode, desktop-apps/macos patché)")
    if not _xcode_ok():
        warn("Xcode indisponible (xcodebuild) : shell macOS d'upstream utilisé tel quel. "
             "Installer Xcode puis : sudo xcode-select -s <chemin de Xcode.app>/Contents/Developer")
        return None
    engine = engine_dir("macos")
    if not (engine / "Contents" / "Info.plist").exists():
        fail("application macOS d'upstream absente : lancer l'étape fetch (cible macos)")
    project = _prepare_tree(engine)
    rmtree(OUT / "bin")
    derived = OUT / "derived"
    log = OUT / "xcodebuild.log"
    cmd = ["xcodebuild", "-project", project / "ONLYOFFICE.xcodeproj", "-scheme", SCHEME,
           "-configuration", "Release", "-derivedDataPath", derived, "-destination", "generic/platform=macOS",
           "ARCHS=arm64", "ONLY_ACTIVE_ARCH=NO", "AUXINUX_BUILD=1", "OTHER_CFLAGS=-D_AUXINUX",
           "CODE_SIGN_IDENTITY=-", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGNING_ALLOWED=NO", "DEVELOPMENT_TEAM=",
           "PROVISIONING_PROFILE_SPECIFIER=", "ENABLE_HARDENED_RUNTIME=NO", "GCC_TREAT_WARNINGS_AS_ERRORS=NO",
           "build"]
    res = run(cmd, cwd=project, check=False, log_file=log)
    app = derived / "Build" / "Products" / "Release" / f"{PRODUCT}.app"
    exe = app / "Contents" / "MacOS" / PRODUCT
    if res.returncode != 0 or not exe.exists():
        warn(f"compilation du shell macOS en échec : shell d'upstream utilisé tel quel. Journal : {log}")
        if os.environ.get("AUXI_MACOS_SHELL") == "required":
            fail("shell macOS compilé exigé (AUXI_MACOS_SHELL=required)")
        return None
    dest = OUT / "bin" / PRODUCT
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exe, dest)
    links = run(["otool", "-L", dest], check=False, capture=True, quiet=True).stdout
    info("bibliothèques liées : " + ", ".join(l.strip().split(" ")[0].split("/")[-1]
                                               for l in links.splitlines()[1:] if "@rpath" in l))
    ok(f"shell macOS compilé : {dest}")
    return dest
