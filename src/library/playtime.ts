import AsyncStorage from '@react-native-async-storage/async-storage';

// Tiempo total jugado por juego (segundos), para "Seguir jugando" y la ficha del juego
const KEY = 'jl.playtime.v1';
let cache: Record<string, number> | null = null;
const listeners = new Set<(map: Record<string, number>) => void>();

async function load(): Promise<Record<string, number>> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export async function addPlaytime(path: string, seconds: number): Promise<void> {
  const map = await load();
  cache = { ...map, [path]: (map[path] ?? 0) + seconds };
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
  listeners.forEach((l) => l(cache!));
}

export function subscribePlaytime(cb: (map: Record<string, number>) => void): () => void {
  listeners.add(cb);
  load().then(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** "2 h 15 min", "35 min", "menos de 1 min". */
export function formatPlaytime(seconds: number | undefined): string {
  const s = seconds ?? 0;
  if (s < 60) return 'menos de 1 min';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
