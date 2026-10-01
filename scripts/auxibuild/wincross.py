# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Windows x64 cross-compilation from Linux with clang-cl + lld-link.

The MSVC CRT and Windows SDK are provided by xwin (Microsoft license terms
must be accepted explicitly). Import libraries for the upstream DLLs are
generated from their export tables so the shell links against the exact
binaries shipped by upstream."""

import json
import os
import stat
from pathlib import Path

from .common import (TOOLCHAINS_DIR, download, extract_tar, fail, info, lock, ok, rmtree, run, step,
                     warn, which, write_text)
from .toolchain import ensure_venv

LLVM_LOCAL = TOOLCHAINS_DIR / "llvm"
XWIN_DIR = TOOLCHAINS_DIR / "xwin"
WINSYSROOT = TOOLCHAINS_DIR / "winsysroot"
WRAPPERS = TOOLCHAINS_DIR / "wintc" / "bin"
VFS_OVERLAY = TOOLCHAINS_DIR / "wintc" / "winsdk-vfs.json"
LLVM_DEBIAN_PACKAGES = ["clang-19", "libclang-cpp19", "lld-19", "llvm-19", "libclang-common-19-dev",
                        "llvm-19-linker-tools", "liblld-19", "libllvm19"]
TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"


def _llvm_candidates():
    if os.environ.get("AUXI_LLVM_DIR"):
        yield Path(os.environ["AUXI_LLVM_DIR"])
    for v in (21, 20, 19, 18, 17, 16):
        yield Path(f"/usr/lib/llvm-{v}/bin")
    yield LLVM_LOCAL / "usr" / "lib" / "llvm-19" / "bin"


def find_llvm():
    for d in _llvm_candidates():
        if all((d / t).exists() for t in ("clang", "lld-link", "llvm-rc", "llvm-dlltool")):
            return d
    return None


def ensure_llvm(local_deps=False):
    d = find_llvm()
    if d:
        return d
    if not local_deps:
        fail("LLVM (clang, lld-link, llvm-rc, llvm-dlltool) introuvable : installer 'clang lld llvm' "
             "(>= 16), définir AUXI_LLVM_DIR, ou relancer avec --local-deps")
    step("LLVM 19 local (paquets Debian extraits, sans root)")
    debs = TOOLCHAINS_DIR / "debs-llvm"
    debs.mkdir(parents=True, exist_ok=True)
    run(["apt-get", "download", *LLVM_DEBIAN_PACKAGES], cwd=debs)
    for deb in debs.glob("*.deb"):
        run(["dpkg-deb", "-x", deb, LLVM_LOCAL], quiet=True)
    d = find_llvm()
    if not d:
        fail("extraction LLVM incomplète")
    return d


def _llvm_ld_path(llvm_bin):
    root = llvm_bin.parent  # .../llvm-19
    paths = [root / "lib"]
    if str(llvm_bin).startswith(str(LLVM_LOCAL)):
        paths.append(LLVM_LOCAL / "usr" / "lib" / "x86_64-linux-gnu")
    return ":".join(str(p) for p in paths)


def ensure_winsysroot(accept_license):
    """Download the MSVC CRT + Windows SDK with xwin (only after explicit consent)."""
    spec = lock()["toolchains"]["xwin"]
    if (WINSYSROOT / "VC").exists() and (WINSYSROOT / "Windows Kits").exists():
        crt = WINSYSROOT / "VC" / "Tools" / "MSVC" / spec["crt_version"]
        if not crt.exists():
            fail(f"le sysroot Windows ne contient pas le CRT MSVC {spec['crt_version']} épinglé "
                 f"(upstream.lock.json) : supprimer {WINSYSROOT} et relancer")
        return WINSYSROOT
    if not accept_license:
        fail("La compilation croisée Windows télécharge le CRT MSVC et le SDK Windows de Microsoft "
             "via xwin. Ces composants sont soumis aux licences Microsoft : relancer avec "
             "--accept-msvc-license (ou AUXI_ACCEPT_MSVC_LICENSE=1) après les avoir lues.")
    step(f"CRT MSVC {spec['crt_version']} + SDK Windows {spec['sdk_version']} (xwin)")
    archive = download(spec["url"], TOOLCHAINS_DIR / "downloads" / spec["url"].rsplit("/", 1)[-1],
                       sha256=spec["sha256"])
    rmtree(XWIN_DIR)
    extract_tar(archive, XWIN_DIR)
    xwin = next(XWIN_DIR.rglob("xwin"))
    run([xwin, "--accept-license", "--arch", "x86_64", "--variant", "desktop",
         "--manifest-version", "17", "--crt-version", spec["crt_version"], "--sdk-version", spec["sdk_version"],
         "--cache-dir", TOOLCHAINS_DIR / "xwin-cache", "splat", "--use-winsysroot-style",
         "--preserve-ms-arch-notation", "--output", WINSYSROOT],
        log_file=TOOLCHAINS_DIR / "logs" / "xwin.log")
    ok(f"sysroot Windows prêt : {WINSYSROOT}")
    return WINSYSROOT


def make_vfs_overlay():
    """Case-insensitive view of the SDK/CRT headers (sources include <Lm.h>, <Shobjidl.h>...)."""
    roots = []
    for base, dirs, files in os.walk(WINSYSROOT):
        if "/Include/" not in base + "/" and "/include" not in base:
            continue
        contents, seen = [], set()
        for f in sorted(files):
            if "." in f and not f.lower().endswith((".h", ".hpp", ".inl", ".hxx", ".ipp")):
                continue
            real = os.path.realpath(os.path.join(base, f))
            if not os.path.exists(real) or f.lower() in seen:
                continue
            seen.add(f.lower())
            contents.append({"type": "file", "name": f, "external-contents": real})
        if contents:
            roots.append({"type": "directory", "name": base, "contents": contents})
    VFS_OVERLAY.parent.mkdir(parents=True, exist_ok=True)
    VFS_OVERLAY.write_text(json.dumps({"version": 0, "case-sensitive": "false",
                                       "overlay-relative": False, "roots": roots}))


def _write_exec(path, content):
    write_text(path, content)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def ensure_wrappers(local_deps=False, accept_license=False):
    """Create clang-cl / cl / lld-link / rc wrappers targeting x86_64-pc-windows-msvc."""
    llvm = ensure_llvm(local_deps)
    ensure_winsysroot(accept_license)
    stamp = WRAPPERS / ".stamp"
    wanted = f"{llvm}|{WINSYSROOT}"
    if stamp.exists() and stamp.read_text() == wanted and VFS_OVERLAY.exists():
        return WRAPPERS
    step("Enveloppes du compilateur croisé Windows")
    make_vfs_overlay()
    ld = _llvm_ld_path(llvm)
    head = f"#!/bin/sh\nexport LD_LIBRARY_PATH={ld}${{LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}}\n"
    clang = (head + f'exec "{llvm}/clang" --driver-mode=cl --target=x86_64-pc-windows-msvc '
             f'-fms-compatibility-version=19.29 /winsysroot "{WINSYSROOT}" -fuse-ld=lld '
             f'/clang:-ivfsoverlay "/clang:{VFS_OVERLAY}" -Wno-unused-command-line-argument "$@"\n')
    _write_exec(WRAPPERS / "clang-cl", clang)
    _write_exec(WRAPPERS / "cl", clang)
    _write_exec(WRAPPERS / "lld-link", head + f'exec "{llvm}/lld-link" "/winsysroot:{WINSYSROOT}" "$@"\n')
    for tool in ("llvm-lib", "llvm-dlltool", "llvm-readobj", "llvm-mt", "llvm-objdump"):
        _write_exec(WRAPPERS / tool, head + f'exec "{llvm}/{tool}" "$@"\n')
    sdk_inc = WINSYSROOT / "Windows Kits" / "10" / "Include"
    sdkver = sorted(p.name for p in sdk_inc.iterdir())[-1]
    _write_exec(WRAPPERS / "rc", head + f'''# rc.exe-compatible front-end for llvm-rc (qmake: rc /NOLOGO -D.. -fo out in.rc)
out=""; in=""; defs=""; next_out=0
for a in "$@"; do
  if [ $next_out = 1 ]; then out="$a"; next_out=0; continue; fi
  case "$a" in
    /NOLOGO|/nologo|-nologo) ;;
    -fo|/fo|-FO|/FO) next_out=1 ;;
    -D*|/D*) defs="$defs /D ${{a#??}}" ;;
    -I*|/I*) defs="$defs /I ${{a#??}}" ;;
    *) in="$a" ;;
  esac
done
# shellcheck disable=SC2086
exec "{llvm}/llvm-rc" /C 65001 /I "{sdk_inc}/{sdkver}/um" /I "{sdk_inc}/{sdkver}/shared" $defs /FO "$out" "$in"
''')
    write_text(stamp, wanted)
    ok(f"enveloppes prêtes dans {WRAPPERS}")
    return WRAPPERS


def make_import_libs(dlls, out_dir):
    """Generate MSVC import libraries (.lib) from the export tables of upstream DLLs."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    py = ensure_venv()
    for dll in dlls:
        name = Path(dll).stem
        deffile = out_dir / f"{name}.def"
        lib = out_dir / f"{name}.lib"
        if lib.exists() and lib.stat().st_mtime >= Path(dll).stat().st_mtime:
            continue
        run([py, TOOLS_DIR / "pe_exports_to_def.py", dll, deffile], quiet=True)
        run([WRAPPERS / "llvm-dlltool", "-m", "i386:x86-64", "-d", deffile, "-l", lib,
             "-D", Path(dll).name], quiet=True)
    ok(f"{len(dlls)} bibliothèques d'import générées dans {out_dir}")


def fix_nmake_inline_files(makefile):
    """qmake's MSVC link rule uses NMake inline files (@<< ... <<); rewrite them as
    GNU make response files so the cross build can be driven by GNU make."""
    lines = Path(makefile).read_text(encoding="utf-8").split("\n")
    out, i, n = [], 0, 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("\t") and line.rstrip().endswith("@<<"):
            body = []
            i += 1
            while i < len(lines) and lines[i].strip() != "<<":
                body.append(lines[i])
                i += 1
            n += 1
            # relatif au dossier de build (OBJECTS_DIR peut valoir « . » suivi d'un espace)
            rsp = f"auxi_{Path(makefile).name.lower().replace('.', '_')}_{n}.rsp"
            out.append(f"\t@rm -f {rsp}")
            for b in body:
                for tok in b.split():
                    out.append(f"\t@printf '%s\\n' '{tok}' >> {rsp}")
            out.append(line.rstrip()[:-3] + "@" + rsp)
            i += 1
            continue
        out.append(line)
        i += 1
    Path(makefile).write_text("\n".join(out), encoding="utf-8")
    return n


def qt_cross_conf(qt_windows, qt_host, dest):
    """qt.conf letting the Linux host qmake evaluate projects for the MSVC Qt."""
    return write_text(dest, f"""[Paths]
Prefix={qt_windows}
HostPrefix={qt_host}
HostData={qt_windows}
HostBinaries={qt_host}/bin
HostLibraries={qt_host}/lib
TargetSpec=win32-clang-msvc
HostSpec=linux-g++
""")


def check_imports(exe, dll_dirs):
    """Fail if the cross-built binary imports a symbol missing from the shipped DLLs."""
    py = ensure_venv()
    run([py, TOOLS_DIR / "check_pe_imports.py", exe, *dll_dirs])
