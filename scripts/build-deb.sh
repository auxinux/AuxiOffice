#!/bin/sh
# Paquets Debian (Debian 13 / AuxiNuxOS ; amd64 ou arm64, selon la machine) :
#   auxitext        éditeur de texte, installable seul (sans LibreOffice) ;
#   auxioffice      la suite (AuxiOffice, AuxiWriter, AuxiSheet, AuxiPresent,
#                   AuxiDraw, AuxiPDF) avec son moteur LibreOffice ; installe
#                   aussi auxitext ;
#   auxinux-office  paquet de transition (ancien nom) qui installe auxioffice.
#
#   scripts/build-deb.sh              → target/deb/*.deb (les trois paquets)
#   scripts/build-deb.sh --auxitext   → auxitext seul (moteur inutile)
#
# Compilation native : sur un PC x86_64, paquets amd64 ; sur une machine ARM64
# (aarch64), paquets arm64 avec le moteur LibreOffice pour ARM64.
# Prérequis : moteur (scripts/fetch-engine.sh, sauf --auxitext), Rust,
# Node.js, dpkg-deb, fakeroot.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

# 0.2.0-beta.1 → 0.2.0~beta.1 : pour dpkg, une bêta précède la version finale.
VERSION=$(sed 's/-\(alpha\|beta\|rc\)/~\1/' VERSION | tr -d '\n')
case "$(uname -m)" in
  x86_64) ARCH=amd64 PLATFORM=linux-x86_64 ;;
  aarch64|arm64) ARCH=arm64 PLATFORM=linux-aarch64 ;;
  *) echo "Architecture non prise en charge : $(uname -m)" >&2; exit 1 ;;
esac
TEXT_ONLY=""
[ "${1:-}" = "--auxitext" ] && TEXT_ONLY=1
OUT="$ROOT/target/deb"
WORK="$ROOT/target/deb-work"
MAINTAINER="AuxiNux <repo@auxinux.ca>"
HOMEPAGE="https://office.auxinux.ca"
. "$ROOT/scripts/lib/prereqs.sh"
prereqs deb ${TEXT_ONLY:+auxitext}
if [ -z "$TEXT_ONLY" ]; then
  ENGINE=$(cat ".engine/$PLATFORM/program-dir" 2>/dev/null || true)
  [ -n "$ENGINE" ] && [ -d "$ENGINE" ] || { echo "Moteur absent ($PLATFORM) : lancer d'abord scripts/fetch-engine.sh" >&2; exit 1; }
  LO_ROOT=$(dirname "$ENGINE")
fi

echo "== Interfaces ($ARCH)"
DIRS="app text"
[ -n "$TEXT_ONLY" ] && DIRS=text
for dir in $DIRS; do
  (cd "$dir" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run --silent build)
done
echo "== Compilation (release, $ARCH)"
if [ -n "$TEXT_ONLY" ]; then
  cargo build --release -p auxitext --features auxitext/custom-protocol
else
  cargo build --release -p auxi-engine -p auxioffice -p auxitext --features auxioffice/custom-protocol,auxitext/custom-protocol
fi

rm -rf "$WORK"
mkdir -p "$OUT" "$WORK"

# Contrôle Debian : control <dossier> <paquet> <dépendances> <description courte> <description longue> [champs…]
control() {
  dir=$1 pkg=$2 deps=$3 short=$4 long=$5
  shift 5
  mkdir -p "$dir/DEBIAN"
  size=$(du -sk --exclude=DEBIAN "$dir" | cut -f1)
  {
    echo "Package: $pkg"
    echo "Version: $VERSION"
    echo "Architecture: $ARCH"
    echo "Maintainer: $MAINTAINER"
    echo "Installed-Size: $size"
    [ -z "$deps" ] || echo "Depends: $deps"
    for extra in "$@"; do echo "$extra"; done
    echo "Section: editors"
    echo "Priority: optional"
    echo "Homepage: $HOMEPAGE"
    echo "Description: $short"
    echo "$long" | fold -s -w 78 | sed 's/^/ /; s/ $//'
  } > "$dir/DEBIAN/control"
}

# Rafraîchit les caches des menus et des icônes (scripts du paquet).
postinst() {
  cat > "$1/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = configure ] || [ "$1" = abort-upgrade ]; then
  command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
  command -v update-mime-database >/dev/null && update-mime-database /usr/share/mime || true
fi
EOF
  cp "$1/DEBIAN/postinst" "$1/DEBIAN/postrm"
  sed -i 's/configure/remove/; s/abort-upgrade/purge/' "$1/DEBIAN/postrm"
  chmod 755 "$1/DEBIAN/postinst" "$1/DEBIAN/postrm"
}

build() {
  # Droits propres (certains dossiers héritent du bit setgid) : dpkg les refuse.
  find "$1" -type d -exec chmod u=rwx,go=rx,g-s {} +
  fakeroot dpkg-deb --root-owner-group -Zxz -z6 --build "$1" "$OUT/$2_${VERSION}_$3.deb" >/dev/null
  echo "  → $OUT/$2_${VERSION}_$3.deb ($(du -h "$OUT/$2_${VERSION}_$3.deb" | cut -f1))"
}

# --- auxitext --------------------------------------------------------------
echo "== auxitext"
T="$WORK/auxitext"
install -Dm755 target/release/auxitext "$T/usr/bin/auxitext"
install -Dm644 text/src-tauri/linux/ca.auxinux.AuxiText.desktop "$T/usr/share/applications/ca.auxinux.AuxiText.desktop"
install -Dm644 text/src-tauri/linux/ca.auxinux.AuxiNuxOffice.Text.desktop "$T/usr/share/applications/ca.auxinux.AuxiNuxOffice.Text.desktop"
install -Dm644 text/src-tauri/linux/ca.auxinux.AuxiText.metainfo.xml "$T/usr/share/metainfo/ca.auxinux.AuxiText.metainfo.xml"
install -Dm644 text/src-tauri/icons/auxitext.svg "$T/usr/share/icons/hicolor/scalable/apps/auxitext.svg"
for s in 16 22 24 32 48 64 128 256 512; do
  install -Dm644 "branding/generated/png/${s}x${s}/auxitext.png" "$T/usr/share/icons/hicolor/${s}x${s}/apps/auxitext.png"
done
control "$T" auxitext "libc6 (>= 2.41), libwebkit2gtk-4.1-0, libgtk-3-0t64" \
  "Éditeur de texte d'AuxiNux" \
  "AuxiText est l'éditeur de texte de l'écosystème AuxiNux : onglets, coloration syntaxique d'une trentaine de langages, recherche et remplacement (expressions régulières), encodages et fins de ligne détectés et conservés, enregistrement atomique, thème clair ou sombre qui suit le bureau. Il s'installe seul, sans le reste de la suite AuxiOffice." \
  "Replaces: auxinux-office (<< 0.2)" "Breaks: auxinux-office (<< 0.2)"
postinst "$T"
build "$T" auxitext "$ARCH"
if [ -n "$TEXT_ONLY" ]; then
  echo "Paquet prêt dans $OUT"
  exit 0
fi

# --- auxioffice ------------------------------------------------------------
echo "== auxioffice"
O="$WORK/auxioffice"
LIB="$O/usr/lib/auxioffice"
install -Dm755 target/release/auxioffice "$LIB/auxioffice"
install -Dm755 target/release/auxi-engine "$LIB/auxi-engine"
mkdir -p "$LIB/templates" "$LIB/engine" "$O/usr/bin"
cp app/src-tauri/templates/vierge.* "$LIB/templates/"
# Moteur : LibreOffice officiel, non modifié (MPL 2.0), sans l'aide hors ligne.
cp -a "$LO_ROOT/." "$LIB/engine/"
rm -rf "$LIB/engine/help" "$LIB/engine/readmes"
ln -s ../lib/auxioffice/auxioffice "$O/usr/bin/auxioffice"
for a in writer sheet present draw pdf; do
  # Le nom d'appel choisit l'application (voir apps.rs).
  ln -s auxioffice "$LIB/auxi$a"
  ln -s ../lib/auxioffice/auxi$a "$O/usr/bin/auxi$a"
done

desktop() { # desktop <slug> <Nom> <commentaire> <catégories> <types MIME> <nouveau ?>
  f="$O/usr/share/applications/ca.auxinux.$1.desktop"
  mkdir -p "$(dirname "$f")"
  {
    echo "[Desktop Entry]"
    echo "Type=Application"
    echo "Name=$2"
    echo "Comment=$3"
    echo "Exec=auxi$1 %F"
    echo "Icon=auxi$1"
    echo "Terminal=false"
    echo "StartupNotify=true"
    echo "StartupWMClass=auxi$1"
    echo "Categories=$4"
    [ -z "$5" ] || echo "MimeType=$5"
    if [ "$6" = oui ]; then
      echo "Actions=new;"
      echo
      echo "[Desktop Action new]"
      echo "Name=Nouveau"
      echo "Exec=auxi$1 --new"
    fi
  } > "$f"
}
desktop office AuxiOffice "Créer et ouvrir des documents, classeurs, présentations, dessins et PDF" "Office;" "" non
desktop writer AuxiWriter "Traitement de texte" "Office;WordProcessor;" \
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document;application/vnd.ms-word.document.macroEnabled.12;application/vnd.openxmlformats-officedocument.wordprocessingml.template;application/msword;application/vnd.oasis.opendocument.text;application/vnd.oasis.opendocument.text-template;application/rtf;text/rtf;" oui
desktop sheet AuxiSheet "Tableur" "Office;Spreadsheet;" \
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;application/vnd.ms-excel.sheet.macroEnabled.12;application/vnd.ms-excel;application/vnd.oasis.opendocument.spreadsheet;text/csv;" oui
desktop present AuxiPresent "Présentations et diaporamas" "Office;Presentation;" \
  "application/vnd.openxmlformats-officedocument.presentationml.presentation;application/vnd.ms-powerpoint.presentation.macroEnabled.12;application/vnd.openxmlformats-officedocument.presentationml.slideshow;application/vnd.ms-powerpoint;application/vnd.oasis.opendocument.presentation;" oui
desktop draw AuxiDraw "Dessin vectoriel et mise en page" "Office;Graphics;VectorGraphics;" \
  "application/vnd.oasis.opendocument.graphics;application/vnd.oasis.opendocument.graphics-template;application/vnd.visio;application/vnd.ms-visio.drawing.main+xml;" oui
desktop pdf AuxiPDF "Lecteur de documents PDF" "Office;Viewer;" "application/pdf;" non
for a in office writer sheet present draw pdf; do
  install -Dm644 "app/ui/public/icons/auxi$a.svg" "$O/usr/share/icons/hicolor/scalable/apps/auxi$a.svg"
  for s in 16 22 24 32 48 64 128 256 512; do
    install -Dm644 "branding/generated/png/${s}x${s}/auxi$a.png" "$O/usr/share/icons/hicolor/${s}x${s}/apps/auxi$a.png"
  done
done
install -Dm644 LICENSING.md "$O/usr/share/doc/auxioffice/LICENSING.md"
control "$O" auxioffice \
  "auxitext (= $VERSION), libc6 (>= 2.41), libwebkit2gtk-4.1-0, libgtk-3-0t64, libcups2t64, libnss3, libfontconfig1, libfreetype6, libcairo2, libdbus-1-3, libx11-6, libxext6, libxrender1, libxinerama1, libxrandr2, libsm6, libice6" \
  "Suite bureautique d'AuxiNux" \
  "AuxiOffice est la suite bureautique de l'écosystème AuxiNux, hors ligne et sans télémétrie : AuxiWriter (traitement de texte : DOCX, DOCM, ODT, DOC, RTF), AuxiSheet (tableur : XLSX, XLSM, ODS, XLS, CSV), AuxiPresent (présentations : PPTX, ODP, PPT), AuxiDraw (dessin et mise en page : ODG, Visio, PDF) et AuxiPDF (lecteur PDF : formulaires, annotations). Le rendu des documents est confié à LibreOffice, inclus comme moteur, sans modification. LibreOffice est une marque déposée de The Document Foundation." \
  "Recommends: cups-client, fonts-crosextra-carlito, fonts-crosextra-caladea, fonts-liberation2" \
  "Replaces: auxinux-office (<< 0.2)" "Breaks: auxinux-office (<< 0.2)"
sed -i 's/^Section: .*/Section: office/' "$O/DEBIAN/control"
postinst "$O"
build "$O" auxioffice "$ARCH"

# --- auxinux-office (transition) -----------------------------------------
echo "== auxinux-office (transition)"
X="$WORK/auxinux-office"
mkdir -p "$X/usr/share/doc/auxinux-office"
echo "AuxiNux Office est devenu AuxiOffice : ce paquet installe auxioffice et peut être retiré." > "$X/usr/share/doc/auxinux-office/README"
control "$X" auxinux-office "auxioffice (= $VERSION)" \
  "Paquet de transition vers AuxiOffice" \
  "AuxiNux Office est devenu AuxiOffice. Ce paquet vide installe auxioffice (et auxitext) ; il peut être retiré sans risque."
sed -i 's/^Architecture: .*/Architecture: all/; s/^Section: .*/Section: oldlibs/' "$X/DEBIAN/control"
build "$X" auxinux-office all

echo "== Fiches de la page de téléchargement (office.auxinux.ca)"
scripts/fiches.sh "$OUT" "$OUT"
echo "Paquets prêts dans $OUT"
