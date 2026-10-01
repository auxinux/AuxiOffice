# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Apply the AuxiNux patch queues to the pristine upstream checkouts.

Layout: patches/<upstream-repo>/NNNN-short-description.patch (git format),
applied in lexical order with 'git apply'. Every patch must apply cleanly:
a conflict stops the build (see docs/UPSTREAM.md for the refresh procedure)."""

from pathlib import Path

from .common import ROOT, UPSTREAM_SRC, fail, info, ok, run, step
from .fetch import reset_repo

PATCHES_DIR = ROOT / "patches"


def patch_queue(repo):
    d = PATCHES_DIR / repo
    return sorted(d.glob("*.patch")) if d.is_dir() else []


def apply_patches(repos, clean_ignored=False):
    step("Application des patches AuxiNux")
    for repo in repos:
        if not (UPSTREAM_SRC / repo / ".git").exists():
            continue
        reset_repo(repo, clean_ignored=clean_ignored)
        queue = patch_queue(repo)
        for patch in queue:
            res = run(["git", "-C", UPSTREAM_SRC / repo, "apply", "--check", "--whitespace=nowarn", patch],
                      check=False, capture=True, quiet=True)
            if res.returncode != 0:
                print(res.stderr)
                fail(f"le patch {patch.relative_to(ROOT)} ne s'applique pas sur {repo} "
                     f"(conflit upstream ?) — voir docs/UPSTREAM.md, section « Conflits »")
            run(["git", "-C", UPSTREAM_SRC / repo, "apply", "--whitespace=nowarn", patch], quiet=True)
            info(f"{repo} <- {patch.name}")
        ok(f"{repo} : {len(queue)} patch(es) appliqué(s)")
