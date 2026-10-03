# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Assemble the installable AuxiNux Office tree for one platform:

  pinned upstream engine (x2t, core libraries, CEF, Qt, dictionaries, fonts, sdkjs)
  - upstream shell, start page, editors UI, update service, privacy-unfriendly plugins
  + AuxiNux shell, start page, editors UI, AuxiText, launcher, x2t guard, legal files
  + privacy hardening of the web layers (privacy.py)

The result (build/stage/<target>/auxioffice) is what the packages install."""

import os
import shutil
import stat
from pathlib import Path

from .common import BUILD_DIR, fail, info, ok, product, rmtree, run, step, warn, write_text
from .fetch import engine_dir
from .legal import install_legal_files

NATIVE = BUILD_DIR / "native"
JS = BUILD_DIR / "js"

# Fichiers upstream remplacés ou retirés (chemins relatifs à la racine du moteur)
UPSTREAM_REMOVED = {
    "linux": ["DesktopEditors", "index.html", "LICENSE.txt", "editors/web-apps", "editors/webext/noconnect.html",
              ".auxi-engine-sha256",
              # plugin Qt livré par upstream sans ses dépendances (QtQml/QtQuick) : ne peut pas se charger
              "platforminputcontexts/libqtvirtualkeyboardplugin.so"],
    "windows": ["DesktopEditors.exe", "editors.exe", "updatesvc.exe", "app.ico", "index.html",
                "editors/web-apps", "editors/webext/noconnect.html", ".auxi-engine-sha256"],
}
BINARIES = {
    "linux": ["auxioffice", "auxioffice-editors", "auxitext"],
    "windows": ["auxioffice.exe", "auxioffice-editors.exe", "auxitext.exe"],
}
# Garde AuxiNux installée à la place du convertisseur (src/x2tguard) : elle interdit à x2t tout
# téléchargement (ressources distantes des documents), puis exécute x2t-engine.
X2T_GUARD = {"linux": ("x2t-guard", "x2t", "x2t-engine"),
             "windows": ("x2t-guard.exe", "x2t.exe", "x2t-engine.exe")}


def install_x2t_guard(converter, guard, name, engine_name):
    """converter/<name> (x2t d'upstream) -> converter/<engine_name> ; la garde prend sa place."""
    upstream_x2t = converter / name
    if not upstream_x2t.exists() or not Path(guard).exists():
        fail(f"convertisseur ou garde absent : {upstream_x2t}, {guard}")
    upstream_x2t.rename(converter / engine_name)
    shutil.copy2(guard, upstream_x2t)
    upstream_x2t.chmod(0o755)
    info(f"garde réseau installée : {upstream_x2t.name} -> {engine_name}")


# Traqueurs connus : leur présence dans un fichier livré bloque l'emballage.
FORBIDDEN_TRACKERS = (b"google-analytics.com", b"googletagmanager.com", b"doubleclick.net")
# Exception : le moteur web Chromium (CEF) contient ces domaines dans ses tables internes
# (listes de domaines connus, règles du préchargement et des cookies tiers), sans code qui les
# contacte ; ses communications sont coupées par les commutateurs privacy.engine_switches.
TRACKER_SCAN_EXEMPT = {"libcef.so", "libcef.dll", "Chromium Embedded Framework"}


def _is_core_dump(path):
    """Vidage mémoire ELF (e_type ET_CORE) ou nommé core / core.<pid>."""
    name = path.name
    if name == "core" or (name.startswith("core.") and name[5:].isdigit()):
        return True
    try:
        with open(path, "rb") as fh:
            head = fh.read(18)
    except OSError:
        return False
    if len(head) < 18 or head[:4] != b"\x7fELF":
        return False
    order = "little" if head[5] == 1 else "big"
    return int.from_bytes(head[16:18], order) == 4


def shippable_problems(tree):
    """Fichiers qui ne doivent jamais être livrés : vidages mémoire (environnement et mémoire
    de la machine de build) et code de traçage connu."""
    problems = []
    for f in sorted(Path(tree).rglob("*")):
        if f.is_symlink() or not f.is_file():
            continue
        if _is_core_dump(f):
            problems.append(f"vidage mémoire : {f}")
            continue
        if f.name in TRACKER_SCAN_EXEMPT:
            continue
        try:
            data = f.read_bytes()
        except OSError:
            continue
        for marker in FORBIDDEN_TRACKERS:
            if marker in data:
                problems.append(f"traqueur {marker.decode()} : {f}")
    return problems


def check_shippable(tree):
    problems = shippable_problems(tree)
    for p in problems:
        warn(p)
    if problems:
        fail(f"{len(problems)} fichier(s) interdit(s) dans {tree} : emballage refusé")
    ok(f"aucun vidage mémoire ni traqueur connu dans {tree}")


def stage_dir(target):
    return BUILD_DIR / "stage" / target / "auxioffice"


def _copy_engine(src, dst):
    """Copie uniquement les entrées du manifeste de la release upstream vérifiée."""
    manifest = src / ".auxi-manifest"
    if not manifest.exists():
        fail("manifeste du moteur absent : relancer l'étape fetch")
    allowed = set(manifest.read_text(encoding="utf-8").splitlines())

    def ignore(directory, names):
        rel = Path(directory).relative_to(src)
        return [n for n in names if str(rel / n) not in allowed]
    shutil.copytree(src, dst, symlinks=True, ignore=ignore)


def assemble(args):
    target = args.target
    step(f"Assemblage de l'arbre d'installation ({target})")
    eng = engine_dir(target)
    if not eng.exists():
        fail("moteur upstream absent : lancer l'étape fetch")
    stage = stage_dir(target)
    rmtree(stage)
    stage.parent.mkdir(parents=True, exist_ok=True)
    _copy_engine(eng, stage)

    for rel in UPSTREAM_REMOVED[target]:
        rmtree(stage / rel)
    removed = product().get("privacy", {}).get("removed_plugins", {})
    for guid, label in removed.items():
        plugin = stage / "editors" / "sdkjs-plugins" / guid
        if plugin.exists():
            rmtree(plugin)
            info(f"plugin retiré (confidentialité) : {label}")

    for name in BINARIES[target]:
        src = NATIVE / target / "bin" / name
        if not src.exists():
            fail(f"binaire AuxiNux manquant : {src} (étape build)")
        shutil.copy2(src, stage / name)
        (stage / name).chmod(0o755)
    guard, name, engine_name = X2T_GUARD[target]
    install_x2t_guard(stage / "converter", NATIVE / target / "bin" / guard, name, engine_name)

    startpage = JS / "startpage"
    webapps = JS / "web-apps"
    for f in (startpage / "index.html", startpage / "noconnect.html", webapps / "apps"):
        if not f.exists():
            fail(f"sortie JS manquante : {f} (étape build, composant js)")
    shutil.copy2(startpage / "index.html", stage / "index.html")
    (stage / "editors" / "webext").mkdir(parents=True, exist_ok=True)
    shutil.copy2(startpage / "noconnect.html", stage / "editors" / "webext" / "noconnect.html")
    shutil.copytree(webapps, stage / "editors" / "web-apps", symlinks=True)

    if args.sdkjs == "source":
        sdk = JS / "sdkjs"
        if not sdk.exists():
            fail("sdkjs source demandé mais non construit")
        # Le sdkjs concaténé remplace le sdkjs compilé par upstream ; les ressources ajoutées
        # au déploiement upstream (thèmes, images locales) sont conservées.
        shutil.copytree(sdk, stage / "editors" / "sdkjs", dirs_exist_ok=True)
        for cache in (stage / "editors" / "sdkjs").rglob("sdk-all.bin"):
            cache.unlink()
        if target == "linux":
            run([stage / "converter" / "x2t", "-create-js-snapshots"], cwd=stage / "converter", check=False)

    from .privacy import harden
    harden(stage / "index.html", stage / "editors")

    write_text(stage / "converter" / "package.config", "package = auxinux\n")
    install_legal_files(stage, target)

    total = sum(f.stat().st_size for f in stage.rglob("*") if f.is_file() and not f.is_symlink())
    ok(f"arbre d'installation : {stage} ({total // (1024 * 1024)} Mio)")
