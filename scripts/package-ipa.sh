#!/usr/bin/env bash
# Empaqueta el .app compilado (sin firmar) en RetroEmu-unsigned.ipa.
# Sideloadly lo firma con tu Apple ID al instalarlo desde Windows.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$(find "$ROOT/build/DerivedData/Build/Products/Release-iphoneos" -maxdepth 1 -name '*.app' | head -n 1 || true)"
if [[ -z "$APP" ]]; then
  echo "No se encontró el .app compilado" >&2
  exit 1
fi

STAGE="$ROOT/build/ipa"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/"

rm -f "$ROOT/RetroEmu-unsigned.ipa"
(cd "$STAGE" && zip -qry "$ROOT/RetroEmu-unsigned.ipa" Payload)
ls -lh "$ROOT/RetroEmu-unsigned.ipa"
