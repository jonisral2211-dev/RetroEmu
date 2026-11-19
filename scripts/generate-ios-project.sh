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

# Juego en línea (netplay): iOS pide permiso de red local para conectar dos iPhone
/usr/libexec/PlistBuddy -c "Delete :NSLocalNetworkUsageDescription" "$PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :NSLocalNetworkUsageDescription string 'JL Emulator usa la red local para jugar en línea con otro iPhone (Netplay).'" "$PLIST"

# Orientaciones permitidas (el modo control de TV las restringe en tiempo de ejecución)
/usr/libexec/PlistBuddy -c "Delete :UISupportedInterfaceOrientations" "$PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations array" "$PLIST"
for o in UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight; do
  /usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations: string $o" "$PLIST"
done
/usr/libexec/PlistBuddy -c "Delete :UIRequiresFullScreen" "$PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :UIRequiresFullScreen bool true" "$PLIST"

# Live Activity (Dynamic Island / pantalla de bloqueo) y enlaces jlemu:// de sus botones
/usr/libexec/PlistBuddy -c "Delete :NSSupportsLiveActivities" "$PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :NSSupportsLiveActivities bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string jlemu" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string jlemu" "$PLIST"

# Los enlaces jlemu:// llegan a JS (Linking) a través de RCTLinkingManager
APPDELEGATE="$ROOT/ios/RetroEmu/AppDelegate.mm"
if [[ -f "$APPDELEGATE" ]] && ! grep -q "RCTLinkingManager" "$APPDELEGATE"; then
  perl -0pi -e 's/(#import "AppDelegate.h"\n)/$1\n#import <React\/RCTLinkingManager.h>\n/' "$APPDELEGATE"
  perl -0pi -e 's/\@end\s*\z/- (BOOL)application:(UIApplication *)application\n            openURL:(NSURL *)url\n            options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options\n{\n  return [RCTLinkingManager application:application openURL:url options:options];\n}\n\n\@end\n/' "$APPDELEGATE"
  grep -q "RCTLinkingManager application" "$APPDELEGATE" || echo "AVISO: no se pudo añadir openURL a AppDelegate.mm" >&2
fi

# Extensión de widgets JLLiveActivity (Bundle ID = el de la app + .LiveActivity)
if ! ruby -e "require 'xcodeproj'" >/dev/null 2>&1; then
  gem install xcodeproj --no-document --user-install
fi
ruby "$ROOT/scripts/add-live-activity.rb" "$ROOT/ios/RetroEmu.xcodeproj" "$ROOT/ios-overlay/LiveActivity"

# Nombre visible en el iPhone
for key in CFBundleDisplayName CFBundleName; do
  /usr/libexec/PlistBuddy -c "Delete :$key" "$PLIST" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :$key string 'JL Emulator'" "$PLIST"
done

echo "ios/ generado en $ROOT/ios"
