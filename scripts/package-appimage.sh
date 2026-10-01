#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
#
# Construit dist/linux/AuxiNuxOffice-<version>-x86_64.AppImage à partir d'un build Linux existant
# (./scripts/build-linux.sh). L'arbre d'installation est d'abord réassemblé.
#
#   ./scripts/package-appimage.sh [--local-deps]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$ROOT/scripts/auxibuild" assemble --target linux "$@"
exec python3 "$ROOT/scripts/auxibuild" package --target linux --formats appimage "$@"
