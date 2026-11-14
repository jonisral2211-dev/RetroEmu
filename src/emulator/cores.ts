export type CoreId =
  | 'mgba'
  | 'genesis'
  | 'mupen64'
  | 'mame'
  | 'pcsx'
  | 'melonds'
  | 'desmume'
  | 'yabause'
  | 'fbneo'
  | 'ppsspp';

// Consolas de la biblioteca (carpetas en Documents y pestañas de la UI)
export type Console = 'gba' | 'n64' | 'sega' | 'mame' | 'fbneo' | 'ps1' | 'psp' | 'nds' | 'saturn';

// Debe coincidir con los cores que scripts/cores.lock marca como enabled=true.
export const ENABLED_CORES: ReadonlySet<CoreId> = new Set<CoreId>([
  'mgba',
  'genesis',
  'mupen64',
  'mame',
  'pcsx',
  'melonds',
  'desmume',
  'yabause',
  'fbneo',
  'ppsspp',
]);

export const SYSTEM_NAME: Record<CoreId, string> = {
  mgba: 'Game Boy Advance',
  genesis: 'Mega Drive / Genesis',
  mupen64: 'Nintendo 64',
  mame: 'Arcade (MAME 2003-Plus)',
  pcsx: 'PlayStation (PCSX ReARMed)',
  melonds: 'Nintendo DS (melonDS)',
  desmume: 'Nintendo DS (DeSmuME)',
  yabause: 'Sega Saturn (Yabause)',
  fbneo: 'Arcade (FinalBurn Neo)',
  ppsspp: 'PSP (PPSSPP)',
};

export const CONSOLE_LABEL: Record<Console, string> = {
  gba: 'GBA',
  n64: 'N64',
  sega: 'Sega',
  mame: 'Arcade',
  fbneo: 'FBNeo',
  ps1: 'PS1',
  psp: 'PSP',
  nds: 'NDS',
  saturn: 'Saturn',
};

// PSP: PPSSPP precompilado para iOS, con render por software (sin JIT: intérprete IR)
const CORE_OF_CONSOLE: Partial<Record<Console, CoreId>> = {
  gba: 'mgba',
  n64: 'mupen64',
  sega: 'genesis',
  mame: 'mame',
  fbneo: 'fbneo',
  ps1: 'pcsx',
  nds: 'melonds',
  saturn: 'yabause',
  psp: 'ppsspp',
};

/** Núcleo alternativo si el principal no arranca el juego (NDS: melonDS -> DeSmuME). */
export const FALLBACK_CORE: Partial<Record<CoreId, CoreId>> = { melonds: 'desmume' };

/** Núcleos que pueden abrir un romset arcade (de arcade/ o fbneo/). */
export const ARCADE_CORES: CoreId[] = ['fbneo', 'mame'];

export function isArcadeConsole(consoleId: string): boolean {
  return consoleId === 'mame' || consoleId === 'fbneo';
}

// Consola verificada por el nativo ('' = no verificada). El núcleo sale de la consola,
// no de la extensión: un .bin puede ser GBA, Mega Drive, PS1 o Saturn.
export function coreForConsole(consoleId: string): CoreId | null {
  return CORE_OF_CONSOLE[consoleId as Console] ?? null;
}

// Carpeta de Documents donde debe ir cada tipo de juego
export const FOLDER_GUIDE =
  'GBA → gba/ · N64 → n64/ · Mega Drive → sega/ · PS1 → ps1/ · Saturn → saturn/ · NDS → nds/ · ' +
  'PSP → psp/ · Arcade y Neo-Geo (.zip) → arcade/ o fbneo/';

/** true si es un .zip fuera de arcade/ y fbneo/ (solo esos son romsets arcade). */
export function isMisplacedZip(path: string): boolean {
  return /\.zip$/i.test(path) && !/\/Documents\/(arcade|fbneo)\//.test(path);
}

/** Carpetas de consola a las que se puede mover un juego desde la biblioteca. */
export const MOVE_TARGETS: { folder: string; label: string }[] = [
  { folder: 'psp', label: 'PSP' },
  { folder: 'ps1', label: 'PlayStation' },
  { folder: 'n64', label: 'Nintendo 64' },
  { folder: 'gba', label: 'Game Boy Advance' },
  { folder: 'nds', label: 'Nintendo DS' },
  { folder: 'sega', label: 'Mega Drive' },
  { folder: 'saturn', label: 'Saturn' },
  { folder: 'arcade', label: 'Arcade (MAME)' },
  { folder: 'fbneo', label: 'FBNeo' },
];

/** Aviso para un .zip mal ubicado: a qué carpeta moverlo según la consola. */
export function misplacedZipMessage(path: string): string {
  const name = path.split('/').pop() ?? path;
  return (
    `"${name}" no está en arcade/ ni en fbneo/. Los .zip de arcade (FBNeo, MAME 2003-Plus, ` +
    `Neo-Geo: KOF, Metal Slug…) solo se abren desde esas carpetas. Muévelo con la app Archivos ` +
    `a la carpeta de su consola:\n${FOLDER_GUIDE}`
  );
}
