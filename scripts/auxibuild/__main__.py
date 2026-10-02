# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""AuxiNux Office build orchestrator.

    python3 scripts/auxibuild <commande> [options]

Commandes : doctor, fetch, prepare, build, assemble, test, package, all, clean,
patches (checkout|export|status <dépôt> : gestion des files de patches upstream).
Les scripts scripts/build-linux.sh et scripts/build-windows.ps1 l'appellent."""

import argparse
import os
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "auxibuild"

from auxibuild import common  # noqa: E402
from auxibuild.common import BuildError, step, ok, info, warn  # noqa: E402

STAGES = ["doctor", "fetch", "prepare", "build", "assemble", "test", "package"]


def parse_args(argv):
    p = argparse.ArgumentParser(prog="auxibuild", description="Build d'AuxiNux Office")
    p.add_argument("command", choices=STAGES + ["all", "clean", "patches"], help="étape à exécuter")
    p.add_argument("extra", nargs="*", help="patches : checkout <dépôt> | export <dépôt> | status")
    p.add_argument("--target", choices=["linux", "windows", "macos"], default="linux")
    p.add_argument("--mode", choices=["release", "debug"], default="release")
    p.add_argument("--clean", action="store_true", help="repartir de sources et d'arbres de build propres")
    p.add_argument("--jobs", "-j", type=int, default=os.cpu_count() or 4)
    p.add_argument("--local-deps", action="store_true",
                   help="hôte sans root : extraire localement les paquets -dev/LLVM manquants (Debian/Ubuntu)")
    p.add_argument("--accept-msvc-license", action="store_true",
                   default=os.environ.get("AUXI_ACCEPT_MSVC_LICENSE") == "1",
                   help="accepter les licences Microsoft du CRT MSVC/SDK Windows (compilation croisée)")
    p.add_argument("--sdkjs", choices=["upstream", "source"], default=os.environ.get("AUXI_SDKJS_MODE", "upstream"),
                   help="sdkjs compilé par upstream (défaut, minifié) ou concaténé depuis les sources")
    p.add_argument("--skip-tests", action="store_true", help="ne pas exécuter les tests (déconseillé)")
    p.add_argument("--components", default="js,shell,auxitext,launcher",
                   type=lambda v: [c.strip() for c in v.split(",") if c.strip()],
                   help="composants à construire : js (= startpage + webapps + sdkjs), startpage, webapps, sdkjs, shell, auxitext, launcher")
    p.add_argument("--formats", default="",
                   help="formats de paquets (linux: deb,appimage ; windows: exe,msi)")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    start = time.time()
    print(f"AuxiNux Office {common.version()} — cible {args.target} ({args.mode})")
    print(f"Hôte : {common.host_description()}")
    try:
        from auxibuild import pipeline
        pipeline.run_command(args)
    except BuildError as e:
        print(f"\nÉCHEC : {e}", file=sys.stderr)
        print("Le build n'est PAS terminé. Aucun artefact ne doit être considéré comme valide.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nInterrompu.", file=sys.stderr)
        return 130
    print(f"\nTerminé : '{args.command}' ({args.target}) en {int(time.time() - start)} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
