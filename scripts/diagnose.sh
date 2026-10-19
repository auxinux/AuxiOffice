#!/bin/sh
# Diagnostic du moteur d'AuxiOffice, sans l'interface :
#   scripts/diagnose.sh [document]
# Démarre le moteur, ouvre le document (par défaut le modèle vierge DOCX),
# rend la première page, saisit du texte, enregistre, exporte en PDF, puis
# ouvre, dessine (échelles 1 et 2) et ferme une boîte de dialogue de LibreOffice.
# Le journal complet est aussi écrit dans target/diagnostic.log.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) PLATFORM=linux-x86_64 ;;
  Darwin-arm64) PLATFORM=macos-aarch64 ;;
  *) echo "Plateforme non prise en charge" >&2; exit 1 ;;
esac
if [ ! -f ".engine/$PLATFORM/program-dir" ]; then
  if [ "$PLATFORM" = macos-aarch64 ]; then scripts/build-engine-macos.sh || exit 1; else scripts/fetch-engine.sh || exit 1; fi
fi
doc=${1:-$ROOT/app/src-tauri/templates/vierge.docx}
cargo build -q -p auxi-engine --bins --example probe || exit 1
mkdir -p target
{
  echo "== $(date) — $(uname -a)"
  echo "== moteur : $(cat ".engine/$PLATFORM/version" 2>/dev/null) $(cat ".engine/$PLATFORM/program-dir")"
  ./target/debug/examples/probe "$(cat ".engine/$PLATFORM/program-dir")" "$doc" "$ROOT/target/diagnostic.png"
  echo "== code de sortie : $?"
} 2>&1 | tee target/diagnostic.log
echo
echo "Journal : $ROOT/target/diagnostic.log   Images : $ROOT/target/diagnostic.png, $ROOT/target/diagnostic-dialogue.png"
