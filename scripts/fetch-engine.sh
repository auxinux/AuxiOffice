#!/bin/sh
# Télécharge et prépare le moteur LibreOffice d'AuxiOffice selon
# engine/libreoffice.lock.json, dans .engine/<plateforme>/.
# Chaque fichier est vérifié par SHA-256. Aucun droit administrateur requis.
#
# Plateformes : Linux x86_64 et ARM64 (paquets .deb extraits), Windows x86_64 (MSI
# officiel extrait par une installation administrative, sous Git Bash).
# Sous macOS, le moteur se compile : scripts/build-engine-macos.sh.
#
# Usage : scripts/fetch-engine.sh [--sdk]
# Écrit le dossier à passer dans AUXI_LO_PROGRAM dans .engine/<plateforme>/program-dir.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOCK="$ROOT/engine/libreoffice.lock.json"
CACHE="$ROOT/.engine/cache"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) PLATFORM=linux-x86_64 ;;
  Linux-aarch64|Linux-arm64) PLATFORM=linux-aarch64 ;;
  Darwin-arm64) PLATFORM=macos-aarch64 ;;
  MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64) PLATFORM=windows-x86_64 ;;
  *) echo "Plateforme non prise en charge : $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
if [ "$PLATFORM" = macos-aarch64 ]; then
  echo "Sous macOS, le LibreOffice officiel ne convient pas comme moteur (pas de module svp)." >&2
  echo "Compilez-le une fois avec : scripts/build-engine-macos.sh" >&2
  exit 1
fi
OUT="$ROOT/.engine/$PLATFORM"
# Python : « python3 » sous Linux et macOS, souvent « python » sous Windows.
PY=${PYTHON:-python3}
"$PY" -c "" 2>/dev/null || PY=python
# Repartir d'un dossier vide : une ancienne version ne doit pas rester à côté
# (les téléchargements, eux, restent dans le cache).
rm -rf "$OUT"
mkdir -p "$OUT" "$CACHE"

sets="$PLATFORM"
[ "${1:-}" = "--sdk" ] && [ "$PLATFORM" = linux-x86_64 ] && sets="$sets sdk-linux-x86_64"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Télécharge un fichier du verrou dans le cache et vérifie sa somme.
# Les miroirs de LibreOffice coupent parfois la connexion : reprise du
# transfert (-C -) et nouvelles tentatives, éventuellement sur un autre miroir.
fetch() {
  file=$1 sum=$2
  dest="$CACHE/$(basename "$file")"
  if [ -f "$dest" ] && [ "$(sha256 "$dest")" = "$sum" ]; then
    return 0
  fi
  echo "Téléchargement de $(basename "$file")…"
  n=0
  while [ $n -lt 5 ]; do
    n=$((n + 1))
    if curl -fL --retry 3 --retry-delay 2 -C - -o "$dest.part" "$base/$file"; then
      if [ "$(sha256 "$dest.part")" = "$sum" ]; then
        mv "$dest.part" "$dest"
        return 0
      fi
      echo "Somme SHA-256 incorrecte, nouveau téléchargement…" >&2
      rm -f "$dest.part"
    else
      echo "Transfert interrompu (essai $n sur 5), reprise…" >&2
    fi
    sleep 2
  done
  rm -f "$dest.part"
  return 1
}

install_linux() {
  dest=$1
  work="$CACHE/x-$(basename "$dest")"
  rm -rf "$work"; mkdir -p "$work" "$OUT/root"
  tar xzf "$dest" -C "$work"
  for deb in $(find "$work" -name '*.deb' | sort); do
    if command -v dpkg-deb >/dev/null; then
      dpkg-deb -x "$deb" "$OUT/root"
    else
      (cd "$work" && ar x "$deb" data.tar.xz && tar xJf data.tar.xz -C "$OUT/root" && rm -f data.tar.xz)
    fi
  done
  rm -rf "$work"
}

# Windows : installation administrative du MSI (simple extraction des
# fichiers, sans droits d'administrateur ni inscription dans le système).
install_windows() {
  dest=$1
  target=$(cygpath -w "$OUT/root")
  mkdir -p "$OUT/root"
  MSYS2_ARG_CONV_EXCL='*' msiexec /a "$(cygpath -w "$dest")" /qn TARGETDIR="$target" /L*v "$(cygpath -w "$OUT/msiexec.log")" || {
    echo "Extraction du MSI impossible (journal : $OUT/msiexec.log)" >&2; return 1; }
  # msiexec rend la main avant d'avoir fini d'écrire sur certaines machines.
  n=0
  while [ ! -f "$(find "$OUT/root" -maxdepth 3 -name soffice.exe | head -n1)" ] && [ $n -lt 60 ]; do sleep 2; n=$((n + 1)); done
  # Le MSI lui-même est recopié par l'installation administrative : inutile.
  find "$OUT/root" -maxdepth 1 -name '*.msi' -delete
}

install_macos() {
  dest=$1
  mnt=$(mktemp -d "${TMPDIR:-/tmp}/auxi-lo.XXXXXX")
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$mnt" "$dest"
  if [ -d "$mnt/LibreOffice.app" ]; then
    rm -rf "$OUT/LibreOffice.app"
    cp -R "$mnt/LibreOffice.app" "$OUT/"
  else
    # Module de langue : une archive à décompresser dans LibreOffice.app.
    tarball=$(find "$mnt" -name 'tarball.tar.bz2' | head -n1)
    if [ -n "$tarball" ] && [ -d "$OUT/LibreOffice.app" ]; then
      first=$(tar tjf "$tarball" | head -n1)
      case "$first" in
        Contents/*|./Contents/*) tar xjf "$tarball" -C "$OUT/LibreOffice.app" ;;
        *) tar xjf "$tarball" -C "$OUT/LibreOffice.app/Contents" ;;
      esac
    else
      echo "Avertissement : module de langue non reconnu dans $(basename "$dest"), ignoré." >&2
    fi
  fi
  hdiutil detach -quiet "$mnt"
  rmdir "$mnt" 2>/dev/null || true
  xattr -dr com.apple.quarantine "$OUT/LibreOffice.app" 2>/dev/null || true
}

base=$("$PY" -c "import json,sys;print(json.load(open(sys.argv[1]))['base_url'])" "$LOCK")
entries=$("$PY" -c "
import json,sys
lock=json.load(open(sys.argv[1]))
for s in sys.argv[2:]:
    for e in lock[s]: print(e['file'], e['sha256'], 'optional' if e.get('optional') else 'required')" "$LOCK" $sets)

# Pas de tube vers « while » : un échec doit arrêter le script lui-même.
tmp_entries=$(mktemp "${TMPDIR:-/tmp}/auxi-entries.XXXXXX")
echo "$entries" > "$tmp_entries"
while read -r file sum need; do
  if ! fetch "$file" "$sum"; then
    if [ "$need" = optional ]; then
      echo "Avertissement : $(basename "$file") n'a pas pu être téléchargé ; on continue sans lui." >&2
      echo "  (relancez scripts/fetch-engine.sh plus tard pour l'ajouter)" >&2
      continue
    fi
    echo "Échec du téléchargement de $(basename "$file"). Vérifiez la connexion puis relancez le script." >&2
    rm -f "$tmp_entries"
    exit 1
  fi
  case "$PLATFORM" in
    linux-*) install_linux "$CACHE/$(basename "$file")" ;;
    macos-*) install_macos "$CACHE/$(basename "$file")" ;;
    windows-*) install_windows "$CACHE/$(basename "$file")" ;;
  esac
done < "$tmp_entries"
rm -f "$tmp_entries"

case "$PLATFORM" in
  linux-*) program=$(find "$OUT/root/opt" -maxdepth 2 -type d -name program | head -n1) ;;
  macos-*) program="$OUT/LibreOffice.app/Contents/Frameworks" ;;
  windows-*) program=$(dirname "$(find "$OUT/root" -maxdepth 4 -name soffice.exe | head -n1)") ;;
esac
# Chemin au format Windows pour l'exécutable (C:\…).
[ "${PLATFORM%%-*}" = windows ] && program=$(cygpath -w "$program")
[ -n "$program" ] && [ -d "$program" ] || { echo "Dossier du moteur introuvable" >&2; exit 1; }
echo "$program" > "$OUT/program-dir"
"$PY" -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$LOCK" > "$OUT/version"
echo "Moteur prêt : $program"
echo "export AUXI_LO_PROGRAM=\"$program\""
