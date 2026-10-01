# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Build pipeline: upstream -> patches -> branding -> build -> assemble -> tests -> packages."""

from . import common
from .common import BUILD_DIR, fail, ok, rmtree, step, warn


def features(args):
    f = ["legal", "shell", "startpage", "webapps"]
    if args.sdkjs == "source":
        f.append("sdkjs-source")
    return f


def stage_doctor(args):
    from .toolchain import doctor, ensure_local_dev_packages
    if args.local_deps and args.target == "linux":
        ensure_local_dev_packages()
    problems = doctor(args.target, local_deps=args.local_deps)
    if problems:
        fail(f"{len(problems)} problème(s) sur l'hôte de build (voir ci-dessus et BUILD.md)")
    ok("hôte de build conforme")


def stage_fetch(args):
    from .fetch import fetch_sources, fetch_engine, fetch_icu_headers
    fetch_sources(features(args))
    fetch_engine(args.target)
    fetch_icu_headers()


def stage_prepare(args):
    from .patching import apply_patches
    from .fetch import repos_for
    from . import branding
    repos = repos_for(features(args))
    apply_patches(repos, clean_ignored=args.clean)
    branding.apply(args)


def stage_build(args):
    from . import build_js, build_native
    build_js.build_all(args)
    build_native.build_all(args)


def stage_assemble(args):
    from . import assemble
    assemble.assemble(args)


def stage_test(args):
    if args.skip_tests:
        warn("tests ignorés à la demande (--skip-tests) : les artefacts ne sont PAS validés")
        return
    from . import testing
    testing.run_all(args)


def stage_package(args):
    if args.target == "linux":
        from . import package_linux
        package_linux.package(args)
    else:
        from . import package_windows
        package_windows.package(args)


def stage_clean(args):
    step("Nettoyage des arbres de build")
    for d in (BUILD_DIR / "stage" / args.target, BUILD_DIR / "native" / args.target, BUILD_DIR / "js"):
        rmtree(d)
        ok(f"supprimé : {d}")


STAGE_FUNCS = {
    "doctor": stage_doctor,
    "fetch": stage_fetch,
    "prepare": stage_prepare,
    "build": stage_build,
    "assemble": stage_assemble,
    "test": stage_test,
    "package": stage_package,
    "clean": stage_clean,
}

ALL = ["doctor", "fetch", "prepare", "build", "assemble", "test", "package"]


def run_command(args):
    if args.command == "all":
        if args.clean:
            stage_clean(args)
        for name in ALL:
            STAGE_FUNCS[name](args)
    else:
        STAGE_FUNCS[args.command](args)
