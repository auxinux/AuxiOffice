#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
#
# Build complet d'AuxiNux Office pour Linux x86_64 (voir BUILD.md).
#
#   ./scripts/build-linux.sh [--clean] [--release|--debug] [--local-deps] [--skip-tests] [-j N]
#
# Étapes : vérification des dépendances, récupération des sources et du moteur upstream épinglés
# (upstream/upstream.lock.json), vérification des versions et sommes SHA-256, patches AuxiNux,
# branding, compilation, tests, paquets : dist/linux/auxinux-office_<version>_amd64.deb et
# dist/linux/AuxiNuxOffice-<version>-x86_64.AppImage.
#
#   --clean        repartir de sources et d'arbres de build propres
#   --release      build optimisé (défaut)
#   --debug        build avec symboles de débogage
#   --local-deps   hôte sans droits root : paquets -dev et outils manquants extraits localement
#   --skip-tests   ne pas exécuter les tests (les paquets ne sont alors PAS validés)
#   -j N           nombre de tâches de compilation parallèles
#
# Le script s'arrête au premier échec (code de sortie non nul) : aucun artefact n'est alors valide.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE=release
ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --clean) ARGS+=(--clean) ;;
        --release) MODE=release ;;
        --debug) MODE=debug ;;
        --local-deps) ARGS+=(--local-deps) ;;
        --skip-tests) ARGS+=(--skip-tests) ;;
        -j) shift; ARGS+=(-j "${1:?-j attend un nombre}") ;;
        -j*) ARGS+=("$1") ;;
        -h|--help) sed -n '5,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "build-linux.sh : option inconnue : $1 (voir --help)" >&2; exit 2 ;;
    esac
    shift
done

exec python3 "$ROOT/scripts/auxibuild" all --target linux --mode "$MODE" "${ARGS[@]}"
