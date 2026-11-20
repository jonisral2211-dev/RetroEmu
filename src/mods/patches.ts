import { Libretro } from 'react-native-libretro';

// Parches de ROM (IPS / BPS / UPS) en memoria: un parche activo por juego. El archivo original no cambia.
export type PatchInfo = { active: boolean; name: string };

export function patchInfo(romPath: string): PatchInfo {
  try {
    return JSON.parse(Libretro.patchInfo(romPath)) as PatchInfo;
  } catch {
    return { active: false, name: '' };
  }
}

/** Abre el selector y guarda el parche. Resuelve el nombre del archivo, o '' si se canceló. */
export function pickPatch(romPath: string): Promise<string> {
  return Libretro.patchPick(romPath);
}

export function removePatch(romPath: string): void {
  Libretro.patchRemove(romPath);
}
