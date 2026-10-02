# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Build of the HTML/JS layers from the patched + branded upstream sources:
start page (desktop-apps/common/loginpage), editors (web-apps) and, optionally,
the sdkjs engine. These outputs are platform independent (shared by Linux and Windows)."""

import os
import shutil
import sys
from pathlib import Path

from .common import BUILD_DIR, UPSTREAM_SRC, fail, info, ok, product, rmtree, run, step, warn
from .branding_editors import webapps_env

JS_DIR = BUILD_DIR / "js"


def _npm_install(directory, log_dir):
    """Installe les dépendances de build (npm ci, reproductible grâce au package-lock).

    Aucun script d'installation de paquet n'est exécuté (--ignore-scripts) : ils téléchargent des
    programmes propres à chaque plateforme (PhantomJS, qui ne sert qu'aux tests d'upstream ; les
    optimiseurs d'images) et échouaient sur Mac. Seuls les optimiseurs d'images sont nécessaires :
    leur installation est lancée explicitement sous Linux, et remplacée par Homebrew sur Mac."""
    lock = directory / "package-lock.json"
    stamp = directory / "node_modules" / ".auxi-lock"
    wanted = (lock.read_text(encoding="utf-8") if lock.exists() else "") + "\n--ignore-scripts v1\n"
    if not (stamp.exists() and stamp.read_text(encoding="utf-8") == wanted):
        run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=directory,
            log_file=log_dir / "npm-ci.log")
        _image_tools(directory, log_dir)
        stamp.write_text(wanted, encoding="utf-8")
    else:
        _image_tools(directory, log_dir)


# Optimiseurs d'images de grunt-contrib-imagemin : leurs binaires macOS téléchargés par npm sont
# des exécutables Intel (inutilisables sans Rosetta sur Apple Silicon) -> versions Homebrew natives.
MACOS_IMAGE_TOOLS = [("gifsicle", "gifsicle", "gifsicle"), ("optipng-bin", "optipng", "optipng"),
                     ("jpegtran-bin", "jpegtran", "jpeg-turbo")]


def _package_copies(directory, package):
    modules = directory / "node_modules"
    return [d for d in [modules / package, *modules.glob(f"**/node_modules/{package}")]
            if (d / "package.json").exists()]


def _image_tools(directory, log_dir):
    """Optimiseurs d'images de grunt-contrib-imagemin, avec un programme utilisable sur cet hôte."""
    from .common import IS_MACOS_HOST
    for package, binary, formula in MACOS_IMAGE_TOOLS:
        for pkg in _package_copies(directory, package):
            target = pkg / "vendor" / binary
            if IS_MACOS_HOST:
                res = run(["brew", "--prefix", formula], check=False, capture=True, quiet=True)
                native = Path(res.stdout.strip()) / "bin" / binary
                if res.returncode != 0 or not native.exists():
                    fail(f"{binary} introuvable : brew install {formula} (installé par ./build.sh)")
                target.parent.mkdir(exist_ok=True)
                if target.exists() or target.is_symlink():
                    target.unlink()
                target.symlink_to(native)
            elif not target.exists():
                run(["node", "lib/install.js"], cwd=pkg, log_file=log_dir / f"install-{package}.log")
            if not target.exists():
                fail(f"{binary} absent après installation ({target}) — voir {log_dir}")


# Variantes des éditeurs inutiles à l'application de bureau (supprimées après le build) :
# ne pas les construire évite un second « npm install » et webpack (éditeurs mobiles).
SKIPPED_DEPLOY_TASKS = ("deploy-app-mobile", "deploy-app-embed")


def _desktop_only_tasks(build_dir):
    import json
    for cfg in sorted(build_dir.glob("*.json")):
        try:
            data = json.loads(cfg.read_text(encoding="utf-8"))
        except ValueError:
            continue
        tasks = data.get("tasks", {}).get("deploy") if isinstance(data, dict) else None
        if isinstance(tasks, list) and any(t in tasks for t in SKIPPED_DEPLOY_TASKS):
            data["tasks"]["deploy"] = [t for t in tasks if t not in SKIPPED_DEPLOY_TASKS]
            cfg.write_text(json.dumps(data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")


def _grunt(directory, log_file, env=None, force=False):
    args = ["npx", "grunt"] + (["--force"] if force else [])
    run(args, cwd=directory, env=dict(env or {}, NODE_ENV="production"), log_file=log_file)
    text = Path(log_file).read_text(encoding="utf-8", errors="replace")
    warnings = [l for l in text.splitlines() if l.startswith("Warning:") or ">> Error" in l]
    for w in warnings[:10]:
        warn(f"grunt : {w}")
    if force and warnings:
        fail(f"grunt a signalé {len(warnings)} problème(s) — voir {log_file}")


def build_startpage(args):
    step("Page d'accueil (loginpage)")
    src = UPSTREAM_SRC / "desktop-apps" / "common" / "loginpage"
    logs = JS_DIR / "logs" / "startpage"
    _npm_install(src / "build", logs)
    _grunt(src / "build", logs / "grunt.log")
    out = JS_DIR / "startpage"
    rmtree(out)
    out.mkdir(parents=True)
    for name in ("index.html", "noconnect.html"):
        f = src / "deploy" / name
        if not f.exists():
            fail(f"sortie manquante : {f}")
        shutil.copy2(f, out / name)
    html = (out / "index.html").read_text(encoding="utf-8")
    if "AUXINUX_BRANDING" not in html or "auxinux" not in html:
        fail("la page d'accueil construite ne contient pas le module AuxiNux")
    ok(f"page d'accueil : {out / 'index.html'} ({(out / 'index.html').stat().st_size // 1024} Kio)")


def build_webapps(args):
    step("Éditeurs (web-apps)")
    src = UPSTREAM_SRC / "web-apps"
    logs = JS_DIR / "logs" / "web-apps"
    logs.mkdir(parents=True, exist_ok=True)
    run([sys.executable, "merge_and_check.py"], cwd=src / "translation", log_file=logs / "merge.log")
    _npm_install(src / "build", logs)
    _desktop_only_tasks(src / "build")
    env = webapps_env(product())
    _grunt(src / "build", logs / "grunt.log", env=env)
    deploy = src / "deploy" / "web-apps"
    if not (deploy / "apps" / "documenteditor" / "main" / "index.html").exists():
        fail("sortie web-apps incomplète")
    out = JS_DIR / "web-apps"
    rmtree(out)
    shutil.copytree(deploy, out, symlinks=True)
    # Comme le déploiement bureau upstream : pas de variantes ie/mobile/embed, pas de cartes
    # de sources ; l'aide hors ligne (documentation ONLYOFFICE) n'est pas livrée en 0.1.0.
    for root, dirs, files in os.walk(out / "apps"):
        for d in list(dirs):
            if d in ("ie", "mobile", "embed") or (d == "help" and Path(root).name == "resources"):
                shutil.rmtree(Path(root) / d)
                dirs.remove(d)
        for f in files:
            if f.endswith(".js.map"):
                (Path(root) / f).unlink()
    shutil.copy2(src / "apps" / "api" / "documents" / "index.html.desktop",
                 out / "apps" / "api" / "documents" / "index.html")
    leftovers = []
    for p in (out / "apps").rglob("*.js"):
        text = p.read_text(encoding="utf-8", errors="ignore")
        if "{{APP_TITLE_TEXT}}" in text or "{{PUBLISHER_NAME}}" in text:
            leftovers.append(str(p.relative_to(out)))
    if leftovers:
        fail("marqueurs de branding non remplacés : " + ", ".join(leftovers[:5]))
    ok(f"éditeurs : {out}")


def build_sdkjs(args):
    step("Moteur JS sdkjs (concaténation des sources)")
    src = UPSTREAM_SRC / "sdkjs"
    logs = JS_DIR / "logs" / "sdkjs"
    run(["python3", "build.py", "--minimize", "--desktop"], cwd=src / "build",
        env={"PRODUCT_VERSION": "9.4.0", "BUILD_NUMBER": "129"}, log_file=logs / "build.log")
    out = JS_DIR / "sdkjs"
    rmtree(out)
    shutil.copytree(src / "deploy" / "sdkjs", out)
    ok(f"sdkjs : {out}")


def build_all(args):
    wanted = set(args.components)
    if wanted & {"js", "startpage"}:
        build_startpage(args)
    if wanted & {"js", "webapps"}:
        build_webapps(args)
    if wanted & {"js", "sdkjs"} and args.sdkjs == "source":
        build_sdkjs(args)
