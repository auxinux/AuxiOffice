#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
#
# Construit AuxiNux Office (avec AuxiText) sur la machine courante :
#   - Linux x86_64 (Debian 13, Ubuntu 24.04…) : paquets .deb et AppImage dans dist/linux/
#   - macOS Apple Silicon (macOS 11+)         : AuxiNux Office.app dans dist/macos/
#
#   git clone git@git.auxinux.ca:Auxinux/AuxiNux_Office.git
#   cd AuxiNux_Office
#   ./build.sh                 # build complet
#   ./build.sh --install       # macOS : copie aussi l'application dans /Applications
#   ./build.sh --clean         # repartir de zéro
#
# Durée : 30 à 60 minutes la première fois (téléchargements, compilation), moins ensuite.
# Le script s'arrête au premier échec ; aucun paquet n'est alors valide.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

INSTALL=0
ARGS=()
for a in "$@"; do
    case "$a" in
        --install) INSTALL=1 ;;
        -h|--help) sed -n '5,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) ARGS+=("$a") ;;
    esac
done

say()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mÉCHEC : %s\033[0m\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
# ---------------------------------------------------------------------------
Linux)
    [ "$(uname -m)" = "x86_64" ] || die "Linux : seule l'architecture x86_64 est prise en charge en 0.1.0"
    command -v python3 >/dev/null || die "python3 est requis (sudo apt install python3)"
    EXTRA=()
    # Debian/Ubuntu sans droits root : paquets de développement extraits localement
    if command -v apt-get >/dev/null && [ "$(id -u)" -ne 0 ]; then EXTRA+=(--local-deps); fi
    say "Build Linux (AuxiNux Office + AuxiText)"
    ./scripts/build-linux.sh --release ${EXTRA[@]+"${EXTRA[@]}"} ${ARGS[@]+"${ARGS[@]}"}
    say "Terminé. Paquets :"
    ls -lh dist/linux/
    echo
    echo "Installer : sudo apt install ./dist/linux/auxinux-office_$(cat VERSION)_amd64.deb"
    ;;
# ---------------------------------------------------------------------------
Darwin)
    [ "$(uname -m)" = "arm64" ] || die "macOS : seuls les Mac Apple Silicon (M1 et suivants) sont pris en charge"

    say "Vérification des outils"
    if ! xcode-select -p >/dev/null 2>&1; then
        echo "Les outils de ligne de commande d'Apple (compilateur, make, git) sont nécessaires."
        echo "Une fenêtre d'installation va s'ouvrir : acceptez, attendez la fin, puis relancez ./build.sh"
        xcode-select --install || true
        exit 1
    fi
    if ! command -v brew >/dev/null; then
        for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
    fi
    command -v brew >/dev/null || die "Homebrew est requis : voir https://brew.sh puis relancez ./build.sh"

    # Qt 5 (AuxiText), Node.js (page d'accueil, éditeurs), Python 3
    NEED=()
    brew list --versions qt@5 >/dev/null 2>&1 || NEED+=(qt@5)
    brew list --versions node >/dev/null 2>&1 || NEED+=(node)
    command -v python3 >/dev/null || NEED+=(python)
    if [ ${#NEED[@]} -gt 0 ]; then
        say "Installation avec Homebrew : ${NEED[*]}"
        brew install ${NEED[@]+"${NEED[@]}"}
    fi
    export PATH="$(brew --prefix node)/bin:$PATH"

    say "Build macOS (AuxiNux Office + AuxiText)"
    python3 scripts/auxibuild all --target macos --mode release ${ARGS[@]+"${ARGS[@]}"}

    APP="build/stage/macos/AuxiNux Office.app"
    if [ $INSTALL -eq 1 ]; then
        say "Installation dans /Applications"
        rm -rf "/Applications/AuxiNux Office.app"
        ditto "$APP" "/Applications/AuxiNux Office.app"
        # enregistre AuxiText (adresse auxitext://, « Ouvrir avec ») auprès de macOS
        LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
        "$LSREG" -f "/Applications/AuxiNux Office.app" "/Applications/AuxiNux Office.app/Contents/Applications/AuxiText.app" || true
        echo "Installé : /Applications/AuxiNux Office.app"
    fi
    say "Terminé."
    ls -lh dist/macos/
    echo
    echo "Application : $ROOT/$APP"
    [ $INSTALL -eq 1 ] || echo "Pour l'installer : ./build.sh --install (ou glissez l'application dans Applications)"
    ;;
*)
    die "système non pris en charge : $(uname -s). Sous Windows, utilisez build.ps1"
    ;;
esac
