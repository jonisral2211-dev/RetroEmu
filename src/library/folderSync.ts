import AsyncStorage from '@react-native-async-storage/async-storage';
import { Libretro } from 'react-native-libretro';
import { notifyRomImported } from '../downloads/DownloadManager';

// Carpeta vinculada (Descargas, iCloud Drive…): el nativo guarda el permiso (bookmark) y escanea
// por cabecera/serial, también dentro de .zip y .7z. Aquí: tipos, preferencias y resúmenes.

export type ScanItem = {
  rel: string;
  name: string;
  size: number;
  kind: 'game' | 'archive' | 'bios' | 'unknown';
  console: string; // carpeta de destino: ps1, psp, gba…, system, arcade, .inbox
  label: string;
  serial: string;
  title: string;
  detail: string;
  files: string[];
  destName: string;
  already: boolean;
};

export type ScanSummary = {
  games: Record<string, number>;
  bios: number;
  archives: number;
  unknown: number;
  icloud: number;
  already: number;
  total: number;
};

export type ScanResult = { ok: boolean; error?: string; folder?: string; items: ScanItem[]; summary: ScanSummary };

export type ImportResult = {
  ok: boolean;
  error?: string;
  imported: Record<string, number>;
  bios: number;
  archives: number;
  failed: number;
  skipped: number;
  unknown: number;
  icloud: number;
  errors: string[];
};

export type FolderInfo = { linked: boolean; name: string; available: boolean };
export type SyncPrefs = { autoSync: boolean; move: boolean };

const PREFS_KEY = 'jl.foldersync.v1';
const DEFAULT_PREFS: SyncPrefs = { autoSync: true, move: false };

export const CONSOLE_NAMES: Record<string, string> = {
  ps1: 'PlayStation',
  psp: 'PSP',
  n64: 'Nintendo 64',
  nds: 'Nintendo DS',
  gba: 'Game Boy Advance',
  gb: 'Game Boy',
  gbc: 'Game Boy Color',
  n3ds: 'Nintendo 3DS',
  ps2: 'PlayStation 2',
  snes: 'Super Nintendo',
  nes: 'NES',
  sega: 'Sega',
  saturn: 'Saturn',
  dreamcast: 'Dreamcast',
  arcade: 'Arcade',
  fbneo: 'FBNeo',
  ports: 'Ports PC',
  system: 'BIOS',
  '.inbox': 'Varios',
};

export async function loadSyncPrefs(): Promise<SyncPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<SyncPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveSyncPrefs(p: SyncPrefs): void {
  AsyncStorage.setItem(PREFS_KEY, JSON.stringify(p)).catch(() => {});
}

export function folderInfo(): FolderInfo {
  try {
    return JSON.parse(Libretro.scanFolderInfo()) as FolderInfo;
  } catch {
    return { linked: false, name: '', available: false };
  }
}

/** Abre el selector de carpetas; resuelve el nombre ('' si se canceló). */
export function linkFolder(): Promise<string> {
  return Libretro.pickScanFolder();
}

export function unlinkFolder(): void {
  Libretro.unlinkScanFolder();
}

export async function analyzeFolder(): Promise<ScanResult> {
  return JSON.parse(await Libretro.scanLinkedFolder()) as ScanResult;
}

let importing: Promise<ImportResult> | null = null;

/** Importa lo nuevo; la biblioteca se refresca al terminar (también descomprime lo que llegue). */
export function importFolder(move: boolean): Promise<ImportResult> {
  if (importing) return importing;
  importing = Libretro.importLinkedFolder(move)
    .then((json) => {
      const r = JSON.parse(json) as ImportResult;
      if (importedCount(r) > 0) notifyRomImported('');
      return r;
    })
    .finally(() => {
      importing = null;
    });
  return importing;
}

export function scanStatus(): { busy: boolean; phase?: string; current?: string; done?: number; total?: number } {
  try {
    return JSON.parse(Libretro.folderScanStatus());
  } catch {
    return { busy: false };
  }
}

export function importedCount(r: ImportResult): number {
  return Object.values(r.imported ?? {}).reduce((a, b) => a + b, 0) + (r.bios ?? 0);
}

/** "3 juegos nuevos (PS1 2, GBA 1) · 1 BIOS" */
export function importSummary(r: ImportResult): string {
  const games = Object.entries(r.imported ?? {}).filter(([c]) => c !== 'system');
  const total = games.reduce((a, [, n]) => a + n, 0);
  const parts: string[] = [];
  if (total) {
    const detail = games.map(([c, n]) => `${CONSOLE_NAMES[c] ?? c} ${n}`).join(', ');
    parts.push(`${total} juego${total === 1 ? '' : 's'} nuevo${total === 1 ? '' : 's'} (${detail})`);
  }
  if (r.bios) parts.push(`${r.bios} BIOS → system/`);
  if (r.icloud) parts.push(`${r.icloud} descargándose de iCloud`);
  if (r.failed) parts.push(`${r.failed} con error`);
  return parts.join(' · ') || 'Sin novedades en la carpeta';
}

/** Al abrir la app: si hay carpeta vinculada y auto-sincronización, importa lo nuevo. */
export async function autoSyncOnLaunch(): Promise<ImportResult | null> {
  const prefs = await loadSyncPrefs();
  if (!prefs.autoSync) return null;
  const info = folderInfo();
  if (!info.linked || !info.available) return null;
  try {
    return await importFolder(prefs.move);
  } catch {
    return null;
  }
}
