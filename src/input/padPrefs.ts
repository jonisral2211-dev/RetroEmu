import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoreId } from '../emulator/cores';
import type { DirMode } from './layouts';

// 'tv' / 'tvl' = mando a pantalla completa del modo TV en vertical / horizontal (acomodo propio)
export type Orientation = 'portrait' | 'landscape' | 'tv' | 'tvl';

/** Orientación del iPhone como mando en modo TV. */
export type TvOrientation = 'portrait' | 'landscape' | 'auto';
const TV_ORIENT_KEY = 'jl.tvorient.v1';

export async function loadTvOrientation(): Promise<TvOrientation> {
  try {
    const v = await AsyncStorage.getItem(TV_ORIENT_KEY);
    return v === 'landscape' || v === 'auto' ? v : 'portrait';
  } catch {
    return 'portrait';
  }
}

export function saveTvOrientation(v: TvOrientation): void {
  AsyncStorage.setItem(TV_ORIENT_KEY, v).catch(() => {});
}

/** Ajustes del pad por consola y orientación. Offsets normalizados al área del pad. */
export type PadPrefs = {
  opacity: number; // 0.15 .. 1
  scale: number; // 0.6 .. 1.6
  // Desplazamiento por botón (id "grupo:etiqueta", o "dpad"/"stick"). Los ajustes antiguos
  // guardados por grupo ("face", "shoulders"…) siguen valiendo para los botones de ese grupo.
  offsets: Record<string, { dx: number; dy: number }>;
  /** Tamaño individual por botón (multiplica al tamaño global). */
  sizes?: Record<string, number>;
  /** Opacidad individual por botón (multiplica a la global). */
  alphas?: Record<string, number>;
  dirMode?: DirMode;
};

/** Respuesta táctil por consola (igual en vertical y horizontal). */
export type Feel = {
  sensitivity: number; // stick: 0.5 .. 2 (1 = recorrido completo hasta el borde)
  deadzone: number; // stick y cruceta: 0.05 .. 0.4
  hitSlop: number; // área de detección de botones: 0.8 .. 1.5 (sin cambiar el dibujo)
  haptics: boolean;
};

export const DEFAULT_FEEL: Feel = { sensitivity: 1, deadzone: 0.2, hitSlop: 1, haptics: false };
export const BUTTON_SIZE_MIN = 0.5;
export const BUTTON_SIZE_MAX = 2;

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
const feelKey = (core: CoreId) => `jl.feel.v1.${core}`;

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

export async function loadFeel(core: CoreId): Promise<Feel> {
  const saved = await readJson<Feel>(feelKey(core));
  return { ...DEFAULT_FEEL, ...(saved ?? {}) };
}

export function saveFeel(core: CoreId, feel: Feel): void {
  AsyncStorage.setItem(feelKey(core), JSON.stringify(feel)).catch(() => {});
}

export async function loadDisplayPrefs(o: Orientation): Promise<DisplayPrefs> {
  const saved = await readJson<DisplayPrefs>(displayKey(o));
  return { stretch: false, ...(saved ?? {}) };
}

export function saveDisplayPrefs(o: Orientation, prefs: DisplayPrefs): void {
  AsyncStorage.setItem(displayKey(o), JSON.stringify(prefs)).catch(() => {});
}

// Calidad de imagen: 'sharp' = Nítido HD (pixel-perfect, por defecto) / 'smooth' = suavizado ligero
const QUALITY_KEY = 'jl.quality.v1';

export async function loadQuality(): Promise<'sharp' | 'smooth'> {
  try {
    return (await AsyncStorage.getItem(QUALITY_KEY)) === 'smooth' ? 'smooth' : 'sharp';
  } catch {
    return 'sharp';
  }
}

export function saveQuality(q: 'sharp' | 'smooth'): void {
  AsyncStorage.setItem(QUALITY_KEY, q).catch(() => {});
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
