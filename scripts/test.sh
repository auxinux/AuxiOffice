#!/bin/sh
# Lance tous les tests d'AuxiOffice :
#  1. interface : vérification TypeScript + tests unitaires (vitest) ;
#  2. Rust : tests unitaires, puis tests d'intégration du moteur avec un vrai
#     LibreOffice (si AUXI_LO_PROGRAM ou .engine/ est disponible).
#
# Variables : AUXI_LO_PROGRAM (dossier program/ de LibreOffice),
#             AUXI_FIXTURES (documents de test ; générés sinon),
#             PYTHON (interpréteur avec python-docx, openpyxl, python-pptx, Pillow).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo "== Interface"
(cd app && npm run --silent typecheck && npx vitest run --reporter=dot)

if [ -z "${AUXI_LO_PROGRAM:-}" ]; then
  for f in .engine/*/program-dir; do
    [ -f "$f" ] && AUXI_LO_PROGRAM=$(cat "$f")
  done
fi
if [ -n "${AUXI_LO_PROGRAM:-}" ] && [ -z "${AUXI_FIXTURES:-}" ]; then
  AUXI_FIXTURES="$ROOT/target/fixtures"
  "${PYTHON:-python3}" tests/fixtures/generate.py "$AUXI_FIXTURES" >/dev/null || {
    echo "Génération des documents de test impossible (python-docx, openpyxl, python-pptx, Pillow requis)." >&2
    exit 1
  }
fi
export AUXI_LO_PROGRAM="${AUXI_LO_PROGRAM:-}" AUXI_FIXTURES="${AUXI_FIXTURES:-}"
[ -n "$AUXI_LO_PROGRAM" ] || { echo "AUXI_LO_PROGRAM absent : tests d'intégration du moteur ignorés (voir scripts/fetch-engine.sh)."; unset AUXI_LO_PROGRAM; }

echo "== Rust"
cargo test --workspace -- --test-threads=1
