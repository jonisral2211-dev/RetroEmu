import AsyncStorage from '@react-native-async-storage/async-storage';

// Perfil por juego del menú rápido: multiplicador de resolución interna en PSP (1x..4x)
export type GameConfig = { pspRes?: number; fpsCap?: number; turbo?: boolean };

const KEY = (romPath: string) => `jl.gamecfg.v1:${romPath}`;

export async function loadGameConfig(romPath: string): Promise<GameConfig> {
  try {
    const raw = await AsyncStorage.getItem(KEY(romPath));
    return raw ? (JSON.parse(raw) as GameConfig) : {};
  } catch {
    return {};
  }
}

export function saveGameConfig(romPath: string, cfg: GameConfig): void {
  AsyncStorage.setItem(KEY(romPath), JSON.stringify(cfg)).catch(() => {});
}
