import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoreId } from '../emulator/cores';
import type { Cluster, DirMode, PadLayout } from './layouts';

export type Orientation = 'portrait' | 'landscape';

/** Ajustes del pad por consola y orientación. Offsets normalizados al área del pad. */
export type PadPrefs = {
  opacity: number; // 0.15 .. 1
  scale: number; // 0.6 .. 1.6
  offsets: Record<string, { dx: number; dy: number }>;
  dirMode?: DirMode;
};

/** Ajustes de imagen por orientación. */
export type DisplayPrefs = { stretch: boolean };

export const OPACITY_MIN = 0.15;
export const SCALE_MIN = 0.6;
export const SCALE_MAX = 1.6;

export function defaultPadPrefs(orientation: Orientation): PadPrefs {
  return { opacity: orientation === 'landscape' ? 0.45 : 1, scale: 1, offsets: {} };
}

// v2: nuevos layouts horizontales por defecto (los ajustes v1 apuntaban a otras posiciones)
const padKey = (core: CoreId, o: Orientation) => `jl.pad.v2.${core}.${o}`;
const displayKey = (o: Orientation) => `jl.display.v1.${o}`;

async function readJson<T>(key: string): Promise<Partial<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

export async function loadPadPrefs(core: CoreId, o: Orientation): Promise<PadPrefs> {
  const saved = await readJson<PadPrefs>(padKey(core, o));
  return { ...defaultPadPrefs(o), ...(saved ?? {}), offsets: { ...(saved?.offsets ?? {}) } };
}

export function savePadPrefs(core: CoreId, o: Orientation, prefs: PadPrefs): void {
  AsyncStorage.setItem(padKey(core, o), JSON.stringify(prefs)).catch(() => {});
}

export async function loadDisplayPrefs(o: Orientation): Promise<DisplayPrefs> {
  const saved = await readJson<DisplayPrefs>(displayKey(o));
  return { stretch: false, ...(saved ?? {}) };
}

export function saveDisplayPrefs(o: Orientation, prefs: DisplayPrefs): void {
  AsyncStorage.setItem(displayKey(o), JSON.stringify(prefs)).catch(() => {});
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Escala cada cluster sobre su centro y le suma su desplazamiento, sin salirse del pad. */
export function applyPadPrefs(layout: PadLayout, prefs: PadPrefs): PadLayout {
  const clusters: Cluster[] = layout.clusters.map((c) => {
    const off = prefs.offsets[c.id] ?? { dx: 0, dy: 0 };
    const w = Math.min(1, c.w * prefs.scale);
    const h = Math.min(1, c.h * prefs.scale);
    const cx = c.x + c.w / 2 + off.dx;
    const cy = c.y + c.h / 2 + off.dy;
    return { ...c, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
  });
  return { ...layout, clusters };
}

// PS1: resolución interna elegida (false = 1x Fluido, true = 2x HD)
const PS1_HD_KEY = 'jl.ps1.hd.v1';

export async function loadPs1Hd(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PS1_HD_KEY)) === '1';
  } catch {
    return false;
  }
}

export function savePs1Hd(hd: boolean): void {
  AsyncStorage.setItem(PS1_HD_KEY, hd ? '1' : '0').catch(() => {});
}
