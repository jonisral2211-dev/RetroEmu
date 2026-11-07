export type CoreId = 'mgba' | 'genesis' | 'mupen64' | 'mame';

// Consolas de la biblioteca (carpetas en Documents y pestañas de la UI)
export type Console = 'gba' | 'n64' | 'sega' | 'mame';

// Debe coincidir con los cores que scripts/cores.lock marca como enabled=true.
export const ENABLED_CORES: ReadonlySet<CoreId> = new Set<CoreId>([
  'mgba',
  'genesis',
  'mupen64',
  'mame',
]);

export const SYSTEM_NAME: Record<CoreId, string> = {
  mgba: 'Game Boy Advance',
  genesis: 'Mega Drive / Genesis',
  mupen64: 'Nintendo 64',
  mame: 'Arcade (MAME 2003-Plus)',
};

export const CONSOLE_LABEL: Record<Console, string> = {
  gba: 'GBA',
  n64: 'N64',
  sega: 'Sega',
  mame: 'Arcade',
};

const CORE_OF_CONSOLE: Record<Console, CoreId> = {
  gba: 'mgba',
  n64: 'mupen64',
  sega: 'genesis',
  mame: 'mame',
};

// Consola verificada por el nativo ('' = no verificada). El núcleo sale de la consola,
// no de la extensión: un .bin puede ser GBA o Mega Drive.
export function coreForConsole(consoleId: string): CoreId | null {
  return consoleId in CORE_OF_CONSOLE ? CORE_OF_CONSOLE[consoleId as Console] : null;
}
