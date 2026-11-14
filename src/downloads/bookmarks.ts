import AsyncStorage from '@react-native-async-storage/async-storage';

// Marcadores del usuario, guardados solo en el dispositivo. La app no trae ninguno.
export type Bookmark = { title: string; url: string };

const KEY = 'jl.bookmarks.v1';

export async function loadBookmarks(): Promise<Bookmark[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Bookmark[]) : [];
    return Array.isArray(list) ? list.filter((b) => b && typeof b.url === 'string') : [];
  } catch {
    return [];
  }
}

export function saveBookmarks(list: Bookmark[]): void {
  AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => {});
}
