import AsyncStorage from '@react-native-async-storage/async-storage';
import { Libretro } from 'react-native-libretro';

// Partidas en iCloud Drive: carpeta elegida por el usuario (bookmark), sincronizada al guardar,
// pausar o cerrar un juego y restaurada antes de abrirlo. La copia local siempre se conserva.

export type CloudInfo = { linked: boolean; name: string; available: boolean; lastSync: number };
export type CloudResult = { ok: boolean; error?: string; pushed?: number; pulled?: number; pending?: number };

const PREFS_KEY = 'jl.cloudsync.v1';
let auto = true;
const listeners = new Set<() => void>();

AsyncStorage.getItem(PREFS_KEY)
  .then((v) => {
    if (v === '0') auto = false;
  })
  .catch(() => {});

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeCloud(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function cloudInfo(): CloudInfo {
  try {
    return JSON.parse(Libretro.cloudInfo()) as CloudInfo;
  } catch {
    return { linked: false, name: '', available: false, lastSync: 0 };
  }
}

export function cloudAutoSync(): boolean {
  return auto;
}

export function setCloudAutoSync(on: boolean): void {
  auto = on;
  AsyncStorage.setItem(PREFS_KEY, on ? '1' : '0').catch(() => {});
  notify();
}

/** Abre el selector de carpetas (elige una dentro de iCloud Drive). Devuelve el nombre o ''. */
export async function linkCloudFolder(): Promise<string> {
  const name = await Libretro.cloudPickFolder();
  notify();
  return name;
}

export function unlinkCloudFolder(): void {
  Libretro.cloudUnlink();
  notify();
}

/** Sincroniza ya (sin esperar a otras). romPath '' = todas las partidas. */
export async function syncNow(romPath: string, direction: 'push' | 'pull' | 'both'): Promise<CloudResult> {
  try {
    const result = JSON.parse(await Libretro.cloudSync(romPath, direction)) as CloudResult;
    notify();
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function active(): boolean {
  return auto && cloudInfo().linked;
}

/**
 * Antes de abrir un juego: trae de la nube las partidas más recientes (otro dispositivo o
 * reinstalación). Con tiempo máximo: sin conexión se juega con la copia local.
 */
export async function pullBeforePlay(romPath: string, timeoutMs = 4000): Promise<CloudResult | null> {
  if (!active()) return null;
  const timeout = new Promise<CloudResult>((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeoutMs));
  return Promise.race([syncNow(romPath, 'both'), timeout]);
}

// Subidas agrupadas: guardar varias veces seguidas genera una sola copia
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Tras guardar, pausar o cerrar: sube las partidas del juego (agrupado 1,5 s). */
export function pushAfterSave(romPath: string, delayMs = 1500): void {
  if (!active()) return;
  const prev = timers.get(romPath);
  if (prev) clearTimeout(prev);
  timers.set(
    romPath,
    setTimeout(() => {
      timers.delete(romPath);
      syncNow(romPath, 'push');
    }, delayMs),
  );
}
