import { Libretro } from 'react-native-libretro';

// Texturas HD de PPSSPP por juego: PSP/TEXTURES/<ID del juego>/ (activas) o <ID>.off (desactivadas)
export type TextureInfo = { installed: boolean; enabled: boolean; files: number };

/** ID de juego (serial de la cabecera, p. ej. ULUS-10041); '' si no se puede leer. */
export function gameIdOf(romPath: string): string {
  try {
    const r = JSON.parse(Libretro.romInfo(romPath)) as { serial?: string };
    return r.serial ?? '';
  } catch {
    return '';
  }
}

export function textureInfo(gameId: string): TextureInfo {
  try {
    return JSON.parse(Libretro.texturesInfo(gameId)) as TextureInfo;
  } catch {
    return { installed: false, enabled: false, files: 0 };
  }
}

/** Abre el selector de carpeta y copia el paquete. Resuelve nº de archivos, o -1 si se canceló. */
export function importTextures(gameId: string): Promise<number> {
  return Libretro.texturesImport(gameId);
}

export function setTextures(gameId: string, enabled: boolean): void {
  Libretro.texturesToggle(gameId, enabled);
}

export function removeTextures(gameId: string): void {
  Libretro.texturesRemove(gameId);
}
