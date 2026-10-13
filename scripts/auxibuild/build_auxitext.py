# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Build AuxiText (Qt), the auxioffice launcher (C) and the x2t guard (C) for Linux, Windows
or macOS. They use the same sources on every platform (macOS: AuxiText only, built on a Mac;
the macOS launcher and x2t guard are built by macos.py, from Linux or a Mac)."""

import os
import shutil
from pathlib import Path

from .common import BUILD_DIR, ROOT, fail, ok, product, rmtree, run, step, version, version_tuple4, build_number, write_text
from .toolchain import ensure_qt, linux_build_env

NATIVE_DIR = BUILD_DIR / "native"
AUXITEXT_SRC = ROOT / "src" / "auxitext"
LAUNCHER_SRC = ROOT / "src" / "launcher"
X2T_GUARD_SRC = ROOT / "src" / "x2tguard" / "x2t_guard.c"


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


def prepare_shell_translations(qt_tools_bin, text_dir):
    """Traductions et icône d'AuxiText intégré au shell (onglets texte) : :/auxinux/i18n, :/auxinux/icons."""
    if not (text_dir / "mainwindow.cpp").exists():
        return
    i18n = text_dir / "i18n"
    rmtree(i18n)
    i18n.mkdir(parents=True)
    for ts in sorted((AUXITEXT_SRC / "i18n").glob("*.ts")):
        run([qt_tools_bin / "lrelease", "-silent", ts, "-qm", i18n / (ts.stem + ".qm")], quiet=True)
    entries = [f"        <file>{qm.name}</file>" for qm in sorted(i18n.glob("auxitext_*.qm"))]
    shutil.copy2(ROOT / "branding" / "generated" / "svg" / "auxitext.svg", i18n / "auxitext.svg")
    write_text(i18n / "auxitext-i18n.qrc", "<!DOCTYPE RCC>\n<RCC version=\"1.0\">\n"
               "    <qresource prefix=\"/auxinux/i18n\">\n" + "\n".join(entries) + "\n    </qresource>\n"
               "    <qresource prefix=\"/auxinux/icons\">\n        <file>auxitext.svg</file>\n    </qresource>\n</RCC>\n")


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
    run([qt / "bin" / "qmake", AUXITEXT_SRC / "auxitext.pro", f"CONFIG+={args.mode}", "QMAKE_RPATHDIR=",
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
    # no_batch : pas de règles d'inférence NMake « {src}.cpp{obj}.obj:: », illisibles par GNU make
    run([qt_host / "bin" / "qmake", "-qtconf", conf, "-spec", "win32-clang-msvc", f"CONFIG+={args.mode}",
         "CONFIG-=debug_and_release", "CONFIG+=no_batch", "QMAKE_TARGET.arch=x86_64", AUXITEXT_SRC / "auxitext.pro"],
        cwd=out, env=env, log_file=out / "qmake.log")
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
            f'-DAUXI_TEXT_EXTENSIONS="{text_extensions()}"',
            f'-DAUXI_ENGINE_SWITCHES="{engine_switches()}"']


def engine_switches():
    """Commutateurs du moteur (privacy.engine_switches de product.json), séparés par « ; »."""
    return ";".join(product()["privacy"]["engine_switches"])


def build_launcher_linux(args):
    step("Lanceur auxioffice (Linux)")
    dest = NATIVE_DIR / "linux" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    opt = ["-O2"] if args.mode == "release" else ["-Og", "-g"]  # _FORTIFY_SOURCE exige une optimisation
    run(["gcc", "-std=c99", "-D_DEFAULT_SOURCE", "-D_GNU_SOURCE", *opt, "-Wall", "-Wextra", "-Werror",
         "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2", "-pie", "-fPIE", "-Wl,-z,relro,-z,now",
         *_launcher_defines(), LAUNCHER_SRC / "auxioffice.c", "-o", dest / "auxioffice"])
    ok(f"lanceur : {dest / 'auxioffice'}")


def build_x2t_guard_linux(args):
    step("Garde du convertisseur x2t (Linux)")
    dest = NATIVE_DIR / "linux" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    opt = ["-O2"] if args.mode == "release" else ["-Og", "-g"]
    run(["gcc", "-std=c99", "-D_DEFAULT_SOURCE", *opt, "-Wall", "-Wextra", "-Werror",
         "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2", "-pie", "-fPIE", "-Wl,-z,relro,-z,now",
         X2T_GUARD_SRC, "-o", dest / "x2t-guard"])
    ok(f"garde x2t : {dest / 'x2t-guard'}")


def build_x2t_guard_windows(args):
    step("Garde du convertisseur x2t.exe (Windows x64)")
    from .wincross import ensure_wrappers
    wrappers = ensure_wrappers(args.local_deps, args.accept_msvc_license)
    out = NATIVE_DIR / "windows" / "x2tguard"
    out.mkdir(parents=True, exist_ok=True)
    dest = NATIVE_DIR / "windows" / "bin"
    dest.mkdir(parents=True, exist_ok=True)
    opt = ["/O2"] if args.mode == "release" else ["/Od", "/Z7"]
    run([wrappers / "clang-cl", "/nologo", *opt, "/W3", "/MD", "/DUNICODE", "/D_UNICODE",
         "/D_CRT_SECURE_NO_WARNINGS", X2T_GUARD_SRC, f"/Fo{out}/", f"/Fe{dest / 'x2t-guard.exe'}",
         "/link", "/SUBSYSTEM:CONSOLE"])
    ok(f"garde x2t : {dest / 'x2t-guard.exe'}")


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
    opt = ["/O2"] if args.mode == "release" else ["/Od", "/Z7"]
    run([wrappers / "clang-cl", "/nologo", *opt, "/W3", "/MD", "/DUNICODE", "/D_UNICODE",
         *[d.replace("-D", "/D", 1) for d in _launcher_defines()],
         LAUNCHER_SRC / "auxioffice.c", out / "auxioffice.res", f"/Fo{out}/", f"/Fe{dest / 'auxioffice.exe'}",
         "/link", "/SUBSYSTEM:WINDOWS", "shell32.lib", "user32.lib"])
    ok(f"lanceur : {dest / 'auxioffice.exe'}")


def _qt_macos():
    """Qt 5 pour macOS : AUXI_QT_MACOS, sinon Homebrew (brew install qt@5)."""
    prefix = os.environ.get("AUXI_QT_MACOS")
    if not prefix:
        res = run(["brew", "--prefix", "qt@5"], check=False, capture=True, quiet=True)
        prefix = res.stdout.strip() if res.returncode == 0 else ""
    qt = Path(prefix) if prefix else None
    if not qt or not (qt / "bin" / "qmake").exists():
        fail("Qt 5 introuvable : brew install qt@5 (ou définir AUXI_QT_MACOS)")
    return qt


def build_auxitext_macos(args):
    """AuxiText.app (Apple Silicon) : Qt intégré à l'application (macdeployqt)."""
    import plistlib
    from .common import IS_MACOS_HOST
    step("AuxiText (macOS)")
    if not IS_MACOS_HOST:
        fail("AuxiText pour macOS se compile sur un Mac (voir docs/MACOS.md)")
    qt = _qt_macos()
    out = NATIVE_DIR / "macos" / "auxitext"
    rmtree(out)
    out.mkdir(parents=True)
    _prepare_translations(qt / "bin", qt / "translations", out)
    run([qt / "bin" / "qmake", AUXITEXT_SRC / "auxitext.pro", f"CONFIG+={args.mode}",
         "QMAKE_MACOSX_DEPLOYMENT_TARGET=11.0", "QMAKE_APPLE_DEVICE_ARCHS=arm64"],
        cwd=out, log_file=out / "qmake.log")
    run(["make", f"-j{args.jobs}"], cwd=out, log_file=out / "make.log")
    built = out / "auxitext.app"
    if not built.exists():
        fail("auxitext.app introuvable après la compilation")
    run([qt / "bin" / "macdeployqt", built], log_file=out / "macdeployqt.log")

    from .macos import _icon_pngs, write_icns
    p = product()
    contents = built / "Contents"
    write_icns(_icon_pngs("auxitext"), contents / "Resources" / "AuxiText.icns")
    with open(contents / "Info.plist", "rb") as fh:
        plist = plistlib.load(fh)
    exts = [e for e in p["apps"]["text"]["extensions"] if e != "csv"] + ["csv"]
    plist.update({
        "CFBundleName": "AuxiText",
        "CFBundleDisplayName": "AuxiText",
        "CFBundleIdentifier": f"{p['linux']['app_id']}.Text",
        "CFBundleShortVersionString": version(),
        "CFBundleVersion": version(),
        "CFBundleIconFile": "AuxiText",
        "LSMinimumSystemVersion": "11.0",
        "NSHighResolutionCapable": True,
        "NSHumanReadableCopyright": f"© {p['product']['copyright_first_year']} {p['product']['copyright_holder']}. "
                                    "Logiciel libre (AGPL v3).",
        # adresse auxitext://new : tuile « Nouveau fichier texte » de l'accueil d'AuxiNux Office
        "CFBundleURLTypes": [{"CFBundleURLName": "AuxiText", "CFBundleURLSchemes": ["auxitext"]}],
        # proposé (« Ouvrir avec ») sans revendiquer le rôle par défaut
        "CFBundleDocumentTypes": [{"CFBundleTypeName": "Texte brut", "CFBundleTypeRole": "Editor",
                                   "LSHandlerRank": "Alternate", "CFBundleTypeExtensions": exts,
                                   "LSItemContentTypes": ["public.plain-text", "public.text"]}],
    })
    with open(contents / "Info.plist", "wb") as fh:
        plistlib.dump(plist, fh, fmt=plistlib.FMT_XML)
    # Signature ad hoc refaite après macdeployqt et la modification d'Info.plist : sur Apple Silicon,
    # un programme dont la signature ne correspond plus est arrêté au lancement.
    run(["codesign", "--force", "--deep", "--sign", "-", built], log_file=out / "codesign.log")
    dest = NATIVE_DIR / "macos" / "AuxiText.app"
    rmtree(dest)
    run(["ditto", built, dest], quiet=True)
    res = run([dest / "Contents" / "MacOS" / "auxitext", "--version"], capture=True, quiet=True)
    if f"AuxiText {version()}" not in res.stdout:
        fail(f"AuxiText.app ne répond pas correctement à --version : {res.stdout!r}")
    ok(f"AuxiText : {dest} ({res.stdout.strip()})")


def build(args):
    wanted = args.components
    if args.target == "macos":
        if "auxitext" in wanted:
            build_auxitext_macos(args)
        return
    if args.target == "linux":
        if "auxitext" in wanted:
            build_auxitext_linux(args)
        if "launcher" in wanted:
            build_launcher_linux(args)
            build_x2t_guard_linux(args)
    else:
        if "auxitext" in wanted:
            build_auxitext_windows(args)
        if "launcher" in wanted:
            build_launcher_windows(args)
            build_x2t_guard_windows(args)
