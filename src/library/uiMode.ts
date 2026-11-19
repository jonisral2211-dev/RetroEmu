import AsyncStorage from '@react-native-async-storage/async-storage';

// Interfaz de la biblioteca: 'steam' (SteamOS Gaming Mode, por defecto) o 'classic'
export type UiMode = 'steam' | 'classic';

const KEY = 'jl.uimode.v1';
let mode: UiMode = 'steam';
let loaded = false;
const listeners = new Set<(m: UiMode) => void>();

export async function loadUiMode(): Promise<UiMode> {
  if (!loaded) {
    try {
      const v = await AsyncStorage.getItem(KEY);
      if (v === 'classic' || v === 'steam') mode = v;
    } catch {
      // por defecto
    }
    loaded = true;
  }
  return mode;
}

export function setUiMode(m: UiMode): void {
  mode = m;
  loaded = true;
  AsyncStorage.setItem(KEY, m).catch(() => {});
  listeners.forEach((l) => l(m));
}

export function subscribeUiMode(cb: (m: UiMode) => void): () => void {
  listeners.add(cb);
  loadUiMode().then(cb);
  return () => {
    listeners.delete(cb);
  };
}
