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

missing=""
for tool in cargo npm python3 curl; do
  command -v "$tool" >/dev/null || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "Outils manquants :$missing — voir BUILD.md (Rust via rustup, Node.js 22+, outils Xcode sur Mac)." >&2
  exit 1
fi

# Moteur absent ou d'une autre version que celle épinglée : (re)télécharger.
wanted=$(python3 -c "import json;print(json.load(open('engine/libreoffice.lock.json'))['version'])")
installed=$(cat ".engine/$PLATFORM/version" 2>/dev/null || true)
if [ "$PLATFORM" = macos-aarch64 ]; then
  # Mac : le LibreOffice officiel ne sait pas dessiner les pages pour un
  # autre programme ; le moteur est compilé une fois (1 à 3 heures).
  if [ "$installed" != "$wanted" ] || [ "$(cat .engine/$PLATFORM/variant 2>/dev/null)" != headless ]; then
    echo "== Moteur LibreOffice $wanted pour Mac : compilation (une seule fois, 1 à 3 heures)"
    scripts/build-engine-macos.sh
  fi
elif [ ! -f ".engine/$PLATFORM/program-dir" ] || [ "$installed" != "$wanted" ]; then
  echo "== Moteur LibreOffice $wanted"
  scripts/fetch-engine.sh
fi

echo "== Interface"
(cd app && { [ -d node_modules ] || npm install --no-audit --no-fund; } && npm run --silent build)

# Compilation optimisée (--release) : le code Rust convertit chaque tuile
# affichée ; en mode débogage, l'ouverture et le défilement sont nettement
# plus lents. AUXI_DEBUG=1 pour une compilation de débogage.
PROFILE=release
FLAG=--release
if [ -n "${AUXI_DEBUG:-}" ]; then PROFILE=debug; FLAG=; fi
echo "== Moteur et coque ($PROFILE)"
cargo build $FLAG -p auxi-engine
cargo build $FLAG -p auxioffice --features custom-protocol

export AUXI_ENGINE_EXE="$ROOT/target/$PROFILE/auxi-engine"
export AUXI_LO_PROGRAM="$(cat ".engine/$PLATFORM/program-dir")"
export AUXI_TEMPLATES="$ROOT/app/src-tauri/templates"
echo "== Lancement d'AuxiOffice"
exec "$ROOT/target/$PROFILE/auxioffice" "$@"
