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
  | 'ppsspp'
  | 'snes9x'
  | 'fceumm'
  | 'gambatte'
  | 'prboom'
  | 'ecwolf'
  | 'tyrquake'
  | 'vitaquake2'
  | 'nxengine'
  | 'cannonball'
  | 'reminiscence'
  | 'easyrpg'
  | 'scummvm';

// Consolas de la biblioteca (carpetas en Documents y pestañas de la UI)
export type Console =
  | 'gba'
  | 'n64'
  | 'sega'
  | 'mame'
  | 'fbneo'
  | 'ps1'
  | 'psp'
  | 'nds'
  | 'saturn'
  | 'snes'
  | 'nes'
  | 'gb'
  | 'gbc'
  | 'ports';

/** Todas las consolas de la biblioteca (para contadores y filtros). */
export const ALL_CONSOLES: Console[] = [
  'ps1', 'psp', 'n64', 'nds', 'gba', 'snes', 'nes', 'gb', 'gbc', 'saturn', 'sega', 'fbneo', 'mame', 'ports',
];

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
  'snes9x',
  'fceumm',
  'gambatte',
  // Ports: opcionales en el IPA (si alguno faltaba en el buildbot, el nativo lo explica al abrir)
  'prboom',
  'ecwolf',
  'tyrquake',
  'vitaquake2',
  'nxengine',
  'cannonball',
  'reminiscence',
  'easyrpg',
  'scummvm',
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
  snes9x: 'Super Nintendo (Snes9x)',
  fceumm: 'NES / Famicom (FCEUmm)',
  gambatte: 'Game Boy / Color (Gambatte)',
  prboom: 'Doom / Heretic / Hexen (PrBoom)',
  ecwolf: 'Wolfenstein 3D (ECWolf)',
  tyrquake: 'Quake (TyrQuake)',
  vitaquake2: 'Quake II (vitaQuake II)',
  nxengine: 'Cave Story (NXEngine)',
  cannonball: 'OutRun (Cannonball)',
  reminiscence: 'Flashback (REminiscence)',
  easyrpg: 'RPG Maker 2000/2003 (EasyRPG)',
  scummvm: 'Aventuras gráficas (ScummVM)',
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
  snes: 'SNES',
  nes: 'NES',
  gb: 'GB',
  gbc: 'GBC',
  ports: 'Ports',
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
  snes: 'snes9x',
  nes: 'fceumm',
  gb: 'gambatte',
  gbc: 'gambatte',
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
export function coreForConsole(consoleId: string, romPath?: string): CoreId | null {
  if (consoleId === 'ports') return romPath ? portCoreFor(romPath) : null;
  return CORE_OF_CONSOLE[consoleId as Console] ?? null;
}

/**
 * Ports: núcleo según el archivo de arranque (mismas reglas que portCoreFor del nativo).
 * pak0.pak en baseq2/ = Quake II; en cualquier otra carpeta (id1/) = Quake.
 */
export function portCoreFor(path: string): CoreId | null {
  const parts = path.split('/');
  const name = (parts.pop() ?? '').toLowerCase();
  const parent = (parts.pop() ?? '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (ext === 'wad' || ext === 'iwad') return name === 'prboom.wad' ? null : 'prboom';
  if (ext === 'ecwolf') return 'ecwolf';
  if (name.startsWith('vswap.') && ['wl6', 'wl1', 'sod', 'sdm', 'sd2', 'sd3', 'n3d'].includes(ext)) return 'ecwolf';
  if (name === 'pak0.pak') return parent === 'baseq2' ? 'vitaquake2' : 'tyrquake';
  if (name === 'doukutsu.exe') return 'nxengine';
  if (ext === 'game') return 'cannonball';
  if (name === 'level1.map') return 'reminiscence';
  if (name === 'rpg_rt.ldb' || ext === 'easyrpg') return 'easyrpg';
  if (ext === 'scummvm') return 'scummvm';
  return null;
}

/** Título de un port: los archivos de arranque genéricos toman el nombre de su carpeta. */
export function portTitle(path: string): string | null {
  const parts = path.split('/');
  const name = (parts.pop() ?? '').toLowerCase();
  if (!/^(pak0\.pak|doukutsu\.exe|rpg_rt\.ldb|level1\.map|vswap\..+)$/.test(name)) return null;
  let folder = parts.pop() ?? '';
  if (/^(id1|baseq2)$/i.test(folder)) folder = parts.pop() ?? folder;
  if (/^ports$/i.test(folder)) {
    const fallback: Record<string, string> = { 'pak0.pak': 'Quake', 'doukutsu.exe': 'Cave Story', 'level1.map': 'Flashback' };
    return fallback[name] ?? 'Wolfenstein 3D';
  }
  return folder;
}

// Carpeta de Documents donde debe ir cada tipo de juego
export const FOLDER_GUIDE =
  'Ports (Doom, Quake, Cave Story…) → ports/ · SNES → snes/ · NES → nes/ · Game Boy → gb/ · GB Color → gbc/ · GBA → gba/ · N64 → n64/ · Mega Drive → sega/ · PS1 → ps1/ · Saturn → saturn/ · NDS → nds/ · ' +
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
  { folder: 'snes', label: 'Super Nintendo' },
  { folder: 'nes', label: 'NES' },
  { folder: 'gb', label: 'Game Boy' },
  { folder: 'gbc', label: 'Game Boy Color' },
  { folder: 'nds', label: 'Nintendo DS' },
  { folder: 'ports', label: 'Ports (Doom, Quake…)' },
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
