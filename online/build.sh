#!/usr/bin/env bash
# Construit AuxiOffice Online :
#   1. les modules WebAssembly d'AuxiText (encodages) et d'AuxiSheet Lite
#      (IronCalc) : Rust → wasm32, wasm-bindgen ;
#   2. l'interface web (portail + applications du bureau, voir web/vite.config.ts) ;
#   3. le serveur auxi-online et le moteur auxi-engine (Rust, --release).
#
# Utilisation : online/build.sh [--debug] [--web-only] [--server-only]
# Prérequis : Rust (cible wasm32-unknown-unknown), wasm-bindgen-cli à la
# version du crate (voir textio-wasm/Cargo.toml), Node.js 20+.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
profile=release
web=1
server=1
for a in "$@"; do
  case "$a" in
    --debug) profile=debug ;;
    --web-only) server=0 ;;
    --server-only) web=0 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "option inconnue : $a" >&2; exit 2 ;;
  esac
done
# Pas de tableau : le bash 3.2 de macOS refuse un tableau vide avec « set -u ».
release_flag=""
[ "$profile" = release ] && release_flag="--release"

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 introuvable : $2" >&2; exit 1; }; }

if [ "$web" = 1 ]; then
  need cargo "installez Rust (https://rustup.rs)"
  need wasm-bindgen "cargo install wasm-bindgen-cli --version $(sed -n 's/^wasm-bindgen = \"=\(.*\)\"/\1/p' "$here/textio-wasm/Cargo.toml")"
  need npm "installez Node.js 20 ou plus récent"
  rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown

  echo "== Module WebAssembly d'AuxiText"
  (cd "$repo" && cargo build -p auxitext-textio-wasm --target wasm32-unknown-unknown --release)
  wasm-bindgen --target web --out-dir "$here/web/wasm" "$repo/target/wasm32-unknown-unknown/release/auxitext_textio_wasm.wasm"

  echo "== Module WebAssembly d'AuxiSheet Lite (IronCalc)"
  (cd "$here/sheet-wasm" && cargo build --target wasm32-unknown-unknown --release)
  wasm-bindgen --target web --out-dir "$here/web/wasm" "$here/sheet-wasm/target/wasm32-unknown-unknown/release/auxisheet_lite_wasm.wasm"

  echo "== Interface web"
  for d in app text online/web; do
    [ -d "$repo/$d/node_modules" ] || (cd "$repo/$d" && npm ci --no-audit --no-fund)
  done
  (cd "$here/web" && npm run build)
fi

if [ "$server" = 1 ]; then
  echo "== Serveur et moteur"
  (cd "$repo" && cargo build $release_flag -p auxi-online -p auxi-engine)
fi

echo
echo "Prêt. Essai local (sans comptes) :"
echo "  $repo/target/$profile/auxi-online --no-auth"
echo "puis http://127.0.0.1:8090/"
