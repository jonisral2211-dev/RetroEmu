export type CoreId = 'mgba' | 'genesis' | 'mupen64';

// Debe coincidir con los cores que scripts/cores.lock marca como enabled=true.
export const ENABLED_CORES: ReadonlySet<CoreId> = new Set<CoreId>(['mgba', 'mupen64']);

const CORE_BY_EXT: Record<string, CoreId> = {
  gba: 'mgba',
  gb: 'mgba',
  gbc: 'mgba',
  md: 'genesis',
  gen: 'genesis',
  smd: 'genesis',
  bin: 'genesis',
  z64: 'mupen64',
  n64: 'mupen64',
  v64: 'mupen64',
};

export const SYSTEM_NAME: Record<CoreId, string> = {
  mgba: 'Game Boy / GBA',
  genesis: 'Mega Drive / Genesis',
  mupen64: 'Nintendo 64',
};

export function coreForFile(path: string): CoreId | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return CORE_BY_EXT[ext] ?? null;
}

// Carpetas por consola dentro de Documents (creadas por nativo al arrancar)
export type Console = 'gba' | 'n64' | 'sega' | 'mame';

export const CONSOLE_LABEL: Record<Console, string> = {
  gba: 'GBA',
  n64: 'N64',
  sega: 'Sega',
  mame: 'Arcade',
};

const CONSOLE_OF_CORE: Record<CoreId, Console> = {
  mgba: 'gba',
  mupen64: 'n64',
  genesis: 'sega',
};

// Consola de una ruta: los .zip sin núcleo asociado son arcade
export function consoleForPath(path: string): Console {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'zip') return 'mame';
  const core = coreForFile(path);
  return core ? CONSOLE_OF_CORE[core] : 'mame';
}
