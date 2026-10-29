#!/bin/sh
# Windows 11 x64 (Git Bash) : compile AuxiOffice et AuxiText en exécutables
# prêts à l'emploi et, sur demande, leurs installateurs.
#
#   scripts/build-win.sh                         → target/windows/AuxiOffice/ (la suite
#                                                  et son moteur) et target/windows/AuxiText/
#   scripts/build-win.sh --auxitext              → AuxiText seul (moteur inutile)
#   scripts/build-win.sh --installer             → les deux, plus leurs installateurs
#                                                  target/windows/*-setup.exe (celui
#                                                  d'AuxiOffice installe aussi AuxiText)
#   scripts/build-win.sh --auxitext --installer  → AuxiText et son installateur
#   scripts/build-win.sh --help                  → cette aide (aussi -h, -help)
#
# Depuis PowerShell : scripts\build-win.ps1 [-AuxiText] [-Installer] (même chose).
#
# Les dossiers produits se lancent tels quels (AuxiWriter.exe… choisit son
# application d'après son nom ; le moteur est dans engine\). Les installateurs
# (Inno Setup) installent pour l'utilisateur courant, sans droits
# d'administrateur, dans %LOCALAPPDATA%\Programs\AuxiOffice et …\AuxiText,
# comme scripts/install-apps.sh : menu Démarrer, « Ouvrir avec », désinstallation
# dans Paramètres → Applications.
#
# Prérequis : Git pour Windows, Rust (outils MSVC), Node.js 22+, Python 3
# (préparation du moteur) ; pour --installer : Inno Setup 6
# (winget install JRSoftware.InnoSetup).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }

TEXT_ONLY=""
INSTALLER=""
for arg in "$@"; do
  case $(printf '%s' "$arg" | tr '[:upper:]' '[:lower:]') in
    --auxitext|-auxitext) TEXT_ONLY=1 ;;
    --installer|-installer|--installateur|-installateur) INSTALLER=1 ;;
    -h|--help|-help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "option inconnue : $arg (voir scripts/build-win.sh --help)" ;;
  esac
done

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) die "ce script se lance sous Windows, dans Git Bash (Linux : scripts/build-deb.sh)" ;;
esac

VERSION=$(tr -d '\r\n' < VERSION)
# Inno Setup veut une version numérique pour les propriétés du fichier : 0.2.0-beta.2 → 0.2.0
NUM_VERSION=${VERSION%%-*}
OUT="$ROOT/target/windows"
APPS="office writer sheet present draw pdf"
name() { case $1 in office) echo AuxiOffice ;; writer) echo AuxiWriter ;; sheet) echo AuxiSheet ;; present) echo AuxiPresent ;; draw) echo AuxiDraw ;; pdf) echo AuxiPDF ;; esac; }

# Extensions proposées dans « Ouvrir avec » (mêmes listes que install-apps.sh).
win_exts() {
  case $1 in
    writer) echo "docx docm doc dotx dotm odt ott rtf" ;;
    sheet) echo "xlsx xlsm xls xlsb xltx ods ots csv" ;;
    present) echo "pptx pptm ppt ppsx potx odp otp" ;;
    draw) echo "odg otg fodg vsdx vsd vsdm cdr pub svg" ;;
    pdf) echo "pdf" ;;
    text) echo "txt log md markdown json xml yaml yml ini conf cfg toml csv sh ps1 bat py js ts css html" ;;
  esac
}

missing=""
for tool in cargo npm; do
  command -v "$tool" >/dev/null || missing="$missing $tool"
done
[ -z "$missing" ] || die "outils manquants :$missing — voir BUILD.md (Rust via rustup, Node.js 22+)"

# Inno Setup : cherché avant la compilation, pour ne pas échouer à la fin.
ISCC=""
if [ -n "$INSTALLER" ]; then
  for c in "${ISCC_EXE:-}" "$(command -v ISCC.exe 2>/dev/null || true)" \
    "/c/Program Files (x86)/Inno Setup 6/ISCC.exe" "/c/Program Files/Inno Setup 6/ISCC.exe" \
    "$(cygpath -u "${LOCALAPPDATA:-C:/}")/Programs/Inno Setup 6/ISCC.exe"; do
    if [ -n "$c" ] && [ -f "$c" ]; then ISCC=$c; break; fi
  done
  [ -n "$ISCC" ] || die "Inno Setup 6 introuvable (ISCC.exe) : winget install JRSoftware.InnoSetup, ou ISCC_EXE=<chemin>"
fi

if [ -z "$TEXT_ONLY" ]; then
  say "Moteur LibreOffice"
  [ -f .engine/windows-x86_64/program-dir ] || scripts/fetch-engine.sh
  [ -f .engine/windows-x86_64/program-dir ] || die "moteur LibreOffice absent (voir BUILD.md)"
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

mkdir -p "$OUT"

# --- Exécutables -------------------------------------------------------------

say "AuxiText → $OUT/AuxiText"
rm -rf "$OUT/AuxiText"
mkdir -p "$OUT/AuxiText"
cp target/release/auxitext.exe "$OUT/AuxiText/AuxiText.exe"
cp text/src-tauri/icons/icon.ico "$OUT/AuxiText/AuxiText.ico"

if [ -z "$TEXT_ONLY" ]; then
  base="$OUT/AuxiOffice"
  say "AuxiOffice → $base"
  # Le moteur est gardé d'une compilation à l'autre (sa copie prend du temps) ;
  # tout le reste est refait.
  mkdir -p "$base"
  find "$base" -mindepth 1 -maxdepth 1 ! -name engine ! -name engine.version -exec rm -rf {} +
  mkdir -p "$base/icons" "$base/templates"
  for a in $APPS; do
    # Une copie par application : son nom choisit l'application (apps.rs)
    # et Windows groupe ses fenêtres à part dans la barre des tâches.
    cp target/release/auxioffice.exe "$base/$(name "$a").exe"
    cp "branding/generated/ico/auxi$a.ico" "$base/icons/"
  done
  cp target/release/auxi-engine.exe "$base/"
  cp app/src-tauri/templates/vierge.* "$base/templates/"
  program=$(cygpath -u "$(tr -d '\r\n' < .engine/windows-x86_64/program-dir)")
  if ! cmp -s .engine/windows-x86_64/version "$base/engine.version" 2>/dev/null; then
    say "Copie du moteur LibreOffice (quelques minutes)"
    rm -rf "$base/engine" "$base/engine.version"
    cp -r "$(dirname "$program")" "$base/engine"
    cp .engine/windows-x86_64/version "$base/engine.version"
  fi
fi

if [ -z "$INSTALLER" ]; then
  say "Terminé"
  [ -n "$TEXT_ONLY" ] || echo "  $OUT/AuxiOffice : AuxiOffice.exe, AuxiWriter.exe, AuxiSheet.exe, AuxiPresent.exe, AuxiDraw.exe, AuxiPDF.exe"
  echo "  $OUT/AuxiText : AuxiText.exe"
  exit 0
fi

# --- Installateurs (Inno Setup) ----------------------------------------------

# Entrées « Ouvrir avec » d'une application (section [Registry] d'Inno Setup) :
# progid <ProgId> <libellé> <exécutable> <icône> <extensions…>
progid() {
  p=$1 label=$2 exe=$3 ico=$4
  shift 4
  printf '%s\n' "Root: HKA; Subkey: \"Software\\Classes\\$p\"; ValueType: string; ValueData: \"$label\"; Flags: uninsdeletekey"
  printf '%s\n' "Root: HKA; Subkey: \"Software\\Classes\\$p\\DefaultIcon\"; ValueType: string; ValueData: \"{app}\\$ico\""
  printf '%s\n' "Root: HKA; Subkey: \"Software\\Classes\\$p\\shell\\open\\command\"; ValueType: string; ValueData: \"\"\"{app}\\$exe\"\" \"\"%1\"\"\""
  for e in "$@"; do
    printf '%s\n' "Root: HKA; Subkey: \"Software\\Classes\\.$e\\OpenWithProgids\"; ValueType: string; ValueName: \"$p\"; ValueData: \"\"; Flags: uninsdeletevalue"
  done
}

# iscc <script .iss> <dossier source> <fichier [Registry] généré> [/Dnom=valeur…]
iscc() {
  iss=$1 src=$2 reg=$3
  shift 3
  say "Installateur : $(basename "$iss" .iss)"
  # MSYS2_ARG_CONV_EXCL : les options /D… ne doivent pas être prises pour des chemins.
  MSYS2_ARG_CONV_EXCL='*' "$ISCC" /Q \
    "/DAppVersion=$VERSION" "/DNumVersion=$NUM_VERSION" \
    "/DRepoDir=$(cygpath -w "$ROOT")" "/DSourceDir=$(cygpath -w "$src")" \
    "/DRegistryFile=$(cygpath -w "$reg")" "/O$(cygpath -w "$OUT")" \
    "$@" "$(cygpath -w "$iss")"
}

# shellcheck disable=SC2046 # une extension par argument
progid AuxiText.Document "Texte (AuxiText)" AuxiText.exe AuxiText.ico $(win_exts text) > "$OUT/registre-auxitext.iss"
iscc scripts/windows/auxitext.iss "$OUT/AuxiText" "$OUT/registre-auxitext.iss"

if [ -z "$TEXT_ONLY" ]; then
  : > "$OUT/registre-auxioffice.iss"
  for a in $APPS; do
    [ "$a" = office ] && continue
    n=$(name "$a")
    # shellcheck disable=SC2046
    progid "AuxiOffice.$n" "Document $n" "$n.exe" "icons\\auxi$a.ico" $(win_exts "$a") >> "$OUT/registre-auxioffice.iss"
  done
  # L'installateur d'AuxiOffice embarque celui d'AuxiText et le lance : AuxiText
  # reste une application à part (mise à jour et désinstallation séparées).
  iscc scripts/windows/auxioffice.iss "$OUT/AuxiOffice" "$OUT/registre-auxioffice.iss" \
    "/DAuxiTextSetup=$(cygpath -w "$OUT/AuxiText-$VERSION-windows-x64-setup.exe")"
fi

say "Terminé"
ls -1 "$OUT"/*-setup.exe | sed 's/^/  /'
