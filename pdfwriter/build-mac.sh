#!/bin/sh
# macOS : compile AuxiPDFWriter en application.
#   pdfwriter/build-mac.sh → pdfwriter/target/macos/AuxiPDFWriter.app
# Prérequis : outils en ligne de commande de Xcode, Rust, Node.js 22+.
# Signature locale (« ad hoc ») : l'application s'ouvre sur le Mac qui l'a compilée.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"

die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || die "ce script se lance sous macOS"
for c in node npm cargo iconutil sips codesign; do
  command -v "$c" >/dev/null 2>&1 || die "commande absente : $c"
done

VERSION=$(sed -n 's/^version = "\(.*\)"$/\1/p' src-tauri/Cargo.toml | head -n 1)

printf '\n== Interface\n'
npm install --no-audit --no-fund
npm run build

printf '\n== Application %s\n' "$VERSION"
(cd src-tauri && cargo build --release --features custom-protocol)

APP="$HERE/target/macos/AuxiPDFWriter.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp src-tauri/target/release/auxipdfwriter "$APP/Contents/MacOS/AuxiPDFWriter"

TMP=$(mktemp -d)
SET="$TMP/icon.iconset"
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" src-tauri/icons/icon.png --out "$SET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" src-tauri/icons/icon.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AuxiPDFWriter.icns"
rm -rf "$TMP"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>AuxiPDFWriter</string>
  <key>CFBundleDisplayName</key><string>AuxiPDFWriter</string>
  <key>CFBundleIdentifier</key><string>ca.auxinux.pdfwriter</string>
  <key>CFBundleExecutable</key><string>AuxiPDFWriter</string>
  <key>CFBundleIconFile</key><string>AuxiPDFWriter</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleDevelopmentRegion</key><string>fr</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Document PDF</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array><string>com.adobe.pdf</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

codesign --force --deep -s - "$APP" >/dev/null 2>&1 || echo "  (signature locale impossible : macOS peut demander une confirmation au premier lancement)"
printf '\nTerminé : %s\n' "$APP"
