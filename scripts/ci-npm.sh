#!/bin/sh
# Installe les dépendances npm de chaque interface et les compile (vérification
# TypeScript, tests unitaires, puis Vite) : la coque intègre leur dossier dist/.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
for dir in app text; do
  [ -f "$ROOT/$dir/package.json" ] || continue
  echo "== $dir"
  (cd "$ROOT/$dir" && npm ci && npm run --silent typecheck && npx vitest run --reporter=dot && npm run build)
done
