#!/bin/bash
# Compile le moteur LibreOffice d'AuxiOffice pour Mac Apple Silicon.
#
# Pourquoi : le LibreOffice officiel pour Mac n'inclut pas le module
# d'affichage « svp » (sans écran) ; or c'est le seul qui sache dessiner les
# pages dans un tampon mémoire (rendu par tuiles de LibreOfficeKit). On
# compile donc LibreOffice, sans aucune modification de ses sources, avec
# --enable-headless : le moteur fonctionne alors exactement comme sous Linux.
#
# Durée : 1 à 3 heures la première fois (Mac mini M-series), ~40 Go d'espace
# disque. Les sources (archives officielles vérifiées par SHA-256) et la
# compilation restent dans .engine/build/ ; une relance reprend où elle
# s'était arrêtée.
#
# Usage : scripts/build-engine-macos.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOCK="$ROOT/engine/libreoffice.lock.json"
BUILD="$ROOT/.engine/build"
OUT="$ROOT/.engine/macos-aarch64"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] || die "ce script est destiné aux Mac Apple Silicon"

say "Vérification des outils"
xcrun --show-sdk-path >/dev/null 2>&1 || die "outils Xcode absents : xcode-select --install (ou sudo xcode-select -s /chemin/Xcode.app)"
command -v brew >/dev/null || die "Homebrew requis : https://brew.sh"
BREW_PKGS="autoconf automake libtool pkg-config make bison flex gperf nasm"
missing=""
for p in $BREW_PKGS; do brew list --versions "$p" >/dev/null 2>&1 || missing="$missing $p"; done
if [ -n "$missing" ]; then
  echo "Installation des outils de compilation :$missing"
  brew install $missing
fi
BP=$(brew --prefix)
# GNU make 4, bison et flex récents avant ceux de macOS (trop anciens).
export PATH="$BP/opt/make/libexec/gnubin:$BP/opt/bison/bin:$BP/opt/flex/bin:$BP/bin:$PATH"
make --version | head -1 | grep -q 'GNU Make 4' || die "GNU make 4 introuvable (brew install make)"
# configure de LibreOffice refuse tout pkg-config dont il ne reconnaît pas
# l'origine ; celui de Homebrew n'est accepté que sous ce chemin exact
# (et non sous son autre nom, pkgconf, qu'il trouverait sinon en premier).
[ -x "$BP/bin/pkg-config" ] || die "pkg-config de Homebrew introuvable (brew install pkgconf)"
export PKG_CONFIG="$BP/bin/pkg-config"

sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
fetch() { # url sha256
  local f="$BUILD/$(basename "$1")"
  if [ -f "$f" ] && [ "$(sha256 "$f")" = "$2" ]; then return 0; fi
  echo "Téléchargement de $(basename "$1")…"
  local n=0
  until curl -fL --retry 3 -C - -o "$f.part" "$1" && [ "$(sha256 "$f.part")" = "$2" ]; do
    n=$((n + 1)); [ $n -lt 5 ] || die "téléchargement impossible : $1"
    rm -f "$f.part"; sleep 2
  done
  mv "$f.part" "$f"
}

mkdir -p "$BUILD"
VERSION=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['build'])" "$LOCK")
SRC="$BUILD/libreoffice-$VERSION"

say "Sources de LibreOffice $VERSION"
python3 - "$LOCK" > "$BUILD/sources.txt" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print(d["source"]["url"], d["source"]["sha256"])
for e in d.get("source-extra", []): print(e["url"], e["sha256"])
PY
while read -r url sum; do fetch "$url" "$sum"; done < "$BUILD/sources.txt"
if [ ! -f "$SRC/autogen.sh" ]; then
  while read -r url sum; do
    echo "Extraction de $(basename "$url")…"
    tar xJf "$BUILD/$(basename "$url")" -C "$BUILD"
  done < "$BUILD/sources.txt"
fi
[ -f "$SRC/autogen.sh" ] || die "sources incomplètes dans $SRC"

cd "$SRC"
# Le module svp a besoin de fontconfig, freetype et cairo : macOS ne les
# fournit pas, on fait compiler les versions internes de LibreOffice.
if [ ! -f config.status ] || ! grep -q -- '--without-system-fontconfig' config.status 2>/dev/null; then
  say "Configuration (module svp, sans interface graphique de LibreOffice)"
  ./autogen.sh \
    --enable-headless \
    --without-system-fontconfig \
    --without-system-freetype \
    --with-lang="fr en-US" \
    --with-myspell-dicts \
    --with-parallelism="$(sysctl -n hw.ncpu)" \
    --with-external-tar="$BUILD/external" \
    --without-java \
    --without-help \
    --without-doxygen \
    --enable-python=no \
    --disable-skia \
    --disable-cups \
    --disable-dbus \
    --disable-gstreamer-1-0 \
    --disable-sdremote \
    --disable-online-update \
    --disable-extension-update \
    --disable-report-builder \
    --disable-lpsolve \
    --disable-coinmp \
    --disable-firebird-sdbc \
    --disable-mariadb-sdbc \
    --disable-postgresql-sdbc \
    --disable-ccache
fi

say "Compilation (longue : 1 à 3 heures la première fois)"
make

say "Installation du moteur dans .engine/macos-aarch64"
app=$(ls -d "$SRC"/instdir/*.app 2>/dev/null | head -n1)
[ -n "$app" ] || die "application compilée introuvable dans $SRC/instdir"
lib="$app/Contents/Frameworks"
[ -f "$lib/libmergedlo.dylib" ] || [ -f "$lib/libsofficeapp.dylib" ] || die "bibliothèque LibreOfficeKit absente de $lib"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$app" "$OUT/"
program="$OUT/$(basename "$app")/Contents/Frameworks"
echo "$program" > "$OUT/program-dir"
python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$LOCK" > "$OUT/version"
echo headless > "$OUT/variant"
say "Moteur prêt : $program"
echo "Vérification : scripts/diagnose.sh   Lancement : scripts/dev.sh"
