#!/bin/sh
# Compile et lance AuxiText (éditeur de texte) en mode développement.
#   scripts/dev-text.sh [fichier…]
# AuxiText ne dépend ni de LibreOffice ni du reste de la suite.
# AUXI_DEBUG=1 : compilation de débogage (plus rapide à compiler).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

missing=""
for tool in cargo npm; do
  command -v "$tool" >/dev/null || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "Outils manquants :$missing — voir BUILD.md (Rust via rustup, Node.js 22+)." >&2
  exit 1
fi

echo "== Interface d'AuxiText"
(cd text && { [ -d node_modules ] || npm install --no-audit --no-fund; } && npm run --silent build)

PROFILE=release
FLAG=--release
if [ -n "${AUXI_DEBUG:-}" ]; then PROFILE=debug; FLAG=; fi
echo "== AuxiText ($PROFILE)"
cargo build $FLAG -p auxitext --features custom-protocol

echo "== Lancement d'AuxiText"
exec "$ROOT/target/$PROFILE/auxitext" "$@"
