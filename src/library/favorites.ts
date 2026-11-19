import AsyncStorage from '@react-native-async-storage/async-storage';

// Juegos favoritos (rutas absolutas, el último marcado primero)
const KEY = 'jl.favorites.v1';

let cache: string[] | null = null;
const listeners = new Set<(list: string[]) => void>();

async function load(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(list: string[]) {
  cache = list;
  AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => {});
  listeners.forEach((l) => l(list));
}

/** Marca o desmarca un favorito; resuelve true si queda marcado. */
export async function toggleFavorite(path: string): Promise<boolean> {
  const list = await load();
  const on = !list.includes(path);
  save(on ? [path, ...list] : list.filter((p) => p !== path));
  return on;
}

export function subscribeFavorites(cb: (list: string[]) => void): () => void {
  listeners.add(cb);
  load().then(cb);
  return () => {
    listeners.delete(cb);
  };
}
