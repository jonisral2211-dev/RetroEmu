import AsyncStorage from '@react-native-async-storage/async-storage';

// Perfil por juego del menú rápido. Todo campo es opcional: si falta o no es válido, se usa el valor por defecto.
export type GameConfig = { pspRes?: number; fpsCap?: number; turbo?: boolean; metalFx?: number };

const KEY = (romPath: string) => `jl.gamecfg.v1:${romPath}`;

// Solo se aceptan valores conocidos: un perfil dañado nunca llega al núcleo
export function sanitizeGameConfig(raw: unknown): GameConfig {
  if (!raw || typeof raw !== 'object') return {};
  const c = raw as Record<string, unknown>;
  const out: GameConfig = {};
  if (typeof c.pspRes === 'number' && [1, 2, 3, 4].includes(c.pspRes)) out.pspRes = c.pspRes;
  if (typeof c.fpsCap === 'number' && [0, 30, 60].includes(c.fpsCap)) out.fpsCap = c.fpsCap;
  if (typeof c.turbo === 'boolean') out.turbo = c.turbo;
  if (typeof c.metalFx === 'number' && [0, 1, 2].includes(c.metalFx)) out.metalFx = c.metalFx;
  return out;
}

export async function loadGameConfig(romPath: string): Promise<GameConfig> {
  try {
    const raw = await AsyncStorage.getItem(KEY(romPath));
    return raw ? sanitizeGameConfig(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveGameConfig(romPath: string, cfg: GameConfig): void {
  AsyncStorage.setItem(KEY(romPath), JSON.stringify(sanitizeGameConfig(cfg))).catch(() => {});
}
