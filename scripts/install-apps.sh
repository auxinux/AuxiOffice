#!/bin/sh
# Installe les quatre applications pour l'utilisateur courant, à partir de la
# compilation de développement (ce n'est pas un paquet) :
#   AuxiOffice (gestionnaire), AuxiWriter, AuxiSheet, AuxiPresent.
#
#   macOS : ~/Applications/Auxi*.app (Finder, Launchpad, Dock, « Ouvrir avec »)
#   Linux : menu des applications (~/.local/share/applications)
#
#   scripts/install-apps.sh            compile (optimisé) puis installe
#   scripts/install-apps.sh --remove   retire les applications installées
#
# Les applications utilisent le moteur LibreOffice et auxi-engine du dépôt :
# relancer ce script après une recompilation (macOS : il copie l'exécutable).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

APPS="office writer sheet present"
name() { case $1 in office) echo AuxiOffice ;; writer) echo AuxiWriter ;; sheet) echo AuxiSheet ;; present) echo AuxiPresent ;; esac; }
say() { printf '\n== %s\n' "$*"; }
die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos; DEST="$HOME/Applications" ;;
  Linux) OS=linux; DEST="${XDG_DATA_HOME:-$HOME/.local/share}" ;;
  *) die "système non pris en charge : $(uname -s) (Windows : voir BUILD.md)" ;;
esac

if [ "${1:-}" = "--remove" ]; then
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

say "Compilation"
(cd app && { [ -d node_modules ] || npm install --no-audit --no-fund; } && npm run --silent build)
cargo build --release -p auxi-engine
cargo build --release -p auxioffice --features custom-protocol
BIN="$ROOT/target/release/auxioffice"
[ -x "$BIN" ] || die "exécutable introuvable : $BIN"
ls .engine/*/program-dir >/dev/null 2>&1 || die "moteur LibreOffice absent : lancer d'abord scripts/dev.sh"

# --- macOS -------------------------------------------------------------------

doc_types() {
  # $1 = writer|sheet|present → CFBundleDocumentTypes
  case $1 in
    writer) label="Document texte"; utis="org.openxmlformats.wordprocessingml.document com.microsoft.word.doc org.oasis-open.opendocument.text public.rtf org.openxmlformats.wordprocessingml.template" ;;
    sheet) label="Classeur"; utis="org.openxmlformats.spreadsheetml.sheet com.microsoft.excel.xls org.oasis-open.opendocument.spreadsheet public.comma-separated-values-text org.openxmlformats.spreadsheetml.sheet.macroenabled" ;;
    present) label="Présentation"; utis="org.openxmlformats.presentationml.presentation com.microsoft.powerpoint.ppt org.oasis-open.opendocument.presentation org.openxmlformats.presentationml.slideshow org.oasis-open.opendocument.graphics" ;;
    *) return 0 ;;
  esac
  printf '  <key>CFBundleDocumentTypes</key>\n  <array>\n    <dict>\n'
  printf '      <key>CFBundleTypeName</key><string>%s</string>\n' "$label"
  printf '      <key>CFBundleTypeRole</key><string>Editor</string>\n'
  printf '      <key>LSHandlerRank</key><string>Alternate</string>\n'
  printf '      <key>LSItemContentTypes</key>\n      <array>\n'
  for u in $utis; do printf '        <string>%s</string>\n' "$u"; done
  printf '      </array>\n    </dict>\n  </array>\n'
}

install_macos() {
  version=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -n1)
  mkdir -p "$DEST"
  for a in $APPS; do
    n=$(name "$a")
    app="$DEST/$n.app"
    say "$n → $app"
    rm -rf "$app"
    mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    cp "$BIN" "$app/Contents/MacOS/$n"
    # Moteur, LibreOffice et modèles : ceux du dépôt.
    echo "$ROOT" > "$app/Contents/Resources/dev-root"
    # Icône : jeu de tailles → .icns
    set_dir=$(mktemp -d)/$n.iconset
    mkdir -p "$set_dir"
    src="$ROOT/app/src-tauri/icons/macos/auxi$a.png"
    for s in 16 32 128 256 512; do
      sips -z $s $s "$src" --out "$set_dir/icon_${s}x${s}.png" >/dev/null
      sips -z $((s * 2)) $((s * 2)) "$src" --out "$set_dir/icon_${s}x${s}@2x.png" >/dev/null
    done
    iconutil -c icns "$set_dir" -o "$app/Contents/Resources/$n.icns"
    rm -rf "$(dirname "$set_dir")"
    cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$n</string>
  <key>CFBundleDisplayName</key><string>$n</string>
  <key>CFBundleIdentifier</key><string>ca.auxinux.$a</string>
  <key>CFBundleExecutable</key><string>$n</string>
  <key>CFBundleIconFile</key><string>$n</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleDevelopmentRegion</key><string>fr</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
$(doc_types "$a")
</dict>
</plist>
PLIST
    codesign --force -s - "$app" >/dev/null 2>&1 || echo "  (signature locale impossible : l'application peut demander une confirmation au premier lancement)"
  done
  LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  for a in $APPS; do [ -x "$LSREG" ] && "$LSREG" -f "$DEST/$(name "$a").app" || true; done
  say "Installé dans $DEST : AuxiOffice, AuxiWriter, AuxiSheet, AuxiPresent"
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
      office) comment="Créer et ouvrir des documents, des classeurs et des présentations"; cats="Office;"; mime="" ;;
      writer) comment="Traitement de texte"; cats="Office;WordProcessor;"
        mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document;application/msword;application/vnd.oasis.opendocument.text;application/rtf;text/rtf;" ;;
      sheet) comment="Tableur"; cats="Office;Spreadsheet;"
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;application/vnd.ms-excel;application/vnd.oasis.opendocument.spreadsheet;text/csv;" ;;
      present) comment="Présentations"; cats="Office;Presentation;"
        mime="application/vnd.openxmlformats-officedocument.presentationml.presentation;application/vnd.ms-powerpoint;application/vnd.oasis.opendocument.presentation;" ;;
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
      [ "$a" = office ] || echo "Actions=new;"
      if [ "$a" != office ]; then
        echo
        echo "[Desktop Action new]"
        echo "Name=Nouveau"
        echo "Exec=\"$exe\" --new"
      fi
    } > "$apps_dir/ca.auxinux.$a.desktop"
    echo "  $n → $apps_dir/ca.auxinux.$a.desktop"
  done
  command -v update-desktop-database >/dev/null && update-desktop-database "$apps_dir" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$DEST/icons/hicolor" 2>/dev/null || true
  say "Installé : AuxiOffice, AuxiWriter, AuxiSheet, AuxiPresent dans le menu des applications (catégorie Bureautique)"
}

install_$OS
