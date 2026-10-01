# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Toolchain provisioning: Python venv (aqtinstall), Qt SDKs matching the Qt
shipped by upstream, host build dependency checks and the optional "local deps"
mode for hosts without root (Debian/Ubuntu packages extracted into .toolchains)."""

import os
import subprocess
import sys
from pathlib import Path

from .common import (IS_WINDOWS_HOST, TOOLCHAINS_DIR, download, fail, info, lock, ok, rmtree, run,
                     step, warn, which, write_text)

VENV_DIR = TOOLCHAINS_DIR / "venv"
QT_DIR = TOOLCHAINS_DIR / "qt"
SYSDEPS_DIR = TOOLCHAINS_DIR / "sysdeps"

# Debian/Ubuntu packages needed to build the Linux shell and AuxiText.
LINUX_BUILD_PACKAGES = [
    "build-essential", "pkg-config", "git", "curl", "python3", "nodejs", "npm",
    "libgtk-3-dev", "libglib2.0-dev", "libnotify-dev", "libcups2-dev", "libx11-dev",
    "libx11-xcb-dev", "libxcb1-dev", "libxext-dev", "libdbus-1-dev", "libpulse-dev",
    "libgl-dev", "libatk1.0-dev",
]
LINUX_PKGCONFIG_MODULES = ["gtk+-3.0", "glib-2.0", "atk", "gtk+-unix-print-3.0", "xcb", "xext",
                           "libnotify", "dbus-1", "x11", "x11-xcb", "cups", "libpulse",
                           "libpulse-mainloop-glib"]
# -dev packages that may be missing on a non-root host; extracted locally by --local-deps.
LOCAL_DEV_PACKAGES = ["libnotify-dev", "libcups2-dev", "libcupsimage2-dev", "libx11-xcb-dev",
                      "libpulse-dev", "libpulse-mainloop-glib0"]


def venv_python():
    return VENV_DIR / ("Scripts/python.exe" if IS_WINDOWS_HOST else "bin/python")


def ensure_venv():
    """Private venv for build helpers (aqtinstall, pefile)."""
    py = venv_python()
    if py.exists():
        probe = subprocess.run([str(py), "-c", "import aqt, pefile"], capture_output=True)
        if probe.returncode == 0:
            return py
    step("Environnement Python des outils de build")
    rmtree(VENV_DIR)
    res = subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], capture_output=True, text=True)
    if res.returncode != 0:
        # Debian without python3-venv/ensurepip: bootstrap pip ourselves.
        warn("ensurepip indisponible, amorçage de pip via get-pip.py")
        rmtree(VENV_DIR)
        run([sys.executable, "-m", "venv", "--without-pip", VENV_DIR])
        getpip = download("https://bootstrap.pypa.io/get-pip.py", TOOLCHAINS_DIR / "get-pip.py")
        run([venv_python(), getpip, "-q"])
    run([venv_python(), "-m", "pip", "install", "-q", "aqtinstall==3.3.0", "pefile==2024.8.26"])
    ok("venv prêt")
    return venv_python()


def qt_arch_dir(arch):
    # aqtinstall installs win64_msvc2019_64 into msvc2019_64
    return arch.replace("win64_", "")


def ensure_qt(key):
    """Install the Qt SDK described by upstream.lock.json toolchains[key]."""
    spec = lock()["toolchains"][key]
    target = QT_DIR / spec["version"] / qt_arch_dir(spec["arch"])
    marker = target / "include" / "QtCore" / "qglobal.h"
    if marker.exists():
        return target
    step(f"Qt {spec['version']} {spec['arch']} ({spec['host']})")
    py = ensure_venv()
    run([py, "-m", "aqt", "install-qt", spec["host"], "desktop", spec["version"], spec["arch"],
         "-O", QT_DIR], cwd=TOOLCHAINS_DIR)
    if not marker.exists():
        fail(f"installation Qt incomplète dans {target}")
    ok(f"Qt installée dans {target}")
    return target


# ---------------------------------------------------------------------------
# Host dependency checks ("doctor")
# ---------------------------------------------------------------------------

def _pkgconfig_ok(module, env):
    return subprocess.run(["pkg-config", "--exists", module], env=env).returncode == 0


def linux_build_env(local_deps=False):
    """Environment additions for the Linux native build (pkg-config / linker paths
    of locally extracted -dev packages when --local-deps is used)."""
    env = {}
    if local_deps or (SYSDEPS_DIR / ".ready").exists():
        libdir = SYSDEPS_DIR / "usr" / "lib" / "x86_64-linux-gnu"
        pc = libdir / "pkgconfig"
        env["PKG_CONFIG_PATH"] = str(pc) + (":" + os.environ["PKG_CONFIG_PATH"] if os.environ.get("PKG_CONFIG_PATH") else "")
        env["LIBRARY_PATH"] = str(libdir) + (":" + os.environ["LIBRARY_PATH"] if os.environ.get("LIBRARY_PATH") else "")
        env["AUXI_SYSDEPS_LIBDIR"] = str(libdir)
    return env


def ensure_local_dev_packages():
    """Non-root hosts (Debian/Ubuntu): download missing -dev packages with
    'apt-get download' and extract them into .toolchains/sysdeps. Library
    symlinks are pointed at the system runtime libraries and .pc prefixes fixed."""
    if (SYSDEPS_DIR / ".ready").exists():
        return
    if not which("apt-get") or not which("dpkg-deb"):
        fail("--local-deps nécessite apt-get et dpkg-deb (Debian/Ubuntu)")
    step("Dépendances de développement locales (sans root)")
    debs = TOOLCHAINS_DIR / "debs"
    debs.mkdir(parents=True, exist_ok=True)
    run(["apt-get", "download", *LOCAL_DEV_PACKAGES], cwd=debs)
    for deb in debs.glob("*.deb"):
        run(["dpkg-deb", "-x", deb, SYSDEPS_DIR], quiet=True)
    libdir = SYSDEPS_DIR / "usr" / "lib" / "x86_64-linux-gnu"
    for link in libdir.glob("*.so"):
        if link.is_symlink() and not link.exists():
            target = os.readlink(link)
            system = Path("/usr/lib/x86_64-linux-gnu") / target
            if system.exists():
                link.unlink()
                link.symlink_to(system)
    for pc in (libdir / "pkgconfig").glob("*.pc"):
        text = pc.read_text()
        pc.write_text(text.replace("prefix=/usr\n", f"prefix={SYSDEPS_DIR}/usr\n", 1))
    write_text(SYSDEPS_DIR / ".ready", "ok\n")
    ok(f"paquets extraits dans {SYSDEPS_DIR}")


def doctor(target, local_deps=False):
    """Check the build host. Returns the list of problems (empty = OK)."""
    step(f"Vérification de l'hôte de build (cible {target})")
    problems = []
    tools = ["git", "python3" if not IS_WINDOWS_HOST else "python", "node", "npm"]
    if target == "linux":
        tools += ["make", "g++", "pkg-config", "dpkg-deb", "fakeroot"]
    for t in tools:
        if which(t):
            ok(f"{t} : {which(t)}")
        else:
            problems.append(f"outil manquant : {t}")
    node = which("node")
    if node:
        v = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
        major = int(v.lstrip("v").split(".")[0]) if v else 0
        if major < 18:
            problems.append(f"Node.js >= 18 requis (trouvé {v})")
    if target == "linux" and not IS_WINDOWS_HOST:
        env = dict(os.environ)
        env.update(linux_build_env(local_deps))
        missing = [m for m in LINUX_PKGCONFIG_MODULES if not _pkgconfig_ok(m, env)]
        if missing:
            problems.append("modules pkg-config manquants : " + ", ".join(missing)
                            + "\n      -> sudo apt install " + " ".join(LINUX_BUILD_PACKAGES)
                            + "\n      -> ou relancer avec --local-deps (sans root, Debian/Ubuntu)")
        else:
            ok("en-têtes de développement GTK/X11/CUPS/D-Bus/PulseAudio présents")
    for p in problems:
        warn(p)
    return problems
