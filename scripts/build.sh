#!/bin/sh
# Compile AuxiOffice et AuxiText pour le système où il est lancé (Windows,
# macOS ou Linux) et, sur demande, leurs installateurs.
#
#   scripts/build.sh                         → les applications (suite et AuxiText)
#   scripts/build.sh --auxitext              → AuxiText seul (moteur inutile)
#   scripts/build.sh --installer             → les applications et leurs installateurs
#   scripts/build.sh --auxitext --installer  → AuxiText et son installateur
#   scripts/build.sh --help                  → cette aide (aussi -h, -help)
#
# Depuis PowerShell : scripts/build.ps1 [-AuxiText] [-Installer] [-Help].
#
# Installateurs produits :
#   Windows (Git Bash)  target/windows/AuxiOffice-<version>-windows-x64-setup.exe (la suite,
#                       et AuxiText) et AuxiText-<version>-windows-x64-setup.exe — scripts/build-win.sh
#   macOS               target/macos/AuxiOffice-<version>-macos-arm64.dmg (la suite et
#                       AuxiText) et AuxiText-<version>-macos-arm64.dmg — scripts/build-mac.sh
#   Linux (Debian 13,   target/deb/auxioffice_<version>_<arch>.deb (dépend d'auxitext) et
#   AuxiNuxOS)          auxitext_<version>_<arch>.deb — scripts/build-deb.sh
#                       Installer : sudo apt install ./auxioffice_*.deb ./auxitext_*.deb
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }

TEXT_ONLY=""
INSTALLER=""
for arg in "$@"; do
  case $(printf '%s' "$arg" | tr '[:upper:]' '[:lower:]') in
    --auxitext|-auxitext) TEXT_ONLY=1 ;;
    --installer|-installer|--installateur|-installateur) INSTALLER=1 ;;
    -h|--help|-help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "option inconnue : $arg (voir scripts/build.sh --help)" ;;
  esac
done
set --
[ -n "$TEXT_ONLY" ] && set -- "$@" --auxitext
[ -n "$INSTALLER" ] && set -- "$@" --installer

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) exec scripts/build-win.sh "$@" ;;
  Darwin) exec scripts/build-mac.sh "$@" ;;
  Linux) ;;
  *) die "système non pris en charge : $(uname -s)" ;;
esac

# --- Linux -------------------------------------------------------------------

if [ -n "$INSTALLER" ]; then
  if [ -n "$TEXT_ONLY" ]; then exec scripts/build-deb.sh --auxitext; else exec scripts/build-deb.sh; fi
fi

missing=""
for tool in cargo npm; do
  command -v "$tool" >/dev/null || missing="$missing $tool"
done
[ -z "$missing" ] || die "outils manquants :$missing — voir BUILD.md (Rust via rustup, Node.js 22+)"

if [ -z "$TEXT_ONLY" ]; then
  printf '\n== Moteur LibreOffice\n'
  ls .engine/linux-*/program-dir >/dev/null 2>&1 || scripts/fetch-engine.sh
fi
printf '\n== Interfaces\n'
DIRS="app text"
[ -n "$TEXT_ONLY" ] && DIRS=text
for dir in $DIRS; do
  (cd "$dir" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run --silent build)
done
printf '\n== Compilation (release)\n'
if [ -n "$TEXT_ONLY" ]; then
  cargo build --release -p auxitext --features auxitext/custom-protocol
else
  cargo build --release -p auxi-engine -p auxioffice -p auxitext --features auxioffice/custom-protocol,auxitext/custom-protocol
fi
printf '\n== Terminé\n'
[ -n "$TEXT_ONLY" ] || echo "  target/release/auxioffice (le moteur reste dans .engine/ ; menu des applications : scripts/install-apps.sh)"
echo "  target/release/auxitext"
