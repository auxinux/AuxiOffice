# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Developer workflow for the patch queues (see docs/UPSTREAM.md).

    python3 scripts/auxibuild patches checkout <dépôt>   # worktree de travail
    python3 scripts/auxibuild patches export <dépôt>     # réécrit patches/<dépôt>/
    python3 scripts/auxibuild patches status             # état des files de patches

'checkout' creates build/patch-dev/<repo>, a git worktree of the pinned upstream
checkout where branch 'auxinux-dev' = pinned commit + one commit per patch
('git am'). Edit, commit (one commit = one patch), then 'export' regenerates
patches/<repo>/NNNN-*.patch with 'git format-patch'. The build checkout in
upstream/src/ is never modified by this workflow."""

import os
import subprocess

from .common import BUILD_DIR, ROOT, UPSTREAM_SRC, fail, info, lock, ok, run, step, warn
from .patching import PATCHES_DIR, patch_queue

DEV_DIR = BUILD_DIR / "patch-dev"
BRANCH = "auxinux-dev"
AUTHOR_NAME = "Projet AuxiNux"
AUTHOR_EMAIL = "repo@auxinux.ca"


def _git(repo_dir, *args, capture=False):
    env = {"GIT_COMMITTER_NAME": AUTHOR_NAME, "GIT_COMMITTER_EMAIL": AUTHOR_EMAIL}
    return run(["git", "-C", repo_dir, *args], env=env, capture=capture, quiet=True)


def _pinned(repo):
    repos = lock()["repositories"]
    if repo not in repos:
        fail(f"dépôt inconnu : {repo} (dépôts : {', '.join(sorted(repos))})")
    if not (UPSTREAM_SRC / repo / ".git").exists():
        fail(f"source {repo} absente : lancer d'abord l'étape 'fetch'")
    return repos[repo]["commit"]


def checkout(repo):
    commit = _pinned(repo)
    work = DEV_DIR / repo
    step(f"Worktree de développement des patches : {repo}")
    if work.exists():
        status = _git(work, "status", "--porcelain", capture=True).stdout.strip()
        if status:
            fail(f"{work} contient des modifications non commitées : les commiter ou les supprimer d'abord")
        _git(UPSTREAM_SRC / repo, "worktree", "remove", "--force", work)
    _git(UPSTREAM_SRC / repo, "worktree", "prune")
    _git(UPSTREAM_SRC / repo, "worktree", "add", "-f", "-B", BRANCH, work, commit)
    queue = patch_queue(repo)
    if queue:
        res = run(["git", "-C", work, "am", "--keep-cr", "--committer-date-is-author-date", *queue],
                  env={"GIT_COMMITTER_NAME": AUTHOR_NAME, "GIT_COMMITTER_EMAIL": AUTHOR_EMAIL},
                  check=False, quiet=True)
        if res.returncode != 0:
            fail(f"la file de patches de {repo} ne s'applique pas : résoudre le conflit dans {work} "
                 "('git am --show-current-patch', corriger, 'git add', 'git am --continue') puis 'export'")
    ok(f"{work} : branche {BRANCH} = {commit[:12]} + {len(queue)} patch(es)")
    info("Modifier, puis commiter (un commit = un patch, auteur « Projet AuxiNux »), "
         f"puis : python3 scripts/auxibuild patches export {repo}")


def export(repo):
    commit = _pinned(repo)
    work = DEV_DIR / repo
    if not work.exists():
        fail(f"pas de worktree {work} : lancer d'abord 'patches checkout {repo}'")
    if _git(work, "status", "--porcelain", "--untracked-files=no", capture=True).stdout.strip():
        fail(f"{work} contient des modifications non commitées")
    step(f"Export de la file de patches : {repo}")
    out = PATCHES_DIR / repo
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.patch"):
        old.unlink()
    _git(work, "format-patch", "--zero-commit", "--no-signature", "--no-numbered",
         "-o", out, f"{commit}..{BRANCH}")
    queue = patch_queue(repo)
    ok(f"{len(queue)} patch(es) écrit(s) dans {out.relative_to(ROOT)}")
    for p in queue:
        info(p.name)


def status():
    step("Files de patches AuxiNux")
    for repo, spec in sorted(lock()["repositories"].items()):
        queue = patch_queue(repo)
        work = DEV_DIR / repo
        line = f"{repo:16} {spec['commit'][:12]}  {len(queue)} patch(es)"
        if work.exists():
            ahead = subprocess.run(["git", "-C", str(work), "rev-list", "--count", f"{spec['commit']}..{BRANCH}"],
                                   capture_output=True, text=True).stdout.strip()
            line += f"  — worktree {work.relative_to(ROOT)} ({ahead} commit(s))"
            if ahead and int(ahead) != len(queue):
                warn(f"{repo} : {ahead} commit(s) dans le worktree mais {len(queue)} patch(es) exportés")
        print("    " + line)


def run_patches(extra):
    action = extra[0] if extra else "status"
    if action == "status":
        return status()
    if action in ("checkout", "export"):
        if len(extra) != 2:
            fail(f"usage : auxibuild patches {action} <dépôt>")
        return checkout(extra[1]) if action == "checkout" else export(extra[1])
    fail(f"action inconnue : {action} (checkout, export, status)")
