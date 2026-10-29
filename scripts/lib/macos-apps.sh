# Paquets d'applications macOS (.app) d'AuxiOffice et d'AuxiText, partagés par
# scripts/install-apps.sh (applications liées au dépôt) et scripts/build-mac.sh
# (applications autonomes et image disque). À inclure avec « . » ; utilise $ROOT.

mac_name() { case $1 in office) echo AuxiOffice ;; writer) echo AuxiWriter ;; sheet) echo AuxiSheet ;; present) echo AuxiPresent ;; draw) echo AuxiDraw ;; pdf) echo AuxiPDF ;; esac; }

mac_doc_types() {
  # $1 = writer|sheet|present|draw|pdf → CFBundleDocumentTypes
  role=Editor
  case $1 in
    writer) label="Document texte"; utis="org.openxmlformats.wordprocessingml.document org.openxmlformats.wordprocessingml.document.macroenabled com.microsoft.word.doc org.oasis-open.opendocument.text public.rtf org.openxmlformats.wordprocessingml.template" ;;
    sheet) label="Classeur"; utis="org.openxmlformats.spreadsheetml.sheet com.microsoft.excel.xls org.oasis-open.opendocument.spreadsheet public.comma-separated-values-text org.openxmlformats.spreadsheetml.sheet.macroenabled" ;;
    present) label="Présentation"; utis="org.openxmlformats.presentationml.presentation org.openxmlformats.presentationml.presentation.macroenabled com.microsoft.powerpoint.ppt org.oasis-open.opendocument.presentation org.openxmlformats.presentationml.slideshow" ;;
    draw) label="Dessin"; utis="org.oasis-open.opendocument.graphics org.oasis-open.opendocument.graphics-template com.microsoft.visio.drawing" ;;
    pdf) label="Document PDF"; role=Viewer; utis="com.adobe.pdf" ;;
    *) return 0 ;;
  esac
  printf '  <key>CFBundleDocumentTypes</key>\n  <array>\n    <dict>\n'
  printf '      <key>CFBundleTypeName</key><string>%s</string>\n' "$label"
  printf '      <key>CFBundleTypeRole</key><string>%s</string>\n' "$role"
  printf '      <key>LSHandlerRank</key><string>Alternate</string>\n'
  printf '      <key>LSItemContentTypes</key>\n      <array>\n'
  for u in $utis; do printf '        <string>%s</string>\n' "$u"; done
  printf '      </array>\n    </dict>\n  </array>\n'
}

# mac_icns <png 512 px> <fichier .icns>
mac_icns() {
  set_dir=$(mktemp -d)/icon.iconset
  mkdir -p "$set_dir"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$1" --out "$set_dir/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$1" --out "$set_dir/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$set_dir" -o "$2"
  rm -rf "$(dirname "$set_dir")"
}

# mac_app <office|writer|sheet|present|draw|pdf> <dossier> <exécutable auxioffice> <version>
# → <dossier>/<Nom>.app (sans moteur ni modèles : à ajouter par l'appelant).
mac_app() {
  a=$1 n=$(mac_name "$1") app="$2/$(mac_name "$1").app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp "$3" "$app/Contents/MacOS/$n"
  mac_icns "$ROOT/app/src-tauri/icons/macos/auxi$a.png" "$app/Contents/Resources/$n.icns"
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
  <key>CFBundleShortVersionString</key><string>$4</string>
  <key>CFBundleVersion</key><string>$4</string>
  <key>CFBundleDevelopmentRegion</key><string>fr</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
$(mac_doc_types "$a")
</dict>
</plist>
PLIST
}

# mac_text_app <dossier> <exécutable auxitext> <version> → <dossier>/AuxiText.app
mac_text_app() {
  app="$1/AuxiText.app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp "$2" "$app/Contents/MacOS/AuxiText"
  mac_icns "$ROOT/branding/generated/png/512x512/auxitext.png" "$app/Contents/Resources/AuxiText.icns"
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>AuxiText</string>
  <key>CFBundleDisplayName</key><string>AuxiText</string>
  <key>CFBundleIdentifier</key><string>ca.auxinux.text</string>
  <key>CFBundleExecutable</key><string>AuxiText</string>
  <key>CFBundleIconFile</key><string>AuxiText</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$3</string>
  <key>CFBundleVersion</key><string>$3</string>
  <key>CFBundleDevelopmentRegion</key><string>fr</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Texte</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>public.plain-text</string>
        <string>public.source-code</string>
        <string>public.script</string>
        <string>public.json</string>
        <string>public.xml</string>
        <string>net.daringfireball.markdown</string>
        <string>public.log</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST
}
