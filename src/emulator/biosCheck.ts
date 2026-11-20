import { Libretro } from 'react-native-libretro';

// BIOS obligatorias que faltan para una consola (según el mapa nativo de BIOS conocidas)
type BiosEntry = { console: string; file: string; found: boolean; required: boolean };

export function missingBios(consoleId: string): string[] {
  try {
    const list = JSON.parse(Libretro.biosStatus()) as BiosEntry[];
    return list.filter((b) => b.console === consoleId && b.required && !b.found).map((b) => b.file);
  } catch {
    return [];
  }
}
