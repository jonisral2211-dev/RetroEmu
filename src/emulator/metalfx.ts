import AsyncStorage from '@react-native-async-storage/async-storage';

// Reescalado espacial MetalFX (GPU, iOS 16+): 0 apagado, 1 HD (1080p), 2 4K (2160p).
// Sin soporte del dispositivo, el nativo dibuja sin reescalar: nunca bloquea el arranque.
export type MetalFxMode = 0 | 1 | 2;

const KEY = 'jl.metalfx.v1';
let current: MetalFxMode = 0;
let loaded = false;

export function sanitizeMetalFx(v: unknown): MetalFxMode {
  return v === 1 || v === 2 ? v : 0;
}

export async function loadMetalFx(): Promise<MetalFxMode> {
  if (loaded) return current;
  try {
    current = sanitizeMetalFx(Number(await AsyncStorage.getItem(KEY)));
  } catch {
    // sin preferencia guardada: apagado
  }
  loaded = true;
  return current;
}

export function getMetalFx(): MetalFxMode {
  return current;
}

export function saveMetalFx(m: MetalFxMode): void {
  current = m;
  AsyncStorage.setItem(KEY, String(m)).catch(() => {});
}
