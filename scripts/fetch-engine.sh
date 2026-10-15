#!/bin/sh
# Télécharge et prépare le moteur LibreOffice d'AuxiOffice (Linux x86_64),
# selon engine/libreoffice.lock.json, dans .engine/linux-x86_64/.
# Chaque fichier est vérifié par SHA-256. Aucun droit administrateur requis.
#
# Usage : scripts/fetch-engine.sh [--sdk]
# Affiche à la fin le dossier program/ à passer dans AUXI_LO_PROGRAM.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOCK="$ROOT/engine/libreoffice.lock.json"
OUT="$ROOT/.engine/linux-x86_64"
CACHE="$ROOT/.engine/cache"
mkdir -p "$OUT" "$CACHE"

sets="linux-x86_64"
[ "${1:-}" = "--sdk" ] && sets="$sets sdk-linux-x86_64"

base=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['base_url'])" "$LOCK")
for set in $sets; do
  python3 -c "
import json,sys
for e in json.load(open(sys.argv[1]))[sys.argv[2]]: print(e['file'], e['sha256'])" "$LOCK" "$set" |
  while read -r file sum; do
    name=$(basename "$file")
    dest="$CACHE/$name"
    if [ ! -f "$dest" ] || ! echo "$sum  $dest" | sha256sum -c --quiet - 2>/dev/null; then
      echo "Téléchargement de $name…"
      curl -fL --retry 3 -o "$dest.part" "$base/$file"
      mv "$dest.part" "$dest"
    fi
    echo "$sum  $dest" | sha256sum -c --quiet - || { echo "Somme SHA-256 incorrecte : $name" >&2; exit 1; }
    work="$CACHE/x-$name"
    rm -rf "$work"; mkdir -p "$work"
    tar xzf "$dest" -C "$work"
    for deb in $(find "$work" -name '*.deb' | sort); do
      if command -v dpkg-deb >/dev/null; then
        dpkg-deb -x "$deb" "$OUT/root"
      else
        (cd "$work" && ar x "$deb" data.tar.xz && tar xJf data.tar.xz -C "$OUT/root" && rm -f data.tar.xz)
      fi
    done
    rm -rf "$work"
  done
done

program=$(find "$OUT/root/opt" -maxdepth 2 -type d -name program | head -n1)
[ -n "$program" ] || { echo "Dossier program/ introuvable" >&2; exit 1; }
echo "$program" > "$OUT/program-dir"
echo "Moteur prêt : $program"
echo "export AUXI_LO_PROGRAM=$program"
