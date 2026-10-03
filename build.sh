#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
#
# Construit AuxiNux Office (avec AuxiText) sur la machine courante :
#   - Linux x86_64 (Debian 13, Ubuntu 24.04…) : paquets .deb et AppImage dans dist/linux/
#   - macOS Apple Silicon (macOS 11+)         : AuxiNuxOffice.app (+ AuxiText) dans dist/macos/
#
#   git clone git@git.auxinux.ca:Auxinux/AuxiNux_Office.git
#   cd AuxiNux_Office
#   ./build.sh                 # build complet (Linux : paquets manquants installés avec apt ;
#                              #  macOS : outils installés avec Homebrew)
#   ./build.sh --clean         # repartir de zéro
#
# Durée : 30 à 60 minutes la première fois (téléchargements, compilation), moins ensuite.
# Le script s'arrête au premier échec ; aucun paquet n'est alors valide.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ARGS=()
for a in "$@"; do
    case "$a" in
        -h|--help) sed -n '5,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) ARGS+=("$a") ;;
    esac
done

say()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mÉCHEC : %s\033[0m\n' "$*" >&2; exit 1; }

# Espace disque : sources, moteur upstream, arbres de build et paquets (environ 15 à 20 Go)
NEED_GB=20
FREE_KB=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
if [ -z "${AUXI_SKIP_SPACE_CHECK:-}" ] && [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt $((NEED_GB * 1024 * 1024)) ]; then
    die "espace libre insuffisant dans $ROOT : $((FREE_KB / 1024 / 1024)) Go, ${NEED_GB} Go nécessaires.
  /tmp est souvent en mémoire vive (tmpfs) et trop petit : clonez le projet dans votre dossier
  personnel (ex. ~/AuxiNux_Office) puis relancez ./build.sh (vérification à ignorer :
  AUXI_SKIP_SPACE_CHECK=1 ./build.sh)"
fi

case "$(uname -s)" in
# ---------------------------------------------------------------------------
Linux)
    [ "$(uname -m)" = "x86_64" ] || die "Linux : seule l'architecture x86_64 est prise en charge en 0.1.0"
    EXTRA=()
    # AuxiNux OS : apt/apt-get sont désactivés, les paquets Debian s'installent avec « auxi »
    AUXINUXOS=0
    if command -v auxi >/dev/null || grep -qi '^ID=.*auxinux' /etc/os-release 2>/dev/null; then AUXINUXOS=1; fi
    if command -v dpkg-query >/dev/null; then
        # Paquets nécessaires au build (compilation, page d'accueil et éditeurs, paquets .deb et
        # AppImage, tests graphiques sans écran) : installés s'ils manquent.
        REQ=(build-essential pkg-config git curl ca-certificates python3 python3-venv nodejs npm
             fakeroot dpkg-dev desktop-file-utils file xz-utils
             libgtk-3-dev libglib2.0-dev libnotify-dev libcups2-dev libx11-dev libx11-xcb-dev
             libxcb1-dev libxext-dev libdbus-1-dev libpulse-dev libgl-dev libatk1.0-dev
             xvfb xdotool strace)
        NEED=()
        for p in "${REQ[@]}"; do
            dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" || NEED+=("$p")
        done
        if [ ${#NEED[@]} -gt 0 ]; then
            SUDO=()
            [ "$(id -u)" -ne 0 ] && SUDO=(sudo)
            if [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null; then
                if [ "$AUXINUXOS" -eq 1 ]; then
                    say "AuxiNux OS : installation des paquets nécessaires (auxi install --deb) : ${NEED[*]}"
                    ${SUDO[@]+"${SUDO[@]}"} auxi install --deb "${NEED[@]}"
                else
                    say "Installation des paquets nécessaires avec apt : ${NEED[*]}"
                    ${SUDO[@]+"${SUDO[@]}"} apt-get update
                    ${SUDO[@]+"${SUDO[@]}"} apt-get install -y "${NEED[@]}"
                fi
            elif [ "$AUXINUXOS" -eq 1 ]; then
                die "paquets manquants : ${NEED[*]} — installez-les avec : sudo auxi install --deb ${NEED[*]}"
            else
                # Sans sudo : paquets de développement extraits localement (outils de base requis)
                say "sudo indisponible : paquets de développement extraits localement (--local-deps)"
                EXTRA+=(--local-deps)
            fi
        fi
    fi
    command -v python3 >/dev/null || die "python3 est requis (sudo apt install python3)"
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

    # Qt 5 (AuxiText), Node.js (page d'accueil, éditeurs), optimiseurs d'images natifs Apple Silicon
    # (ceux fournis par npm sont des programmes Intel), Python 3
    NEED=()
    # sevenzip : lecture de l'image disque d'ONLYOFFICE sans la monter
    for f in qt@5 node gifsicle optipng jpeg-turbo sevenzip; do
        brew list --versions "$f" >/dev/null 2>&1 || NEED+=("$f")
    done
    command -v python3 >/dev/null || NEED+=(python)
    if [ ${#NEED[@]} -gt 0 ]; then
        say "Installation avec Homebrew : ${NEED[*]}"
        brew install ${NEED[@]+"${NEED[@]}"}
    fi
    export PATH="$(brew --prefix node)/bin:$PATH"

    say "Build macOS (AuxiNux Office + AuxiText)"
    python3 scripts/auxibuild all --target macos --mode release ${ARGS[@]+"${ARGS[@]}"}

    # Fait connaître AuxiText.app à macOS (adresse auxitext:// de la tuile « Nouveau fichier texte »,
    # « Ouvrir avec ») : simple enregistrement, rien n'est copié ni installé.
    TEXT_APP="build/stage/macos/AuxiNuxOffice.app/Contents/Applications/AuxiText.app"
    LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
    [ -d "$TEXT_APP" ] && [ -x "$LSREG" ] && "$LSREG" -f "$TEXT_APP" || true

    say "Terminé."
    ls -lh dist/macos/
    echo
    echo "Application : $ROOT/build/stage/macos/AuxiNuxOffice.app"
    echo "Archive     : $ROOT/dist/macos/AuxiNuxOffice-$(cat VERSION)-arm64.zip"
    ;;
*)
    die "système non pris en charge : $(uname -s). Sous Windows, utilisez build.ps1"
    ;;
esac
