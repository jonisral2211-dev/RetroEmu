export type CoreId = 'mgba' | 'genesis' | 'mupen64';

// Debe coincidir con los cores que scripts/cores.lock marca como enabled=true.
export const ENABLED_CORES: ReadonlySet<CoreId> = new Set<CoreId>(['mgba']);

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
