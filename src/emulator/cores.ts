export type CoreId = 'mgba' | 'genesis' | 'mupen64' | 'mame' | 'pcsx';

// Consolas de la biblioteca (carpetas en Documents y pestañas de la UI)
export type Console = 'gba' | 'n64' | 'sega' | 'mame' | 'ps1';

// Debe coincidir con los cores que scripts/cores.lock marca como enabled=true.
export const ENABLED_CORES: ReadonlySet<CoreId> = new Set<CoreId>([
  'mgba',
  'genesis',
  'mupen64',
  'mame',
  'pcsx',
]);

export const SYSTEM_NAME: Record<CoreId, string> = {
  mgba: 'Game Boy Advance',
  genesis: 'Mega Drive / Genesis',
  mupen64: 'Nintendo 64',
  mame: 'Arcade (MAME 2003-Plus)',
  pcsx: 'PlayStation (PCSX ReARMed)',
};

export const CONSOLE_LABEL: Record<Console, string> = {
  gba: 'GBA',
  n64: 'N64',
  sega: 'Sega',
  mame: 'Arcade',
  ps1: 'PS1',
};

const CORE_OF_CONSOLE: Record<Console, CoreId> = {
  gba: 'mgba',
  n64: 'mupen64',
  sega: 'genesis',
  mame: 'mame',
  ps1: 'pcsx',
};

// Consola verificada por el nativo ('' = no verificada). El núcleo sale de la consola,
// no de la extensión: un .bin puede ser GBA o Mega Drive.
export function coreForConsole(consoleId: string): CoreId | null {
  return consoleId in CORE_OF_CONSOLE ? CORE_OF_CONSOLE[consoleId as Console] : null;
}

// Carpeta de Documents donde debe ir cada tipo de juego
export const FOLDER_GUIDE =
  'GBA → gba/ · N64 → n64/ · Mega Drive/Sega → sega/ · PS1 → ps1/ · Arcade y Neo-Geo (.zip de MAME) → arcade/';

/** true si es un .zip fuera de Documents/arcade/ (solo los de arcade/ se abren con MAME). */
export function isMisplacedZip(path: string): boolean {
  return /\.zip$/i.test(path) && !/\/Documents\/arcade\//.test(path);
}

/** Aviso para un .zip mal ubicado: a qué carpeta moverlo según la consola. */
export function misplacedZipMessage(path: string): string {
  const name = path.split('/').pop() ?? path;
  return (
    `"${name}" no está en la carpeta arcade/. Los .zip de arcade (MAME 2003-Plus, Neo-Geo: KOF, ` +
    `Metal Slug…) solo se abren desde Documents/arcade/. Muévelo con la app Archivos a la carpeta ` +
    `de su consola:\n${FOLDER_GUIDE}`
  );
}
