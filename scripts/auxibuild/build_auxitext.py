# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Build AuxiText (Qt) and the auxioffice launcher (C) for Linux or Windows.
Both use the same sources on every platform."""

import os
import shutil
from pathlib import Path

from .common import ROOT, fail, ok, product, rmtree, run, step, version, version_tuple4, build_number, write_text
from .toolchain import ensure_qt, linux_build_env

NATIVE_DIR = ROOT / "build" / "native"
AUXITEXT_SRC = ROOT / "src" / "auxitext"
LAUNCHER_SRC = ROOT / "src" / "launcher"


def text_extensions():
    return ";".join(e for e in product()["apps"]["text"]["extensions"] if e != "csv")


def _prepare_translations(qt_tools_bin, qt_translations, out):
    """Compile the .ts files and bundle Qt's own French strings (standard dialogs)."""
    i18n = out / "i18n"
    rmtree(i18n)
    i18n.mkdir(parents=True)
    for ts in sorted((AUXITEXT_SRC / "i18n").glob("*.ts")):
        run([qt_tools_bin / "lrelease", "-silent", ts, "-qm", i18n / (ts.stem + ".qm")], quiet=True)
    entries = [f"        <file>{qm.name}</file>" for qm in sorted(i18n.glob("auxitext_*.qm"))]
    qtbase_fr = Path(qt_translations) / "qtbase_fr.qm"
    if qtbase_fr.exists():
        shutil.copy2(qtbase_fr, i18n / "qtbase_fr.qm")
        entries.append("        <file>qtbase_fr.qm</file>")
    write_text(i18n / "i18n.qrc", "<!DOCTYPE RCC>\n<RCC version=\"1.0\">\n    <qresource prefix=\"/i18n\">\n"
               + "\n".join(entries) + "\n    </qresource>\n</RCC>\n")


def build_auxitext_linux(args):
    step("AuxiText (Linux)")
    qt = ensure_qt("qt_linux")
    out = NATIVE_DIR / "linux" / "auxitext"
    if args.clean:
        rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    _prepare_translations(qt / "bin", qt / "translations", out)
    env = dict(linux_build_env(args.local_deps))
    env["PATH"] = f"{qt}/bin:{os.environ['PATH']}"
    from .build_native import engine_qt_link_dir, check_elf
    from .fetch import engine_dir
    run([qt / "bin" / "qmake", AUXITEXT_SRC / "auxitext.pro", "QMAKE_RPATHDIR=",
         f"LIBS+=-L{engine_qt_link_dir()}", f"QMAKE_LFLAGS+=-Wl,-rpath-link,{engine_dir('linux')}"],
        cwd=out, env=env, log_file=out / "qmake.log")
    run(["make", f"-j{args.jobs}"], cwd=out, env=env, log_file=out / "make.log")
    binary = out / "auxitext"
    if not binary.exists():
        fail("binaire auxitext introuvable")
    dest = NATIVE_DIR / "linux" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary, dest / "auxitext")
    check_elf(dest / "auxitext")
    ok(f"AuxiText : {dest / 'auxitext'}")


def build_auxitext_windows(args):
    step("AuxiText (Windows x64, compilation croisée)")
    from .wincross import ensure_wrappers, fix_nmake_inline_files, qt_cross_conf, check_imports
    from .fetch import engine_dir
    wrappers = ensure_wrappers(args.local_deps, args.accept_msvc_license)
    qt_win = ensure_qt("qt_windows")
    qt_host = ensure_qt("qt_host_for_windows_cross")
    out = NATIVE_DIR / "windows" / "auxitext"
    if args.clean:
        rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    _prepare_translations(qt_host / "bin", qt_win / "translations", out)
    conf = qt_cross_conf(qt_win, qt_host, out / "qt-cross.conf")
    env = {"PATH": f"{wrappers}:{os.environ['PATH']}"}
    run([qt_host / "bin" / "qmake", "-qtconf", conf, "-spec", "win32-clang-msvc", "CONFIG+=release",
         "QMAKE_TARGET.arch=x86_64", AUXITEXT_SRC / "auxitext.pro"], cwd=out, env=env, log_file=out / "qmake.log")
    for mk in out.glob("Makefile*"):
        fix_nmake_inline_files(mk)
    run(["make", f"-j{args.jobs}"], cwd=out, env=env, log_file=out / "make.log")
    binary = next(iter(list(out.rglob("auxitext.exe"))), None)
    if not binary:
        fail("binaire auxitext.exe introuvable")
    dest = NATIVE_DIR / "windows" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(binary, dest / "auxitext.exe")
    eng = engine_dir("windows")
    check_imports(dest / "auxitext.exe", [eng])
    ok(f"AuxiText : {dest / 'auxitext.exe'}")


def _launcher_defines():
    return [f'-DAUXI_PRODUCT_NAME="{product()["product"]["name"]}"', f'-DAUXI_VERSION="{version()}"',
            f'-DAUXI_TEXT_EXTENSIONS="{text_extensions()}"']


def build_launcher_linux(args):
    step("Lanceur auxioffice (Linux)")
    dest = NATIVE_DIR / "linux" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    run(["gcc", "-std=c99", "-D_DEFAULT_SOURCE", "-D_GNU_SOURCE", "-O2", "-Wall", "-Wextra", "-Werror",
         "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2", "-pie", "-fPIE", "-Wl,-z,relro,-z,now",
         *_launcher_defines(), LAUNCHER_SRC / "auxioffice.c", "-o", dest / "auxioffice"])
    ok(f"lanceur : {dest / 'auxioffice'}")


def build_launcher_windows(args):
    step("Lanceur auxioffice.exe (Windows x64)")
    from .wincross import ensure_wrappers
    wrappers = ensure_wrappers(args.local_deps, args.accept_msvc_license)
    out = NATIVE_DIR / "windows" / "launcher"
    out.mkdir(parents=True, exist_ok=True)
    v = version_tuple4(build_number())
    rc = (LAUNCHER_SRC / "auxioffice.rc.in").read_text(encoding="utf-8")
    rc = (rc.replace("@ICO@", str(ROOT / "branding" / "generated" / "ico"))
            .replace("@V1@", str(v[0])).replace("@V2@", str(v[1])).replace("@V3@", str(v[2]))
            .replace("@V4@", str(v[3])).replace("@VERSION@", version()))
    write_text(out / "auxioffice.rc", rc)
    run([wrappers / "rc", "/NOLOGO", "-fo", out / "auxioffice.res", out / "auxioffice.rc"])
    dest = NATIVE_DIR / "windows" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    run([wrappers / "clang-cl", "/nologo", "/O2", "/W3", "/MD", "/DUNICODE", "/D_UNICODE",
         *[d.replace("-D", "/D", 1) for d in _launcher_defines()],
         LAUNCHER_SRC / "auxioffice.c", out / "auxioffice.res", f"/Fo{out}/", f"/Fe{dest / 'auxioffice.exe'}",
         "/link", "/SUBSYSTEM:WINDOWS", "shell32.lib", "user32.lib"])
    ok(f"lanceur : {dest / 'auxioffice.exe'}")


def build(args):
    wanted = args.components
    if args.target == "linux":
        if "auxitext" in wanted:
            build_auxitext_linux(args)
        if "launcher" in wanted:
            build_launcher_linux(args)
    else:
        if "auxitext" in wanted:
            build_auxitext_windows(args)
        if "launcher" in wanted:
            build_launcher_windows(args)
