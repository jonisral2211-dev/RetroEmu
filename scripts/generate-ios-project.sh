#!/usr/bin/env bash
# Genera ios/ a partir de la plantilla oficial de React Native y aplica nuestros ajustes.
# ios/ no se versiona: se regenera en cada build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RN_VERSION="0.76.9"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

(
  cd "$TMP"
  npx --yes @react-native-community/cli@latest init RetroEmu \
    --version "$RN_VERSION" --skip-install --skip-git-init
)

rm -rf "$ROOT/ios"
cp -R "$TMP/RetroEmu/ios" "$ROOT/ios"
cp "$ROOT/ios-overlay/Podfile" "$ROOT/ios/Podfile"

# Icono JL: assets/AppIcon.appiconset (generado con scripts/make-app-icon.mjs)
ICON_DST="$ROOT/ios/RetroEmu/Images.xcassets/AppIcon.appiconset"
mkdir -p "$ICON_DST"
cp -R "$ROOT/assets/AppIcon.appiconset/." "$ICON_DST/"

# Acceso desde la app Archivos (para copiar ROMs) y en Documents
PLIST="$ROOT/ios/RetroEmu/Info.plist"
pb() {
  /usr/libexec/PlistBuddy -c "Delete :$1" "$PLIST" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PLIST"
}
pb UIFileSharingEnabled bool true
pb LSSupportsOpeningDocumentsInPlace bool true

# Nombre visible en el iPhone
for key in CFBundleDisplayName CFBundleName; do
  /usr/libexec/PlistBuddy -c "Delete :$key" "$PLIST" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :$key string 'JL Emulator'" "$PLIST"
done

echo "ios/ generado en $ROOT/ios"
