# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Fetch pinned upstream sources (git, shallow + sparse, verified commit) and
pinned upstream binary releases (verified SHA-256)."""

from pathlib import Path

from .common import (BUILD_DIR, CACHE_DIR, UPSTREAM_SRC, download, extract_deb, extract_tar,
                     extract_zip, fail, info, lock, ok, rmtree, run, step, write_text)

ENGINE_DIR = BUILD_DIR / "engine"
THIRD_PARTY_DIR = BUILD_DIR / "third_party"

# Which upstream repositories each build feature needs.
FEATURE_REPOS = {
    "legal": ["DesktopEditors", "sdkjs"],
    "shell": ["desktop-apps", "desktop-sdk", "core"],
    "startpage": ["desktop-apps"],
    "webapps": ["web-apps"],
    "sdkjs-source": ["sdkjs"],
    "engine-source": ["build_tools"],
}


def _git(repo_dir, *args, check=True, capture=False):
    return run(["git", "-C", repo_dir, *args], check=check, capture=capture, quiet=capture)


def head_commit(repo_dir):
    return _git(repo_dir, "rev-parse", "HEAD", capture=True).stdout.strip()


def fetch_repo(name, spec, full=False):
    """Shallow-fetch exactly the pinned commit. Sparse repositories only check out
    the listed paths (partial clone), which keeps e.g. 'core' small. 'full'
    disables the sparse set used when a repository is only needed for its legal files."""
    dest = UPSTREAM_SRC / name
    commit = spec["commit"]
    sparse = spec.get("sparse") or (None if full else spec.get("sparse_when_not_built"))
    wanted_sparse = "\n".join(sparse) + "\n" if sparse else ""
    sparse_file = dest / ".git" / "info" / "sparse-checkout"
    if (dest / ".git").exists():
        current = head_commit(dest)
        current_sparse = sparse_file.read_text() if sparse_file.exists() and _git(
            dest, "config", "core.sparseCheckout", check=False, capture=True).stdout.strip() == "true" else ""
        if current == commit and current_sparse == wanted_sparse:
            ok(f"{name} déjà à {commit[:12]}")
            return dest
        info(f"{name} : {current[:12]} -> {commit[:12]}")
        if not sparse:
            _git(dest, "config", "core.sparseCheckout", "false")
    else:
        dest.mkdir(parents=True, exist_ok=True)
        _git(dest, "init", "-q")
        _git(dest, "remote", "add", "origin", spec["url"])
        _git(dest, "config", "advice.detachedHead", "false")
    # Sources telles que publiées (LF) quel que soit l'hôte : sinon, avec Git pour Windows
    # (core.autocrlf=true), les patches AuxiNux ne s'appliqueraient plus.
    _git(dest, "config", "core.autocrlf", "false")
    if sparse:
        _git(dest, "config", "core.sparseCheckout", "true")
        _git(dest, "config", "core.sparseCheckoutCone", "false")
        write_text(dest / ".git" / "info" / "sparse-checkout", "\n".join(sparse) + "\n")
        _git(dest, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit)
    else:
        _git(dest, "fetch", "-q", "--depth", "1", "origin", commit)
    _git(dest, "checkout", "-q", "--force", commit)
    if not sparse:
        _git(dest, "read-tree", "-mu", "HEAD")   # repeuple un checkout auparavant partiel
    got = head_commit(dest)
    if got != commit:
        fail(f"{name} : commit obtenu {got} différent du verrou {commit}")
    ok(f"{name} @ {commit[:12]} ({spec['ref']})")
    return dest


def repos_for(features):
    names = []
    for f in features:
        for r in FEATURE_REPOS.get(f, []):
            if r not in names:
                names.append(r)
    return names


def fetch_sources(features):
    step("Récupération des sources upstream épinglées")
    spec = lock()["repositories"]
    for name in repos_for(features):
        fetch_repo(name, spec[name], full=(name == "sdkjs" and "sdkjs-source" in features))


def reset_repo(name, clean_ignored=False):
    """Bring a checkout back to the pinned pristine state (drops patches/branding).
    Ignored files (node_modules, build outputs) are kept unless clean_ignored."""
    dest = UPSTREAM_SRC / name
    if not (dest / ".git").exists():
        fail(f"source {name} absente : lancer d'abord l'étape 'fetch'")
    commit = lock()["repositories"][name]["commit"]
    _git(dest, "checkout", "-q", "--force", commit)
    _git(dest, "reset", "-q", "--hard", commit)
    _git(dest, "clean", "-q", "-fd" + ("x" if clean_ignored else ""))


def engine_dir(target):
    return ENGINE_DIR / target


def fetch_engine(target):
    """Download + verify + extract the upstream binary release used as engine."""
    key = {"linux": "linux_x86_64", "windows": "windows_x64", "macos": "macos_arm64"}[target]
    spec = lock()["binaries"][key]
    step(f"Moteur upstream précompilé ({target})")
    filename = spec["url"].rsplit("/", 1)[-1]
    archive = download(spec["url"], CACHE_DIR / filename, sha256=spec["sha256"], size=spec.get("size"))
    out = engine_dir(target)
    marker = out / ".auxi-engine-sha256"
    if marker.exists() and marker.read_text().strip() == spec["sha256"] and (out / ".auxi-manifest").exists():
        ok(f"moteur déjà extrait dans {out}")
        return out
    rmtree(out)
    tmp = out.parent / (out.name + ".extract")
    rmtree(tmp)
    if spec["format"] == "deb":
        extract_deb(archive, tmp)
    elif spec["format"] == "zip":
        extract_zip(archive, tmp)
    elif spec["format"] == "dmg":
        from .macos import extract_dmg
        extract_dmg(archive, tmp)
    else:
        fail(f"format inconnu {spec['format']}")
    root = tmp / spec["root"] if spec["root"] else tmp
    root.rename(out)
    rmtree(tmp)
    # Manifeste de la release vérifiée : l'assemblage ne copiera que ces entrées
    # (aucun fichier parasite ajouté après l'extraction ne peut se retrouver dans un paquet).
    entries = sorted(str(p.relative_to(out)) for p in out.rglob("*"))
    write_text(out / ".auxi-manifest", "\n".join(entries) + "\n")
    write_text(marker, spec["sha256"] + "\n")
    ok(f"moteur extrait dans {out}")
    return out


def fetch_icu_headers():
    """ICU 74 headers matching the libicuuc 74 shipped by upstream."""
    spec = lock()["third_party_sources"]["icu4c"]
    out = THIRD_PARTY_DIR / "icu74"
    marker = out / ".auxi-sha256"
    if marker.exists() and marker.read_text().strip() == spec["sha256"]:
        return out / "include"
    archive = download(spec["url"], CACHE_DIR / spec["url"].rsplit("/", 1)[-1], sha256=spec["sha256"])
    rmtree(out)
    tmp = THIRD_PARTY_DIR / "icu74.extract"
    rmtree(tmp)
    extract_tar(archive, tmp, members_prefix=["icu/source/common/unicode/", "icu/source/i18n/unicode/",
                                              "icu/LICENSE"])
    inc = out / "include" / "unicode"
    inc.mkdir(parents=True)
    for sub in ("common", "i18n"):
        for h in (tmp / "icu" / "source" / sub / "unicode").glob("*.h"):
            h.rename(inc / h.name)
    (tmp / "icu" / "LICENSE").rename(out / "LICENSE")
    rmtree(tmp)
    write_text(marker, spec["sha256"] + "\n")
    ok("en-têtes ICU 74 prêts")
    return out / "include"
