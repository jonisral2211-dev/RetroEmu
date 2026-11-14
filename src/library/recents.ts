import AsyncStorage from '@react-native-async-storage/async-storage';

// Juegos abiertos recientemente (rutas absolutas, el más reciente primero)
const KEY = 'jl.recent.v1';
const MAX = 12;

let cache: string[] | null = null;
const listeners = new Set<(list: string[]) => void>();

export async function loadRecents(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export async function addRecent(path: string): Promise<void> {
  const list = await loadRecents();
  cache = [path, ...list.filter((p) => p !== path)].slice(0, MAX);
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
  listeners.forEach((l) => l(cache!));
}

export async function removeRecent(path: string): Promise<void> {
  const list = await loadRecents();
  cache = list.filter((p) => p !== path);
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
  listeners.forEach((l) => l(cache!));
}

/** Se suscribe a cambios; devuelve la función para cancelar. */
export function subscribeRecents(cb: (list: string[]) => void): () => void {
  listeners.add(cb);
  loadRecents().then(cb);
  return () => {
    listeners.delete(cb);
  };
}
