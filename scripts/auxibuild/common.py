# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Shared helpers for the AuxiNux Office build orchestrator: paths, logging,
command execution, downloads with checksum verification and archive handling."""

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _env_path(name, default):
    value = os.environ.get(name)
    return Path(value).resolve() if value else default


BUILD_DIR = _env_path("AUXI_BUILD_DIR", ROOT / "build")
UPSTREAM_SRC = _env_path("AUXI_UPSTREAM_SRC", ROOT / "upstream" / "src")
CACHE_DIR = _env_path("AUXI_CACHE_DIR", ROOT / "upstream" / "cache")
TOOLCHAINS_DIR = _env_path("AUXI_TOOLCHAINS_DIR", ROOT / ".toolchains")
DIST_DIR = _env_path("AUXI_DIST_DIR", ROOT / "dist")

IS_WINDOWS_HOST = os.name == "nt"


class BuildError(RuntimeError):
    """Raised when a build step fails. The CLI turns it into a non-zero exit code."""


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_USE_COLOR = sys.stdout.isatty() and not IS_WINDOWS_HOST


def _c(code, text):
    return f"\033[{code}m{text}\033[0m" if _USE_COLOR else text


def step(title):
    print(_c("1;34", f"\n==> {title}"), flush=True)


def info(msg):
    print(f"    {msg}", flush=True)


def ok(msg):
    print(_c("32", f"    [ok] {msg}"), flush=True)


def warn(msg):
    print(_c("33", f"    [attention] {msg}"), flush=True)


def fail(msg):
    raise BuildError(msg)


# ---------------------------------------------------------------------------
# Metadata (single sources of truth)
# ---------------------------------------------------------------------------

def version():
    """Product version, read from the VERSION file (single source of truth)."""
    v = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    parts = v.split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        fail(f"VERSION invalide : '{v}' (format attendu : MAJEUR.MINEUR.CORRECTIF)")
    return v


def version_tuple4(build_number=0):
    """Four-part numeric version for Windows resources: 0.1.0 -> (0, 1, 0, build)."""
    return tuple(int(p) for p in version().split(".")) + (int(build_number),)


def product():
    return json.loads((ROOT / "branding" / "product.json").read_text(encoding="utf-8"))


def lock():
    return json.loads((ROOT / "upstream" / "upstream.lock.json").read_text(encoding="utf-8"))


def build_number():
    """Optional CI build counter (AUXI_BUILD_NUMBER), 0 for local builds."""
    value = os.environ.get("AUXI_BUILD_NUMBER", "0")
    if not value.isdigit():
        fail(f"AUXI_BUILD_NUMBER doit être numérique (reçu '{value}')")
    return int(value)


def source_date_epoch():
    """Timestamp used for reproducible archives: SOURCE_DATE_EPOCH or the last git commit."""
    if os.environ.get("SOURCE_DATE_EPOCH", "").isdigit():
        return int(os.environ["SOURCE_DATE_EPOCH"])
    try:
        out = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%ct"],
                             capture_output=True, text=True, check=True).stdout.strip()
        return int(out)
    except Exception:
        return int(time.time())


# ---------------------------------------------------------------------------
# Process execution
# ---------------------------------------------------------------------------

def run(cmd, cwd=None, env=None, check=True, capture=False, quiet=False, log_file=None):
    """Run a command. Never hides failures: a non-zero exit raises BuildError
    (unless check=False). When log_file is given, output goes to that file and
    the tail is printed on failure."""
    cmd = [str(c) for c in cmd]
    full_env = os.environ.copy()
    if env:
        full_env.update({k: str(v) for k, v in env.items()})
    if not quiet:
        info("$ " + " ".join(cmd) + (f"   (dans {cwd})" if cwd else ""))
    if log_file:
        log_file = Path(log_file)
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with open(log_file, "w", encoding="utf-8", errors="replace") as fh:
            proc = subprocess.run(cmd, cwd=cwd, env=full_env, stdout=fh, stderr=subprocess.STDOUT)
        if check and proc.returncode != 0:
            lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
            errors = [l for l in lines if "error" in l.lower() and "warning" not in l.lower()][:25]
            for line in (errors or lines[-40:]):
                print("      | " + line)
            fail(f"commande en échec (code {proc.returncode}) : {' '.join(cmd[:3])}... — journal : {log_file}")
        return proc
    proc = subprocess.run(cmd, cwd=cwd, env=full_env, text=True,
                          capture_output=capture)
    if check and proc.returncode != 0:
        if capture:
            sys.stdout.write(proc.stdout or "")
            sys.stderr.write(proc.stderr or "")
        fail(f"commande en échec (code {proc.returncode}) : {' '.join(cmd)}")
    return proc


def which(name, extra_dirs=()):
    for d in extra_dirs:
        candidate = Path(d) / name
        if candidate.exists():
            return str(candidate)
    return shutil.which(name)


# ---------------------------------------------------------------------------
# Files, downloads, archives
# ---------------------------------------------------------------------------

def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url, dest, sha256=None, size=None):
    """Download url to dest (cached). The checksum is verified on every call:
    a corrupted or tampered cache entry is deleted and the build stops."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        tmp = dest.with_suffix(dest.suffix + ".part")
        info(f"téléchargement de {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "auxibuild"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
            shutil.copyfileobj(resp, out, 1 << 20)
        tmp.rename(dest)
    if size is not None and dest.stat().st_size != size:
        bad = dest.stat().st_size
        dest.unlink()
        fail(f"taille inattendue pour {dest.name} : {bad} (attendu {size}) — fichier supprimé")
    if sha256:
        actual = sha256_of(dest)
        if actual != sha256:
            dest.unlink()
            fail(f"somme SHA-256 invalide pour {dest.name} : {actual} (attendu {sha256}) — fichier supprimé")
        ok(f"{dest.name} vérifié (sha256 {sha256[:12]}…)")
    return dest


def extract_deb(deb_path, dest):
    """Extract the data archive of a .deb without dpkg (ar container + tar.{xz,gz,zst})."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with open(deb_path, "rb") as fh:
        if fh.read(8) != b"!<arch>\n":
            fail(f"{deb_path} n'est pas une archive .deb valide")
        while True:
            header = fh.read(60)
            if len(header) < 60:
                break
            name = header[0:16].decode().strip().rstrip("/")
            size = int(header[48:58].decode().strip())
            data_start = fh.tell()
            if name.startswith("data.tar"):
                if name.endswith(".zst"):
                    fail("data.tar.zst non pris en charge (installer python3-zstandard)")
                mode = "r:xz" if name.endswith(".xz") else "r:gz" if name.endswith(".gz") else "r:"
                import io
                payload = io.BytesIO(fh.read(size))
                with tarfile.open(fileobj=payload, mode=mode) as tar:
                    _safe_extract(tar, dest)
                return dest
            fh.seek(data_start + size + (size % 2))
    fail(f"aucune archive data.tar trouvée dans {deb_path}")


def _safe_extract(tar, dest):
    dest = Path(dest).resolve()
    for member in tar.getmembers():
        target = (dest / member.name).resolve()
        if not str(target).startswith(str(dest)):
            fail(f"chemin suspect dans l'archive : {member.name}")
    if sys.version_info >= (3, 12):
        tar.extractall(dest, filter="tar")
    else:
        tar.extractall(dest)


def extract_zip(zip_path, dest):
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            target = (dest / name).resolve()
            if not str(target).startswith(str(dest.resolve())):
                fail(f"chemin suspect dans l'archive : {name}")
        z.extractall(dest)
    return dest


def extract_tar(path, dest, members_prefix=None):
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(path) as tar:
        if members_prefix:
            members = [m for m in tar.getmembers() if any(m.name.startswith(p) for p in members_prefix)]
            for m in members:
                tar.extract(m, dest)
        else:
            _safe_extract(tar, dest)
    return dest


def rmtree(path):
    path = Path(path)
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def copytree(src, dst, symlinks=True):
    shutil.copytree(src, dst, symlinks=symlinks, dirs_exist_ok=True)


def write_text(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")
    return path


def host_description():
    return f"{platform.system()} {platform.release()} {platform.machine()} — Python {platform.python_version()}"
