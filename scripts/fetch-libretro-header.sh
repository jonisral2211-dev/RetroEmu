#!/usr/bin/env bash
# Descarga libretro.h (API de Libretro) a packages/react-native-libretro/ios/include.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/packages/react-native-libretro/ios/include"
URL="https://raw.githubusercontent.com/libretro/libretro-common/master/include/libretro.h"

mkdir -p "$DEST"
curl -fsSL "$URL" -o "$DEST/libretro.h"
echo "libretro.h -> $DEST/libretro.h"
