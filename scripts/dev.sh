#!/bin/sh
# Compile et lance AuxiOffice en mode développement (Linux, macOS).
#   scripts/dev.sh [document]
# Au premier lancement : télécharge le moteur LibreOffice (environ 300 Mo)
# et installe les dépendances npm.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) PLATFORM=linux-x86_64 ;;
  Darwin-arm64) PLATFORM=macos-aarch64 ;;
  *) echo "Plateforme non prise en charge : $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

[ -f ".engine/$PLATFORM/program-dir" ] || scripts/fetch-engine.sh

echo "== Interface"
(cd app && { [ -d node_modules ] || npm install --no-audit --no-fund; } && npm run --silent build)

echo "== Moteur et coque"
cargo build -p auxi-engine
cargo build -p auxioffice --features custom-protocol

export AUXI_ENGINE_EXE="$ROOT/target/debug/auxi-engine"
export AUXI_LO_PROGRAM="$(cat ".engine/$PLATFORM/program-dir")"
export AUXI_TEMPLATES="$ROOT/app/src-tauri/templates"
echo "== Lancement d'AuxiOffice"
exec "$ROOT/target/debug/auxioffice" "$@"
