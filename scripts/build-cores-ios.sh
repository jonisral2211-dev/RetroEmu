#!/usr/bin/env bash
# Compila los cores activos de scripts/cores.lock para iOS (arm64, dispositivo)
# y los empaqueta como frameworks dinámicos en packages/react-native-libretro/ios/Frameworks.
# Requiere macOS + Xcode (xcrun).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/scripts/cores.lock"
SRC_DIR="$ROOT/third_party/cores"
OUT_DIR="$ROOT/packages/react-native-libretro/ios/Frameworks"
IOS_MIN="15.1"

SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
CC_IOS="$(xcrun --sdk iphoneos --find clang)"
CXX_IOS="$(xcrun --sdk iphoneos --find clang++)"
AR_IOS="$(xcrun --sdk iphoneos --find ar)"
CFLAGS_IOS="-arch arm64 -isysroot $SDK -miphoneos-version-min=$IOS_MIN"
JOBS="$(sysctl -n hw.ncpu)"

write_plist() {
  local name="$1" fw="$2"
  local bundle_id="com.retroemu.${name//_/-}"
  cat > "$fw/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>$bundle_id</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleSupportedPlatforms</key><array><string>iPhoneOS</string></array>
  <key>MinimumOSVersion</key><string>$IOS_MIN</string>
</dict>
</plist>
PLIST
}

build_core() {
  local name="$1" repo="$2" ref="$3" build="$4" target="$5" args="$6"
  local dir="$SRC_DIR/$name"

  echo "==> $name @ $ref ($build)"
  if [[ ! -d "$dir/.git" ]]; then
    rm -rf "$dir"
    mkdir -p "$dir"
    git -C "$dir" init -q
    git -C "$dir" remote add origin "$repo"
  fi
  git -C "$dir" fetch -q --depth 1 origin "$ref"
  git -C "$dir" checkout -q -f FETCH_HEAD
  git -C "$dir" submodule update -q --init --depth 1 --recursive || true

  # Shim para cores con libpng integrado: su rama 'TARGET_OS_MAC' incluye <fp.h>,
  # que solo existe en Mac clásico y no en el SDK de iOS. Un fp.h vacío basta.
  mkdir -p "$dir/rnl-shim"
  : > "$dir/rnl-shim/fp.h"

  case "$build" in
    make)
      # zlib (y libpng) integrados: si TARGET_OS_MAC está definido usan macros de Mac clásico
      # (fdopen -> NULL) que rompen el SDK de iOS. Un header forzado define fdopen como macro
      # de sí mismo, así que su '#ifndef fdopen' queda sin efecto.
      cat > "$dir/rnl-shim/rnl.h" <<'RNL'
#define fdopen(fd, mode) fdopen(fd, mode)
RNL
      export CFLAGS="-include $dir/rnl-shim/rnl.h"
      export CPPFLAGS="-include $dir/rnl-shim/rnl.h"
      export CXXFLAGS="-include $dir/rnl-shim/rnl.h"
      # shellcheck disable=SC2086
      make -C "$dir" -j"$JOBS" $target $args \
        CC="$CC_IOS $CFLAGS_IOS" CXX="$CXX_IOS $CFLAGS_IOS" AR="$AR_IOS"
      ;;
    cmake)
      # shellcheck disable=SC2086
      cmake -S "$dir" -B "$dir/build-ios" \
        -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphoneos \
        -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET="$IOS_MIN" \
        -DBUILD_SHARED_LIBS=ON $args
      cmake --build "$dir/build-ios" --parallel "$JOBS" ${target:+--target "$target"}
      ;;
    *)
      echo "build desconocido: $build" >&2
      exit 1
      ;;
  esac

  local lib
  lib="$(find "$dir" \( -name "${name}*.dylib" -o -name "${name}*.a" \) -type f \
          -not -path '*/CMakeFiles/*' | head -n 1 || true)"
  if [[ -z "$lib" ]]; then
    echo "No se encontró la salida de $name (revisa el log de compilación)" >&2
    exit 1
  fi
  echo "    salida: $lib"

  local fw="$OUT_DIR/$name.framework"
  rm -rf "$fw"
  mkdir -p "$fw"
  if [[ "$lib" == *.dylib ]]; then
    cp "$lib" "$fw/$name"
  else
    # Solo hay .a estático: lo enlazamos en un dylib para poder cargarlo con dlopen
    # shellcheck disable=SC2086
    "$CC_IOS" $CFLAGS_IOS -dynamiclib -Wl,-all_load "$lib" -lz -lm -lc++ -o "$fw/$name"
  fi
  install_name_tool -id "@rpath/$name.framework/$name" "$fw/$name"
  write_plist "$name" "$fw"
  echo "    framework: $fw"
}

bash "$ROOT/scripts/fetch-libretro-header.sh"
mkdir -p "$SRC_DIR" "$OUT_DIR"
rm -rf "$OUT_DIR"/*.framework

exec 3< "$LOCK"
while IFS='|' read -r -u 3 name repo ref build target args enabled; do
  [[ -z "${name// /}" || "$name" == \#* ]] && continue
  if [[ "$enabled" != "true" ]]; then
    echo "==> $name desactivado en cores.lock"
    continue
  fi
  build_core "$name" "$repo" "$ref" "$build" "$target" "$args"
done
exec 3<&-

echo "Frameworks generados:"
ls -1 "$OUT_DIR"
