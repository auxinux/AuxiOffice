# Prérequis de compilation : vérifie les outils et propose d'installer ce qui
# manque, avec le gestionnaire de paquets du système.
#
#   . scripts/lib/prereqs.sh
#   prereqs [auxitext] [deb] [installer]
#
#   auxitext   AuxiText seul : ni moteur ni Python
#   deb        paquets Debian : dpkg-deb, fakeroot
#   installer  installateurs Windows : Inno Setup 6
#
# Linux : apt (Debian, Ubuntu), auxi install --deb (AuxiNuxOS), dnf, pacman.
# Windows (Git Bash) : winget. macOS : Homebrew, rustup, outils Xcode.
#
# AUXI_INSTALL=oui installe sans demander ; AUXI_INSTALL=non n'installe rien.
# Hors d'un terminal (CI), les commandes sont affichées et le script s'arrête.

PR_NODE_MIN=20.19   # Vite 7 (Debian 13 fournit Node.js 20.19)
PR_RUST_MIN=1.85

# _pr_ge A B : vrai si la version A >= B (1.90.0 >= 1.85).
_pr_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    n = split(a, x, "."); m = split(b, y, "."); if (m > n) n = m
    for (i = 1; i <= n; i++) { p = x[i] + 0; q = y[i] + 0; if (p > q) exit 0; if (p < q) exit 1 }
    exit 0 }'
}

_pr_need() { PR_MISSING="$PR_MISSING
  - $1"; }
_pr_step() { PR_STEPS="$PR_STEPS
$1"; }
_pr_manual() { PR_MANUAL="$PR_MANUAL
  - $1"; }
_pr_pkg() { [ -n "$1" ] && PR_PKGS="$PR_PKGS $1"; return 0; }

# Gestionnaire de paquets Linux et nom des paquets pour chaque besoin.
_pr_linux_pm() {
  PR_SUDO=""
  [ "$(id -u)" = 0 ] || PR_SUDO="sudo "
  if command -v auxi >/dev/null 2>&1 && grep -qi auxinux /etc/os-release 2>/dev/null; then
    PR_PM=auxi PR_PM_CMD="${PR_SUDO}auxi install --deb"
  elif command -v apt-get >/dev/null 2>&1; then
    PR_PM=apt PR_PM_CMD="${PR_SUDO}apt-get install -y --no-install-recommends"
  elif command -v dnf >/dev/null 2>&1; then
    PR_PM=dnf PR_PM_CMD="${PR_SUDO}dnf install -y"
  elif command -v pacman >/dev/null 2>&1; then
    PR_PM=pacman PR_PM_CMD="${PR_SUDO}pacman -S --needed --noconfirm"
  else
    PR_PM="" PR_PM_CMD=""
  fi
}

_pr_linux_name() {
  case "$PR_PM:$1" in
    apt:cc|auxi:cc) echo build-essential ;;
    dnf:cc) echo "gcc gcc-c++ make" ;;
    pacman:cc) echo base-devel ;;
    pacman:pkgconfig) echo pkgconf ;;
    *:pkgconfig) echo pkg-config ;;
    pacman:python) echo python ;;
    *:python) echo python3 ;;
    pacman:npm|dnf:npm) echo npm ;;
    *:nodejs) echo nodejs ;;
    *:npm) echo npm ;;
    *:curl) echo curl ;;
    *:fakeroot) echo fakeroot ;;
    apt:dpkg|auxi:dpkg) echo dpkg-dev ;;
    *:dpkg) echo dpkg ;;
    dnf:webkit2gtk-4.1) echo webkit2gtk4.1-devel ;;
    dnf:gtk+-3.0) echo gtk3-devel ;;
    dnf:libsoup-3.0) echo libsoup3-devel ;;
    pacman:webkit2gtk-4.1) echo webkit2gtk-4.1 ;;
    pacman:gtk+-3.0) echo gtk3 ;;
    pacman:libsoup-3.0) echo libsoup3 ;;
    *:webkit2gtk-4.1) echo libwebkit2gtk-4.1-dev ;;
    *:gtk+-3.0) echo libgtk-3-dev ;;
    *:libsoup-3.0) echo libsoup-3.0-dev ;;
  esac
}

# Outils installés mais absents du PATH de ce shell (installation toute récente).
_pr_path() {
  PATH="$HOME/.cargo/bin:$PATH"
  case "$PR_OS" in
    windows)
      [ -n "${USERPROFILE:-}" ] && PATH="$(cygpath -u "$USERPROFILE")/.cargo/bin:$PATH"
      PATH="/c/Program Files/nodejs:$PATH"
      if [ -n "${LOCALAPPDATA:-}" ]; then
        for d in "$(cygpath -u "$LOCALAPPDATA")"/Programs/Python/Python3*; do
          [ -d "$d" ] && PATH="$d:$d/Scripts:$PATH"
        done
      fi ;;
    macos)
      for d in /opt/homebrew/bin /usr/local/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done ;;
  esac
  export PATH
}

_pr_python() {
  python3 -c "" >/dev/null 2>&1 || python -c "" >/dev/null 2>&1
}

_pr_vswhere() {
  vsw="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
  [ -f "$vsw" ] && [ -n "$("$vsw" -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null | tr -d '\r')" ]
}

_pr_inno() {
  for c in "${ISCC_EXE:-}" "$(command -v ISCC.exe 2>/dev/null || true)" \
    "/c/Program Files (x86)/Inno Setup 6/ISCC.exe" "/c/Program Files/Inno Setup 6/ISCC.exe" \
    "$(cygpath -u "${LOCALAPPDATA:-C:/}")/Programs/Inno Setup 6/ISCC.exe"; do
    [ -n "$c" ] && [ -f "$c" ] && return 0
  done
  return 1
}

# Contrôle intelligent des applications actif (1 ; 0 : désactivé, 2 : évaluation).
_pr_sac() {
  MSYS2_ARG_CONV_EXCL='*' reg.exe query 'HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy' \
    /v VerifiedAndReputablePolicyState 2>/dev/null | tr -d '\r' | grep -q 'REG_DWORD[[:space:]]*0x1$'
}

_pr_winget() { echo "winget install -e --id $1 --accept-package-agreements --accept-source-agreements${2:+ $2}"; }

# Remplit PR_MISSING, PR_PKGS, PR_STEPS et PR_MANUAL.
_pr_check() {
  PR_MISSING="" PR_PKGS="" PR_STEPS="" PR_MANUAL="" pr_brew=""

  # Outils Xcode (macOS) : une fenêtre d'installation, on ne peut pas l'attendre.
  if [ "$PR_OS" = macos ] && ! xcrun --show-sdk-path >/dev/null 2>&1; then
    _pr_need "outils Xcode en ligne de commande"
    _pr_manual "lancez « xcode-select --install », terminez l'installation, puis relancez ce script"
  fi

  # Compilateur C, pkg-config et bibliothèques de la fenêtre (Linux).
  if [ "$PR_OS" = linux ]; then
    command -v cc >/dev/null 2>&1 || { _pr_need "compilateur C/C++"; _pr_pkg "$(_pr_linux_name cc)"; }
    command -v curl >/dev/null 2>&1 || { _pr_need "curl"; _pr_pkg "$(_pr_linux_name curl)"; }
    if command -v pkg-config >/dev/null 2>&1; then
      for lib in webkit2gtk-4.1 gtk+-3.0 libsoup-3.0; do
        pkg-config --exists "$lib" || { _pr_need "bibliothèque $lib (développement)"; _pr_pkg "$(_pr_linux_name "$lib")"; }
      done
    else
      _pr_need "pkg-config et bibliothèques WebKitGTK, GTK 3, libsoup 3 (développement)"
      _pr_pkg "$(_pr_linux_name pkgconfig)"
      for lib in webkit2gtk-4.1 gtk+-3.0 libsoup-3.0; do _pr_pkg "$(_pr_linux_name "$lib")"; done
    fi
  fi

  # Contrôle intelligent des applications (Windows 11) : il bloque les programmes
  # non signés que Rust compile puis lance (build.rs : « os error 4551 »).
  if [ "$PR_OS" = windows ] && _pr_sac; then
    _pr_need "Contrôle intelligent des applications (Smart App Control) désactivé"
    _pr_manual "Sécurité Windows → Contrôle des applications et du navigateur → Paramètres du contrôle intelligent des applications → Désactivé, puis relancez ce script (il bloque les programmes compilés : « os error 4551 »)"
  fi

  # Outils MSVC (Windows) : l'éditeur de liens de Rust.
  if [ "$PR_OS" = windows ] && ! _pr_vswhere; then
    _pr_need "outils de compilation C++ de Visual Studio (MSVC)"
    _pr_step "$(_pr_winget Microsoft.VisualStudio.2022.BuildTools '--override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"')"
  fi

  # Node.js et npm.
  node_v=$(node --version 2>/dev/null | tr -d 'v\r' || true)
  if [ -z "$node_v" ]; then
    _pr_need "Node.js $PR_NODE_MIN+ et npm"
    case "$PR_OS" in
      linux) _pr_pkg "$(_pr_linux_name nodejs)"; _pr_pkg "$(_pr_linux_name npm)" ;;
      windows) _pr_step "$(_pr_winget OpenJS.NodeJS.LTS)" ;;
      macos) pr_brew=1; _pr_step "brew install node" ;;
    esac
  elif ! _pr_ge "$node_v" "$PR_NODE_MIN"; then
    _pr_need "Node.js $PR_NODE_MIN+ (trouvé : v$node_v)"
    case "$PR_OS" in
      windows) _pr_step "winget upgrade -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements || $(_pr_winget OpenJS.NodeJS.LTS)" ;;
      macos) pr_brew=1; _pr_step "brew upgrade node || brew install node" ;;
      *) _pr_manual "Node.js $PR_NODE_MIN ou plus récent : https://nodejs.org/fr/download (la version du système est trop ancienne)" ;;
    esac
  elif ! npm --version >/dev/null 2>&1; then
    _pr_need "npm"
    case "$PR_OS" in
      linux) _pr_pkg "$(_pr_linux_name npm)" ;;
      *) _pr_manual "npm (fourni avec Node.js) : réinstallez Node.js depuis https://nodejs.org" ;;
    esac
  fi

  # Python (préparation du moteur).
  if [ -z "$PR_TEXT_ONLY" ] && ! _pr_python; then
    _pr_need "Python 3"
    case "$PR_OS" in
      linux) _pr_pkg "$(_pr_linux_name python)" ;;
      windows) _pr_step "$(_pr_winget Python.Python.3.13)" ;;
      macos) pr_brew=1; _pr_step "brew install python" ;;
    esac
  fi

  # Moteur macOS : compilé avec des outils Homebrew (scripts/build-engine-macos.sh).
  [ "$PR_OS" = macos ] && [ -z "$PR_TEXT_ONLY" ] && [ ! -f .engine/macos-aarch64/program-dir ] && pr_brew=1

  # Paquets Debian.
  if [ -n "$PR_DEB" ]; then
    command -v dpkg-deb >/dev/null 2>&1 || { _pr_need "dpkg-deb"; _pr_pkg "$(_pr_linux_name dpkg)"; }
    command -v fakeroot >/dev/null 2>&1 || { _pr_need "fakeroot"; _pr_pkg "$(_pr_linux_name fakeroot)"; }
  fi

  # Installateurs Windows.
  if [ -n "$PR_INSTALLER" ] && [ "$PR_OS" = windows ] && ! _pr_inno; then
    _pr_need "Inno Setup 6 (installateurs)"
    _pr_step "$(_pr_winget JRSoftware.InnoSetup)"
  fi

  # Rust, après le reste (rustup a besoin de curl ; sous Windows, de MSVC).
  cargo_v=$(cargo --version 2>/dev/null | awk '{print $2}' || true)
  if [ -z "$cargo_v" ]; then
    _pr_need "Rust $PR_RUST_MIN+ (cargo)"
    if rustup --version >/dev/null 2>&1; then
      _pr_step "rustup default stable"
    elif [ "$PR_OS" = windows ]; then
      _pr_step "$(_pr_winget Rustlang.Rustup)"
      _pr_step "rustup default stable"
    else
      _pr_step "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    fi
  elif ! _pr_ge "${cargo_v%%-*}" "$PR_RUST_MIN"; then
    _pr_need "Rust $PR_RUST_MIN+ (trouvé : $cargo_v)"
    if rustup --version >/dev/null 2>&1; then
      _pr_step "rustup update stable && rustup default stable"
    else
      _pr_manual "Rust $PR_RUST_MIN ou plus récent : https://rustup.rs (la version du système est trop ancienne)"
    fi
  fi

  # Homebrew, s'il sert et qu'il manque : installé en premier.
  if [ -n "$pr_brew" ] && ! command -v brew >/dev/null 2>&1; then
    _pr_need "Homebrew"
    PR_STEPS="/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"$PR_STEPS"
  fi

  # Paquets Linux : une seule commande, en premier.
  if [ -n "$PR_PKGS" ]; then
    if [ -n "$PR_PM_CMD" ]; then
      [ "$PR_PM" = apt ] && PR_PKGS_CMD="${PR_SUDO}apt-get update && $PR_PM_CMD$PR_PKGS" || PR_PKGS_CMD="$PR_PM_CMD$PR_PKGS"
      PR_STEPS="$PR_PKGS_CMD$PR_STEPS"
    else
      _pr_manual "installez avec le gestionnaire de paquets du système :$PR_PKGS"
    fi
  fi
  PR_STEPS=$(printf '%s\n' "$PR_STEPS" | sed '/^$/d')
  return 0
}

_pr_die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }

prereqs() {
  PR_TEXT_ONLY="" PR_DEB="" PR_INSTALLER=""
  for a in "$@"; do
    case $a in
      auxitext) PR_TEXT_ONLY=1 ;;
      deb) PR_DEB=1 ;;
      installer) PR_INSTALLER=1 ;;
    esac
  done
  case "$(uname -s)" in
    Linux) PR_OS=linux; _pr_linux_pm ;;
    Darwin) PR_OS=macos ;;
    MINGW*|MSYS*|CYGWIN*) PR_OS=windows ;;
    *) PR_OS=autre ;;
  esac
  _pr_path
  _pr_check
  [ -z "$PR_MISSING" ] && return 0

  printf '\n== Prérequis manquants%s\n' "$PR_MISSING"
  if [ -n "$PR_MANUAL" ]; then
    printf '\nÀ faire vous-même :%s\n' "$PR_MANUAL"
    [ -n "$PR_STEPS" ] && printf '\nPuis, automatiquement :\n%s\n' "$(printf '%s\n' "$PR_STEPS" | sed 's/^/  /')"
    _pr_die "prérequis à installer (voir ci-dessus et BUILD.md)"
  fi
  if [ "$PR_OS" = windows ] && ! command -v winget >/dev/null 2>&1; then
    _pr_die "winget introuvable (App Installer, Microsoft Store) : installez les outils ci-dessus à la main (voir BUILD.md)"
  fi
  printf '\nCommandes proposées :\n%s\n' "$(printf '%s\n' "$PR_STEPS" | sed 's/^/  /')"

  case "${AUXI_INSTALL:-}" in
    oui|yes|1) pr_rep=o ;;
    non|no|0) pr_rep=n ;;
    *)
      [ -t 0 ] || _pr_die "prérequis manquants (AUXI_INSTALL=oui pour les installer sans demander)"
      printf '\nInstaller maintenant ? [O/n] '
      read -r pr_rep || pr_rep=n ;;
  esac
  case $pr_rep in
    n*|N*) _pr_die "prérequis manquants : lancez les commandes ci-dessus, puis relancez ce script" ;;
  esac

  pr_old_ifs=$IFS
  set -f
  IFS='
'
  for pr_cmd in $PR_STEPS; do
    IFS=$pr_old_ifs
    printf '\n== %s\n' "$pr_cmd"
    sh -c "$pr_cmd" || _pr_die "échec de : $pr_cmd"
    # Homebrew : son dossier entre dans le PATH dès qu'il est installé.
    _pr_path
  done
  IFS=$pr_old_ifs
  set +f

  _pr_check
  if [ -n "$PR_MISSING" ]; then
    printf '\nToujours manquant :%s\n' "$PR_MISSING" >&2
    [ -n "$PR_MANUAL" ] && printf '%s\n' "$PR_MANUAL" >&2
    _pr_die "ouvrez un nouveau terminal (PATH mis à jour) et relancez ce script"
  fi
  printf '\n== Prérequis installés\n'
}
