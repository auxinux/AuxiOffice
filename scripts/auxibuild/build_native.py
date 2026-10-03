# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Native builds: the Qt shell (upstream desktop-apps/win-linux, patched and
branded), AuxiText and the auxioffice launcher.

Linux  : g++ + Qt 5.9.9 (the Qt version shipped by upstream), linked against the
         pinned upstream engine libraries.
Windows: clang-cl/lld-link cross build from Linux against Qt 5.15.2 MSVC 2019
         (the Qt shipped by upstream) and import libraries generated from the
         pinned upstream DLLs. A native MSVC build is described in BUILD.md."""

import os
import shutil
from pathlib import Path

from .common import (BUILD_DIR, IS_WINDOWS_HOST, ROOT, UPSTREAM_SRC, fail, info, ok, rmtree, run,
                     step, warn, write_text)
from .fetch import THIRD_PARTY_DIR, engine_dir
from .toolchain import ensure_qt, linux_build_env

NATIVE_DIR = BUILD_DIR / "native"

# Engine libraries the shell links against (names without lib prefix / extension).
SHELL_ENGINE_LIBS = {
    # name: subdirectory of the engine tree
    "kernel": "converter", "kernel_network": "converter", "graphics": "converter",
    "PdfFile": "converter", "DjVuFile": "converter", "XpsFile": "converter",
    "UnicodeConverter": "converter", "ooxmlsignature": "converter", "doctrenderer": "converter",
    "hunspell": "", "ascdocumentscore": "", "qtascdocumentscore": "", "videoplayer": "",
}


def shell_src():
    return UPSTREAM_SRC / "desktop-apps" / "win-linux"


def _link_engine_for_qmake(target):
    """Expose the pinned engine binaries where upstream's qmake files expect the
    core build outputs (core/build/lib/<platform>, core/Common/3dParty/icu/...)."""
    core = UPSTREAM_SRC / "core"
    eng = engine_dir(target)
    icu_inc = THIRD_PARTY_DIR / "icu74" / "include"
    if target == "linux":
        libdir = core / "build" / "lib" / "linux_64"
        rmtree(libdir)
        libdir.mkdir(parents=True)
        for name, sub in SHELL_ENGINE_LIBS.items():
            so = (eng / sub / f"lib{name}.so") if sub else (eng / f"lib{name}.so")
            if not so.exists():
                fail(f"bibliothèque moteur absente : {so}")
            (libdir / f"lib{name}.so").symlink_to(so)
        icu = core / "Common" / "3dParty" / "icu" / "linux_64" / "build"
        rmtree(icu)
        icu.mkdir(parents=True)
        (icu / "include").symlink_to(icu_inc)
        for lib in ("libicuuc.so.74", "libicudata.so.74"):
            (icu / lib).symlink_to(eng / "converter" / lib)
    else:
        from .wincross import make_import_libs
        libdir = core / "build" / "lib" / "win_64"
        dlls = []
        for name, sub in SHELL_ENGINE_LIBS.items():
            dll = (eng / sub / f"{name}.dll") if sub else (eng / f"{name}.dll")
            if not dll.exists():
                fail(f"DLL moteur absente : {dll}")
            dlls.append(dll)
        make_import_libs(dlls, libdir)
        icu_root = core / "Common" / "3dParty" / "icu"
        rmtree(icu_root / "icu" / "include")
        (icu_root / "icu").mkdir(parents=True, exist_ok=True)
        (icu_root / "icu" / "include").symlink_to(icu_inc)
        winbuild = icu_root / "win_64" / "build"
        winbuild.mkdir(parents=True, exist_ok=True)
        make_import_libs([eng / "converter" / "icuuc74.dll"], winbuild)
        shutil.copy2(winbuild / "icuuc74.lib", winbuild / "icuuc.lib")


def engine_qt_link_dir():
    """Link against the Qt libraries actually shipped (upstream engine), not the SDK
    ones: symbol versions must match the runtime (see scripts/tools/check_elf_imports.py)."""
    eng = engine_dir("linux")
    link = NATIVE_DIR / "linux" / "qt-link"
    rmtree(link)
    link.mkdir(parents=True)
    for so in sorted(eng.glob("libQt5*.so.5")):
        (link / so.name[:-2]).symlink_to(so)
    return link


def check_elf(binary):
    eng = engine_dir("linux")
    run(["python3", ROOT / "scripts" / "tools" / "check_elf_imports.py", binary, eng, eng / "converter"])


def build_shell_linux(args):
    step("Shell natif Linux (desktop-apps/win-linux)")
    qt = ensure_qt("qt_linux")
    _link_engine_for_qmake("linux")
    env = dict(linux_build_env(args.local_deps))
    env["PATH"] = f"{qt}/bin:{os.environ['PATH']}"
    sysdeps_lib = env.get("AUXI_SYSDEPS_LIBDIR")
    out = NATIVE_DIR / "linux" / "shell"
    out.mkdir(parents=True, exist_ok=True)
    from .build_auxitext import prepare_shell_translations
    prepare_shell_translations(qt / "bin", shell_src() / "src" / "auxinux" / "auxitext")
    config = "release" if args.mode == "release" else "debug"
    qmake_args = [qt / "bin" / "qmake", shell_src() / "ASCDocumentEditor.pro", f"CONFIG+={config}",
                  # same link behaviour as upstream packages: only really used libraries
                  "QMAKE_LFLAGS+=-Wl,--as-needed",
                  # no build-machine paths in the RPATH (Qt is shipped next to the binary)
                  "QMAKE_RPATHDIR=", "QMAKE_LFLAGS_RPATH="]
    qmake_args += [f"LIBS+=-L{engine_qt_link_dir()}", f"QMAKE_LFLAGS+=-Wl,-rpath-link,{engine_dir('linux')}"]
    if sysdeps_lib:
        qmake_args.append(f"LIBS+=-L{sysdeps_lib}")
    run(qmake_args, cwd=out, env=env, log_file=out / "qmake.log")
    run(["make", f"-j{args.jobs}"], cwd=out, env=env, log_file=out / "make.log")
    binary = shell_src() / "build" / ("linux_64" if args.mode == "release" else "debug/linux_64") / "DesktopEditors"
    if not binary.exists():
        fail(f"binaire du shell introuvable : {binary}")
    dest = NATIVE_DIR / "linux" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary, dest / "auxioffice-editors")
    check_elf(dest / "auxioffice-editors")
    ok(f"shell Linux : {dest / 'auxioffice-editors'}")


def build_shell_windows(args):
    step("Shell natif Windows x64 (compilation croisée clang-cl)")
    if IS_WINDOWS_HOST:
        fail("build natif MSVC : utiliser scripts/build-windows.ps1 -Native (voir BUILD.md)")
    from .wincross import ensure_wrappers, fix_nmake_inline_files, qt_cross_conf, check_imports
    wrappers = ensure_wrappers(args.local_deps, args.accept_msvc_license)
    qt_win = ensure_qt("qt_windows")
    qt_host = ensure_qt("qt_host_for_windows_cross")
    _link_engine_for_qmake("windows")
    out = NATIVE_DIR / "windows" / "shell"
    out.mkdir(parents=True, exist_ok=True)
    from .build_auxitext import prepare_shell_translations
    prepare_shell_translations(qt_host / "bin", shell_src() / "src" / "auxinux" / "auxitext")
    conf = qt_cross_conf(qt_win, qt_host, out / "qt-cross.conf")
    env = {"PATH": f"{wrappers}:{os.environ['PATH']}"}
    config = "release" if args.mode == "release" else "debug"
    run([qt_host / "bin" / "qmake", "-qtconf", conf, "-spec", "win32-clang-msvc", f"CONFIG+={config}",
         "QMAKE_TARGET.arch=x86_64", shell_src() / "ASCDocumentEditor.pro"],
        cwd=out, env=env, log_file=out / "qmake.log")
    fix_nmake_inline_files(out / "Makefile")
    run(["make", f"-j{args.jobs}"], cwd=out, env=env, log_file=out / "make.log")
    binary = shell_src() / "build" / ("win_64" if args.mode == "release" else "debug/win_64") / "DesktopEditors.exe"
    if not binary.exists():
        fail(f"binaire du shell introuvable : {binary}")
    dest = NATIVE_DIR / "windows" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary, dest / "auxioffice-editors.exe")
    eng = engine_dir("windows")
    check_imports(dest / "auxioffice-editors.exe", [eng, eng / "converter"])
    ok(f"shell Windows : {dest / 'auxioffice-editors.exe'}")


def build_all(args):
    if args.target == "macos":
        # macOS : shell natif d'upstream réempaqueté (voir macos.py) ; AuxiText compilé seulement sur un Mac
        from .common import IS_MACOS_HOST
        if IS_MACOS_HOST:
            from . import build_auxitext
            build_auxitext.build(args)
            if "shell" in args.components:
                from . import macos_shell
                macos_shell.build(args)
        else:
            warn("macOS depuis Linux : AuxiText non compilé (à construire sur un Mac avec ./build.sh) — "
                 "application upstream réempaquetée, voir docs/MACOS.md")
        return
    if "shell" in args.components:
        if args.target == "linux":
            build_shell_linux(args)
        else:
            build_shell_windows(args)
    from . import build_auxitext
    build_auxitext.build(args)
