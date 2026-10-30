#!/bin/sh
# Installe les applications pour l'utilisateur courant, à partir de la
# compilation du dépôt (sans droits d'administrateur) :
#   AuxiOffice (gestionnaire), AuxiWriter, AuxiSheet, AuxiPresent, AuxiDraw,
#   AuxiPDF, et AuxiText (éditeur de texte).
#
#   macOS      : ~/Applications/Auxi*.app (Finder, Launchpad, Dock, « Ouvrir avec »)
#   Linux      : menu des applications (~/.local/share/applications)
#   Windows 11 : %LOCALAPPDATA%\Programs\AuxiOffice et AuxiText, menu Démarrer,
#                « Ouvrir avec » (à lancer dans Git Bash)
#
#   scripts/install-apps.sh            compile (optimisé) puis installe
#   scripts/install-apps.sh --remove   retire les applications installées
#
# macOS et Linux : les applications utilisent le moteur LibreOffice et
# auxi-engine du dépôt ; relancer ce script après une recompilation. Windows :
# tout est copié dans le dossier d'installation (moteur compris).
# Le moteur est préparé s'il manque (Linux, Windows : téléchargé ; macOS :
# compilé, 1 à 3 h la première fois).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

APPS="office writer sheet present draw pdf"
name() { case $1 in office) echo AuxiOffice ;; writer) echo AuxiWriter ;; sheet) echo AuxiSheet ;; present) echo AuxiPresent ;; draw) echo AuxiDraw ;; pdf) echo AuxiPDF ;; esac; }
say() { printf '\n== %s\n' "$*"; }
die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos; DEST="$HOME/Applications" ;;
  Linux) OS=linux; DEST="${XDG_DATA_HOME:-$HOME/.local/share}" ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows; DEST=$(cygpath -u "${LOCALAPPDATA:?LOCALAPPDATA absent}")/Programs ;;
  *) die "système non pris en charge : $(uname -s)" ;;
esac
EXE=""
[ "$OS" = windows ] && EXE=.exe

# --- Windows 11 (Git Bash) ---------------------------------------------------

# Extensions proposées dans « Ouvrir avec » pour chaque application.
win_exts() {
  case $1 in
    writer) echo "docx docm doc dotx dotm odt ott rtf" ;;
    sheet) echo "xlsx xlsm xls xlsb xltx ods ots csv" ;;
    present) echo "pptx pptm ppt ppsx potx odp otp" ;;
    draw) echo "odg otg fodg vsdx vsd vsdm cdr pub svg" ;;
    pdf) echo "pdf" ;;
    text) echo "txt log md markdown json xml yaml yml ini conf cfg toml csv sh ps1 bat py js ts css html" ;;
  esac
}

# Exécute un script PowerShell (raccourcis du menu Démarrer, registre).
win_ps() {
  f=$(mktemp --suffix=.ps1)
  printf '%s\n' "$1" > "$f"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$f")"
  rm -f "$f"
}

WIN_MENU='$env:APPDATA\Microsoft\Windows\Start Menu\Programs'

remove_windows() {
  rm -rf "$DEST/AuxiOffice" "$DEST/AuxiText"
  win_ps "Remove-Item -Recurse -Force -ErrorAction SilentlyContinue \"$WIN_MENU\\AuxiOffice\", \"$WIN_MENU\\AuxiText.lnk\"
foreach (\$p in 'AuxiOffice.AuxiWriter','AuxiOffice.AuxiSheet','AuxiOffice.AuxiPresent','AuxiOffice.AuxiDraw','AuxiOffice.AuxiPDF','AuxiText.Document') {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue \"HKCU:\\Software\\Classes\\\$p\"
  Get-ChildItem 'HKCU:\\Software\\Classes' -ErrorAction SilentlyContinue | Where-Object { \$_.PSChildName -like '.*' } | ForEach-Object {
    Remove-ItemProperty -Path (Join-Path \$_.PSPath 'OpenWithProgids') -Name \$p -ErrorAction SilentlyContinue }
}"
}

install_windows() {
  base="$DEST/AuxiOffice"
  tbase="$DEST/AuxiText"
  say "AuxiOffice → $base"
  mkdir -p "$base/icons" "$tbase"
  for a in $APPS; do
    # Une copie par application : son nom choisit l'application (apps.rs)
    # et Windows groupe ses fenêtres à part dans la barre des tâches.
    cp "$BIN" "$base/$(name "$a").exe" || die "copie impossible : fermez $(name "$a") puis relancez"
    cp "$ROOT/branding/generated/ico/auxi$a.ico" "$base/icons/"
  done
  cp "$ROOT/target/release/auxi-engine.exe" "$base/"
  rm -rf "$base/templates" && mkdir -p "$base/templates"
  cp "$ROOT"/app/src-tauri/templates/vierge.* "$base/templates/"
  # Moteur : copie du LibreOffice extrait (une seule fois par version).
  program=$(cygpath -u "$(cat "$ROOT/.engine/windows-x86_64/program-dir")")
  if ! cmp -s "$ROOT/.engine/windows-x86_64/version" "$base/engine.version" 2>/dev/null; then
    say "Copie du moteur LibreOffice (quelques minutes)"
    rm -rf "$base/engine"
    cp -r "$(dirname "$program")" "$base/engine"
    cp "$ROOT/.engine/windows-x86_64/version" "$base/engine.version"
  fi
  say "AuxiText → $tbase"
  cp "$TEXT_BIN" "$tbase/AuxiText.exe" || die "copie impossible : fermez AuxiText puis relancez"
  cp "$ROOT/text/src-tauri/icons/icon.ico" "$tbase/AuxiText.ico"

  say "Menu Démarrer et « Ouvrir avec »"
  wbase=$(cygpath -w "$base")
  wtext=$(cygpath -w "$tbase")
  script="\$menu = \"$WIN_MENU\\AuxiOffice\"
New-Item -ItemType Directory -Force -Path \$menu | Out-Null
\$sh = New-Object -ComObject WScript.Shell
function Lien(\$lnk, \$exe, \$ico, \$desc) { \$l = \$sh.CreateShortcut(\$lnk); \$l.TargetPath = \$exe; \$l.IconLocation = \$ico; \$l.Description = \$desc; \$l.WorkingDirectory = [Environment]::GetFolderPath('MyDocuments'); \$l.Save() }
function Assoc(\$progid, \$label, \$exe, \$ico, \$exts) {
  \$k = \"HKCU:\\Software\\Classes\\\$progid\"
  New-Item -Force -Path \"\$k\\shell\\open\\command\" | Out-Null
  Set-Item -Path \$k -Value \$label
  New-Item -Force -Path \"\$k\\DefaultIcon\" -Value \$ico | Out-Null
  Set-Item -Path \"\$k\\shell\\open\\command\" -Value ('\"' + \$exe + '\" \"%1\"')
  foreach (\$e in \$exts) {
    \$o = \"HKCU:\\Software\\Classes\\.\$e\\OpenWithProgids\"
    New-Item -Force -Path \$o | Out-Null
    New-ItemProperty -Force -Path \$o -Name \$progid -PropertyType None -Value ([byte[]]@()) | Out-Null
  }
}"
  for a in $APPS; do
    n=$(name "$a")
    script="$script
Lien \"\$menu\\$n.lnk\" '$wbase\\$n.exe' '$wbase\\icons\\auxi$a.ico' '$n'"
    [ "$a" = office ] && continue
    exts=$(win_exts "$a" | sed "s/[a-z0-9]*/'&'/g; s/ /,/g")
    script="$script
Assoc 'AuxiOffice.$n' 'Document $n' '$wbase\\$n.exe' '$wbase\\icons\\auxi$a.ico' @($exts)"
  done
  exts=$(win_exts text | sed "s/[a-z0-9]*/'&'/g; s/ /,/g")
  script="$script
Lien \"$WIN_MENU\\AuxiText.lnk\" '$wtext\\AuxiText.exe' '$wtext\\AuxiText.ico' 'Éditeur de texte'
Assoc 'AuxiText.Document' 'Texte (AuxiText)' '$wtext\\AuxiText.exe' '$wtext\\AuxiText.ico' @($exts)"
  win_ps "$script"
  say "Installé : AuxiOffice, AuxiWriter, AuxiSheet, AuxiPresent, AuxiDraw, AuxiPDF (menu Démarrer → AuxiOffice) et AuxiText"
  echo "Pour en faire l'application par défaut d'un type de fichier : clic droit → Ouvrir avec → Choisir une autre application."
}

if [ "${1:-}" = "--remove" ]; then
  if [ "$OS" = windows ]; then
    remove_windows
    echo "Applications retirées."
    exit 0
  fi
  rm -rf "$DEST/AuxiText.app"
  rm -f "$DEST/applications/ca.auxinux.AuxiText.desktop" "$DEST/icons/hicolor/scalable/apps/auxitext.svg"
  for a in $APPS; do
    n=$(name "$a")
    if [ "$OS" = macos ]; then
      rm -rf "$DEST/$n.app"
    else
      rm -f "$DEST/applications/ca.auxinux.$a.desktop" "$DEST/icons/hicolor/scalable/apps/auxi$a.svg"
    fi
  done
  echo "Applications retirées."
  exit 0
fi

. "$ROOT/scripts/lib/prereqs.sh"
prereqs

say "Moteur LibreOffice"
if ! ls .engine/*/program-dir >/dev/null 2>&1; then
  if [ "$OS" = macos ]; then scripts/build-engine-macos.sh; else scripts/fetch-engine.sh; fi
fi
ls .engine/*/program-dir >/dev/null 2>&1 || die "moteur LibreOffice absent (voir BUILD.md)"

say "Compilation"
for dir in app text; do
  (cd "$dir" && { [ -d node_modules ] || npm install --no-audit --no-fund; } && npm run --silent build)
done
cargo build --release -p auxi-engine -p auxioffice -p auxitext --features auxioffice/custom-protocol,auxitext/custom-protocol
BIN="$ROOT/target/release/auxioffice$EXE"
TEXT_BIN="$ROOT/target/release/auxitext$EXE"
[ -x "$BIN" ] || die "exécutable introuvable : $BIN"

# --- macOS -------------------------------------------------------------------

. "$ROOT/scripts/lib/macos-apps.sh"

install_macos() {
  version=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -n1)
  mkdir -p "$DEST"
  for a in $APPS; do
    n=$(name "$a")
    app="$DEST/$n.app"
    say "$n → $app"
    mac_app "$a" "$DEST" "$BIN" "$version"
    # Moteur, LibreOffice et modèles : ceux du dépôt.
    echo "$ROOT" > "$app/Contents/Resources/dev-root"
    codesign --force -s - "$app" >/dev/null 2>&1 || echo "  (signature locale impossible : l'application peut demander une confirmation au premier lancement)"
  done
  # AuxiText : application autonome (son propre exécutable).
  app="$DEST/AuxiText.app"
  say "AuxiText → $app"
  mac_text_app "$DEST" "$TEXT_BIN" "$version"
  codesign --force -s - "$app" >/dev/null 2>&1 || true
  LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  for a in $APPS; do [ -x "$LSREG" ] && "$LSREG" -f "$DEST/$(name "$a").app" || true; done
  [ -x "$LSREG" ] && "$LSREG" -f "$DEST/AuxiText.app" || true
  say "Installé dans $DEST : AuxiOffice, AuxiWriter, AuxiSheet, AuxiPresent, AuxiDraw, AuxiPDF, AuxiText"
  echo "Finder → Applications (de votre dossier personnel), Launchpad, ou : open -a AuxiWriter"
}

# --- Linux -------------------------------------------------------------------

install_linux() {
  apps_dir="$DEST/applications"
  icons_dir="$DEST/icons/hicolor/scalable/apps"
  mkdir -p "$apps_dir" "$icons_dir"
  for a in $APPS; do
    n=$(name "$a")
    # Lien `auxiwriter` → `auxioffice` : l'application est reconnue à son nom
    # d'appel et la fenêtre reçoit sa propre classe (icône dans la barre des tâches).
    [ "$a" = office ] || ln -sf auxioffice "$ROOT/target/release/auxi$a"
    exe="$ROOT/target/release/auxi$a"
    cp "$ROOT/app/ui/public/icons/auxi$a.svg" "$icons_dir/auxi$a.svg"
    case $a in
      office) comment="Créer et ouvrir des documents, des classeurs, des présentations et des dessins"; cats="Office;"; mime="" ;;
      writer) comment="Traitement de texte"; cats="Office;WordProcessor;"
        mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document;application/vnd.ms-word.document.macroEnabled.12;application/msword;application/vnd.oasis.opendocument.text;application/rtf;text/rtf;" ;;
      sheet) comment="Tableur"; cats="Office;Spreadsheet;"
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;application/vnd.ms-excel.sheet.macroEnabled.12;application/vnd.ms-excel;application/vnd.oasis.opendocument.spreadsheet;text/csv;" ;;
      present) comment="Présentations"; cats="Office;Presentation;"
        mime="application/vnd.openxmlformats-officedocument.presentationml.presentation;application/vnd.ms-powerpoint.presentation.macroEnabled.12;application/vnd.ms-powerpoint;application/vnd.oasis.opendocument.presentation;" ;;
      draw) comment="Dessin vectoriel et mise en page"; cats="Office;Graphics;VectorGraphics;"
        mime="application/vnd.oasis.opendocument.graphics;application/vnd.oasis.opendocument.graphics-template;application/vnd.visio;application/vnd.ms-visio.drawing.main+xml;" ;;
      pdf) comment="Lecteur de documents PDF"; cats="Office;Viewer;"; mime="application/pdf;" ;;
    esac
    {
      echo "[Desktop Entry]"
      echo "Type=Application"
      echo "Name=$n"
      echo "Comment=$comment"
      echo "Exec=\"$exe\" %F"
      echo "Icon=auxi$a"
      echo "Terminal=false"
      echo "Categories=$cats"
      echo "StartupWMClass=auxi$a"
      [ -z "$mime" ] || echo "MimeType=$mime"
      case $a in office|pdf) ;; *) echo "Actions=new;" ;; esac
      if [ "$a" != office ] && [ "$a" != pdf ]; then
        echo
        echo "[Desktop Action new]"
        echo "Name=Nouveau"
        echo "Exec=\"$exe\" --new"
      fi
    } > "$apps_dir/ca.auxinux.$a.desktop"
    echo "  $n → $apps_dir/ca.auxinux.$a.desktop"
  done
  # AuxiText : son lanceur, avec le chemin de l'exécutable du dépôt.
  sed "s|^Exec=auxitext|Exec=\"$TEXT_BIN\"|" "$ROOT/text/src-tauri/linux/ca.auxinux.AuxiText.desktop" > "$apps_dir/ca.auxinux.AuxiText.desktop"
  cp "$ROOT/text/src-tauri/icons/auxitext.svg" "$icons_dir/auxitext.svg"
  echo "  AuxiText → $apps_dir/ca.auxinux.AuxiText.desktop"
  command -v update-desktop-database >/dev/null && update-desktop-database "$apps_dir" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$DEST/icons/hicolor" 2>/dev/null || true
  say "Installé : AuxiOffice, AuxiWriter, AuxiSheet, AuxiPresent, AuxiDraw, AuxiPDF (Bureautique) et AuxiText (Utilitaires) dans le menu des applications"
}

install_$OS
