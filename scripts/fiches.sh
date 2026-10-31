#!/bin/sh
# Écrit les fiches JSON lues par la page de téléchargement d'office.auxinux.ca
# (format : dépôt auxinux/AuxiOffice-Web, README, « Fiches des paquets ») :
# une fiche par installateur trouvé (auxioffice-windows-x64.json…) et latest.json.
#
#   scripts/fiches.sh <dossier de sortie> <installateur ou dossier>…
#
# Installateurs reconnus (noms produits par scripts/build.sh --installer) :
#   AuxiOffice-<v>-windows-x64-setup.exe, AuxiText-<v>-windows-x64-setup.exe,
#   AuxiOffice-<v>-macos-arm64.dmg, AuxiText-<v>-macos-arm64.dmg,
#   auxioffice_<v>_amd64.deb, auxioffice_<v>_arm64.deb, auxitext_<v>_amd64.deb, auxitext_<v>_arm64.deb
#
# Les fiches n'ont pas de champ « url » : le site télécharge <pkg_base>/<fichier>.
# Publication : déposer les installateurs, puis les fiches, et latest.json en dernier,
# tous dans le même dossier (https://dep.auxinux.ca/DOWNLOAD/APPLICATIONS/AUXIOFFICE/).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ $# -ge 2 ] || { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
OUT=$1
shift
VERSION=${VERSION:-$(tr -d '\r\n' < "$ROOT/VERSION")}
# Version dans les noms des paquets Debian : 0.2.0-beta.2 → 0.2.0~beta.2
DEB_VERSION=$(printf '%s' "$VERSION" | sed -E 's/-(alpha|beta|rc)/~\1/')
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "$OUT"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# fiche <fichier> → <OUT>/<nom de fiche>.json (rien si le nom n'est pas reconnu)
fiche() {
  nom=$(basename "$1")
  # Seulement la version courante : un ancien installateur resté dans le dossier est ignoré.
  case $nom in
    *-"$VERSION"-*|*_"$DEB_VERSION"_*) ;;
    *) return 0 ;;
  esac
  case $nom in
    AuxiOffice-*-windows-x64-setup.exe) f=auxioffice-windows-x64 produit=AuxiOffice os=windows arch=x64 ;;
    AuxiText-*-windows-x64-setup.exe) f=auxitext-windows-x64 produit=AuxiText os=windows arch=x64 ;;
    AuxiOffice-*-macos-arm64.dmg) f=auxioffice-macos-arm64 produit=AuxiOffice os=macos arch=arm64 ;;
    AuxiText-*-macos-arm64.dmg) f=auxitext-macos-arm64 produit=AuxiText os=macos arch=arm64 ;;
    auxioffice_*_amd64.deb) f=auxioffice-linux-amd64 produit=AuxiOffice os=linux arch=amd64 ;;
    auxioffice_*_arm64.deb) f=auxioffice-linux-arm64 produit=AuxiOffice os=linux arch=arm64 ;;
    auxitext_*_amd64.deb) f=auxitext-linux-amd64 produit=AuxiText os=linux arch=amd64 ;;
    auxitext_*_arm64.deb) f=auxitext-linux-arm64 produit=AuxiText os=linux arch=arm64 ;;
    *) return 0 ;;
  esac
  cat > "$OUT/$f.json" <<JSON
{
  "schema": 1,
  "produit": "$produit",
  "version": "$VERSION",
  "os": "$os",
  "architecture": "$arch",
  "format": "${nom##*.}",
  "fichier": "$nom",
  "taille": $(wc -c < "$1" | tr -d ' '),
  "date": "$DATE",
  "sha256": "$(sha256 "$1")"
}
JSON
  echo "  $f.json ← $nom"
}

for arg in "$@"; do
  if [ -d "$arg" ]; then
    for p in "$arg"/*; do [ -f "$p" ] && fiche "$p"; done
  elif [ -f "$arg" ]; then
    fiche "$arg"
  fi
done

cat > "$OUT/latest.json" <<JSON
{
  "schema": 1,
  "version": "$VERSION",
  "date": "$DATE",
  "fiches": [
    "auxioffice-linux-amd64",
    "auxioffice-linux-arm64",
    "auxioffice-windows-x64",
    "auxioffice-macos-arm64",
    "auxitext-linux-amd64",
    "auxitext-linux-arm64",
    "auxitext-windows-x64",
    "auxitext-macos-arm64"
  ]
}
JSON
echo "  latest.json (version $VERSION)"
