#!/bin/sh
# macOS (Apple Silicon) : compile AuxiOffice et AuxiText en applications
# autonomes (.app) et, sur demande, leurs images disque d'installation (.dmg).
#
#   scripts/build-mac.sh                         → target/macos/AuxiOffice/ (AuxiOffice.app avec
#                                                  le moteur, AuxiWriter.app…, AuxiText.app)
#   scripts/build-mac.sh --auxitext              → target/macos/AuxiText/AuxiText.app seul
#   scripts/build-mac.sh --installer             → les deux, plus AuxiOffice-<version>-macos-arm64.dmg
#                                                  (la suite et AuxiText) et AuxiText-<version>-macos-arm64.dmg
#   scripts/build-mac.sh --auxitext --installer  → AuxiText et son .dmg
#   scripts/build-mac.sh --help                  → cette aide (aussi -h, -help)
#
# Installation : ouvrir le .dmg et glisser les applications dans Applications.
# AuxiWriter.app, AuxiSheet.app… utilisent le moteur d'AuxiOffice.app : elles
# doivent rester dans le même dossier.
#
# Les applications sont signées localement (« ad hoc ») : elles s'ouvrent sur le
# Mac qui les a compilées. Copiées sur un autre Mac, macOS les bloque au premier
# lancement (clic droit → Ouvrir, ou xattr -dr com.apple.quarantine <app>) ; une
# diffusion publique demande une signature Developer ID et une notarisation.
#
# Prérequis : Xcode (outils en ligne de commande), Rust, Node.js 22+ ; le moteur
# (sauf --auxitext) est compilé par scripts/build-engine-macos.sh s'il manque
# (1 à 3 h, une seule fois).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
. "$ROOT/scripts/lib/macos-apps.sh"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }

TEXT_ONLY=""
INSTALLER=""
for arg in "$@"; do
  case $(printf '%s' "$arg" | tr '[:upper:]' '[:lower:]') in
    --auxitext|-auxitext) TEXT_ONLY=1 ;;
    --installer|-installer|--installateur|-installateur) INSTALLER=1 ;;
    -h|--help|-help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "option inconnue : $arg (voir scripts/build-mac.sh --help)" ;;
  esac
done

[ "$(uname -s)" = Darwin ] || die "ce script se lance sous macOS (Windows : scripts/build-win.sh, Linux : scripts/build-deb.sh)"
[ "$(uname -m)" = arm64 ] || die "seuls les Mac Apple Silicon sont pris en charge"

VERSION=$(tr -d '\r\n' < VERSION)
OUT="$ROOT/target/macos"
APPS="office writer sheet present draw pdf"

. "$ROOT/scripts/lib/prereqs.sh"
prereqs ${TEXT_ONLY:+auxitext}

if [ -z "$TEXT_ONLY" ]; then
  say "Moteur LibreOffice"
  [ -f .engine/macos-aarch64/program-dir ] || scripts/build-engine-macos.sh
  [ -f .engine/macos-aarch64/program-dir ] || die "moteur LibreOffice absent (voir BUILD.md)"
fi

say "Interfaces"
DIRS="app text"
[ -n "$TEXT_ONLY" ] && DIRS=text
for dir in $DIRS; do
  (cd "$dir" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run --silent build)
done

say "Compilation (release)"
if [ -n "$TEXT_ONLY" ]; then
  cargo build --release -p auxitext --features auxitext/custom-protocol
else
  cargo build --release -p auxi-engine -p auxioffice -p auxitext --features auxioffice/custom-protocol,auxitext/custom-protocol
fi

# Copie rapide sur APFS (clonage), copie ordinaire sinon.
copy() { cp -Rc "$1" "$2" 2>/dev/null || cp -R "$1" "$2"; }
sign() { codesign --force --deep -s - "$1" >/dev/null 2>&1 || echo "  (signature locale impossible pour $(basename "$1") : macOS peut demander une confirmation au premier lancement)"; }

# --- Applications ------------------------------------------------------------

say "AuxiText → $OUT/AuxiText"
rm -rf "$OUT/AuxiText"
mkdir -p "$OUT/AuxiText"
mac_text_app "$OUT/AuxiText" target/release/auxitext "$VERSION"
sign "$OUT/AuxiText/AuxiText.app"

if [ -z "$TEXT_ONLY" ]; then
  suite="$OUT/AuxiOffice"
  rm -rf "$suite"
  mkdir -p "$suite"
  for a in $APPS; do
    n=$(mac_name "$a")
    say "$n → $suite/$n.app"
    mac_app "$a" "$suite" target/release/auxioffice "$VERSION"
  done
  # AuxiOffice.app porte le moteur ; les autres applications le trouvent à côté
  # d'elles (lib.rs, locate()).
  res="$suite/AuxiOffice.app/Contents/Resources"
  cp target/release/auxi-engine "$suite/AuxiOffice.app/Contents/MacOS/"
  mkdir -p "$res/templates" "$res/engine"
  cp app/src-tauri/templates/vierge.* "$res/templates/"
  say "Copie du moteur LibreOffice"
  program=$(tr -d '\r\n' < .engine/macos-aarch64/program-dir)
  engine_app=$(dirname "$(dirname "$program")")
  copy "$engine_app" "$res/engine/"
  sign "$res/engine/$(basename "$engine_app")"
  for a in $APPS; do sign "$suite/$(mac_name "$a").app"; done
  copy "$OUT/AuxiText/AuxiText.app" "$suite/"
fi

if [ -z "$INSTALLER" ]; then
  say "Terminé"
  [ -n "$TEXT_ONLY" ] || echo "  $OUT/AuxiOffice : AuxiOffice.app, AuxiWriter.app, AuxiSheet.app, AuxiPresent.app, AuxiDraw.app, AuxiPDF.app, AuxiText.app"
  echo "  $OUT/AuxiText : AuxiText.app"
  exit 0
fi

# --- Images disque (.dmg) ----------------------------------------------------

# dmg <nom du volume> <dossier des applications> <fichier .dmg>
dmg() {
  say "Image disque : $(basename "$3")"
  # Raccourci vers Applications : on y glisse les applications.
  ln -sfn /Applications "$2/Applications"
  rm -f "$3"
  hdiutil create -quiet -volname "$1" -srcfolder "$2" -fs APFS -format ULFO -ov "$3"
  rm -f "$2/Applications"
}

dmg AuxiText "$OUT/AuxiText" "$OUT/AuxiText-$VERSION-macos-arm64.dmg"
[ -n "$TEXT_ONLY" ] || dmg AuxiOffice "$OUT/AuxiOffice" "$OUT/AuxiOffice-$VERSION-macos-arm64.dmg"

say "Fiches de la page de téléchargement (office.auxinux.ca)"
scripts/fiches.sh "$OUT" "$OUT"
echo "  À déposer avec les installateurs dans https://dep.auxinux.ca/DOWNLOAD/APPLICATIONS/AUXIOFFICE/ (latest.json en dernier)"

say "Terminé"
ls -1 "$OUT"/*.dmg | sed 's/^/  /'
