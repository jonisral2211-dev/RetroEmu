import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoreId } from '../emulator/cores';

// Skins dinámicas de los controles táctiles: forma, paleta y relieve según la consola activa.
// Los colores de cada botón se buscan por su etiqueta (A, B, △…) para no tocar los layouts.

export type FaceStyle = { bg: string; label: string; border?: string };

export type PadSkin = {
  id: string;
  name: string;
  /** Botones sin color propio. */
  key: { bg: string; border: string; top: string; bottom: string; label: string; pressed: string };
  /** Color por etiqueta (botones de acción). */
  faces: Record<string, FaceStyle>;
  /** Botones redondos tipo bola de arcade (brillo superior). */
  glossy?: boolean;
  /** Cruceta: 'cross' = cruz de plástico (Nintendo/Sega) o 'ring' = anillo (por defecto). */
  dpad: { style: 'cross' | 'ring'; bg: string; border: string; arrow: string };
  stick: { base: string; puck: string; border: string };
  /** Hombros / gatillos y Start/Select (rect). */
  rect: { bg: string; border: string; label: string; radius: number };
  /** Translúcido (GBA "atomic purple"). */
  translucent?: boolean;
};

const BASE: PadSkin = {
  id: 'jl',
  name: 'JL Titanio',
  key: {
    bg: 'rgba(255,255,255,0.1)',
    border: 'rgba(255,255,255,0.25)',
    top: 'rgba(255,255,255,0.75)',
    bottom: 'rgba(0,0,0,0.5)',
    label: 'rgba(255,255,255,0.85)',
    pressed: 'rgba(255,255,255,0.4)',
  },
  faces: {},
  dpad: { style: 'ring', bg: 'rgba(0,0,0,0.25)', border: 'rgba(255,255,255,0.3)', arrow: 'rgba(255,255,255,0.5)' },
  stick: { base: 'rgba(0,0,0,0.38)', puck: 'rgba(255,255,255,0.35)', border: 'rgba(255,255,255,0.45)' },
  rect: { bg: 'rgba(255,255,255,0.1)', border: 'rgba(255,255,255,0.25)', label: 'rgba(255,255,255,0.85)', radius: 14 },
};

const skin = (patch: Partial<PadSkin> & { id: string; name: string }): PadSkin => ({
  ...BASE,
  ...patch,
  key: { ...BASE.key, ...(patch.key ?? {}) },
  dpad: { ...BASE.dpad, ...(patch.dpad ?? {}) },
  stick: { ...BASE.stick, ...(patch.stick ?? {}) },
  rect: { ...BASE.rect, ...(patch.rect ?? {}) },
});

const face = (bg: string, label = '#fff', border?: string): FaceStyle => ({ bg, label, border });

// Super Nintendo (paleta PAL/Super Famicom): A rojo, B amarillo, X azul, Y verde
const SNES = skin({
  id: 'snes',
  name: 'Super Nintendo',
  faces: {
    A: face('rgba(214,40,57,0.82)'),
    B: face('rgba(242,183,5,0.85)', '#2b2100'),
    X: face('rgba(37,99,235,0.82)'),
    Y: face('rgba(22,163,74,0.82)'),
  },
  dpad: { style: 'cross', bg: 'rgba(40,40,46,0.72)', border: 'rgba(160,160,170,0.6)', arrow: 'rgba(220,220,230,0.6)' },
  rect: { bg: 'rgba(170,170,182,0.32)', border: 'rgba(210,210,220,0.55)', label: '#f1f1f4', radius: 18 },
});

// Game Boy Advance translúcido ("atomic purple")
const GBA = skin({
  id: 'gba',
  name: 'GBA Translúcido',
  translucent: true,
  key: {
    bg: 'rgba(124,58,237,0.16)',
    border: 'rgba(167,139,250,0.55)',
    top: 'rgba(221,214,254,0.7)',
    bottom: 'rgba(46,16,101,0.6)',
    label: 'rgba(237,233,254,0.92)',
    pressed: 'rgba(167,139,250,0.5)',
  },
  faces: {
    A: face('rgba(139,92,246,0.42)', '#f5f3ff', 'rgba(221,214,254,0.7)'),
    B: face('rgba(139,92,246,0.42)', '#f5f3ff', 'rgba(221,214,254,0.7)'),
  },
  dpad: { style: 'cross', bg: 'rgba(76,29,149,0.38)', border: 'rgba(196,181,253,0.6)', arrow: 'rgba(237,233,254,0.7)' },
  stick: { base: 'rgba(76,29,149,0.3)', puck: 'rgba(196,181,253,0.45)', border: 'rgba(196,181,253,0.6)' },
  rect: { bg: 'rgba(124,58,237,0.2)', border: 'rgba(196,181,253,0.55)', label: '#ede9fe', radius: 20 },
});

// DualShock (PS1): cuerpo gris oscuro y símbolos de color
const DUALSHOCK = skin({
  id: 'ps1',
  name: 'DualShock',
  faces: {
    '△': face('rgba(30,32,38,0.78)', '#4ade80', 'rgba(74,222,128,0.6)'),
    '○': face('rgba(30,32,38,0.78)', '#f87171', 'rgba(248,113,113,0.6)'),
    '✕': face('rgba(30,32,38,0.78)', '#60a5fa', 'rgba(96,165,250,0.6)'),
    '□': face('rgba(30,32,38,0.78)', '#f0abfc', 'rgba(240,171,252,0.6)'),
  },
  dpad: { style: 'cross', bg: 'rgba(34,36,42,0.78)', border: 'rgba(140,145,155,0.55)', arrow: 'rgba(200,204,212,0.6)' },
  stick: { base: 'rgba(20,21,26,0.72)', puck: 'rgba(60,63,72,0.9)', border: 'rgba(140,145,155,0.6)' },
  rect: { bg: 'rgba(52,55,63,0.72)', border: 'rgba(150,155,165,0.5)', label: '#d4d7de', radius: 10 },
});

// Nintendo 64: A azul, B verde, C amarillos, Start rojo
const N64 = skin({
  id: 'n64',
  name: 'Nintendo 64',
  faces: {
    A: face('rgba(37,99,235,0.85)'),
    B: face('rgba(22,163,74,0.85)'),
    'C▲': face('rgba(250,204,21,0.82)', '#3a2c00'),
    'C▼': face('rgba(250,204,21,0.82)', '#3a2c00'),
    'C◀': face('rgba(250,204,21,0.82)', '#3a2c00'),
    'C▶': face('rgba(250,204,21,0.82)', '#3a2c00'),
    START: face('rgba(220,38,38,0.85)'),
  },
  dpad: { style: 'cross', bg: 'rgba(60,62,70,0.72)', border: 'rgba(170,170,180,0.5)', arrow: 'rgba(220,220,230,0.6)' },
  stick: { base: 'rgba(55,58,66,0.75)', puck: 'rgba(170,172,180,0.85)', border: 'rgba(200,200,210,0.6)' },
  rect: { bg: 'rgba(80,83,92,0.6)', border: 'rgba(180,182,190,0.5)', label: '#f0f0f4', radius: 12 },
});

// Arcade: bolas brillantes de colores y palanca roja
const ARCADE_COLORS = ['rgba(220,38,38,0.88)', 'rgba(37,99,235,0.88)', 'rgba(234,179,8,0.9)', 'rgba(22,163,74,0.88)',
  'rgba(236,72,153,0.88)', 'rgba(245,245,245,0.85)'];
const ARCADE = skin({
  id: 'arcade',
  name: 'Arcade',
  glossy: true,
  faces: {
    A: face(ARCADE_COLORS[0]),
    B: face(ARCADE_COLORS[1]),
    C: face(ARCADE_COLORS[2], '#3a2c00'),
    D: face(ARCADE_COLORS[3]),
    E: face(ARCADE_COLORS[4]),
    F: face(ARCADE_COLORS[5], '#222'),
    X: face(ARCADE_COLORS[2], '#3a2c00'),
    Y: face(ARCADE_COLORS[3]),
    Z: face(ARCADE_COLORS[4]),
    L: face(ARCADE_COLORS[4]),
    R: face(ARCADE_COLORS[5], '#222'),
    COIN: face('rgba(250,204,21,0.25)', '#fde68a', 'rgba(250,204,21,0.7)'),
    START: face('rgba(255,255,255,0.14)', '#fff', 'rgba(255,255,255,0.6)'),
  },
  stick: { base: 'rgba(15,15,18,0.8)', puck: 'rgba(220,38,38,0.92)', border: 'rgba(80,80,90,0.8)' },
  dpad: { style: 'ring', bg: 'rgba(15,15,18,0.7)', border: 'rgba(220,38,38,0.6)', arrow: 'rgba(248,113,113,0.8)' },
});

// NES: gris claro con botones rojos
const NES = skin({
  id: 'nes',
  name: 'NES',
  faces: { A: face('rgba(200,30,40,0.88)'), B: face('rgba(200,30,40,0.88)') },
  dpad: { style: 'cross', bg: 'rgba(25,25,28,0.8)', border: 'rgba(170,170,175,0.5)', arrow: 'rgba(210,210,215,0.55)' },
  rect: { bg: 'rgba(30,30,34,0.7)', border: 'rgba(200,30,40,0.6)', label: '#f4f4f5', radius: 18 },
});

// Game Boy / Color: botones magenta
const GB = skin({
  id: 'gb',
  name: 'Game Boy',
  faces: { A: face('rgba(157,23,77,0.88)'), B: face('rgba(157,23,77,0.88)') },
  dpad: { style: 'cross', bg: 'rgba(28,28,32,0.8)', border: 'rgba(170,170,175,0.5)', arrow: 'rgba(210,210,215,0.55)' },
  rect: { bg: 'rgba(120,120,128,0.4)', border: 'rgba(200,200,210,0.5)', label: '#f4f4f5', radius: 18 },
});

// Mega Drive / Genesis: negro con botones grises
const GENESIS = skin({
  id: 'genesis',
  name: 'Mega Drive',
  key: { ...BASE.key, bg: 'rgba(20,20,22,0.7)', border: 'rgba(120,120,128,0.6)', pressed: 'rgba(160,160,170,0.5)' },
  faces: {
    A: face('rgba(60,62,70,0.85)'), B: face('rgba(60,62,70,0.85)'), C: face('rgba(60,62,70,0.85)'),
    X: face('rgba(90,92,100,0.85)'), Y: face('rgba(90,92,100,0.85)'), Z: face('rgba(90,92,100,0.85)'),
    START: face('rgba(30,30,34,0.85)', '#e5e7eb', 'rgba(150,150,160,0.6)'),
  },
  dpad: { style: 'ring', bg: 'rgba(20,20,22,0.75)', border: 'rgba(130,130,140,0.6)', arrow: 'rgba(200,200,210,0.6)' },
});

// Nintendo DS: plata y botones de color de la DS Lite
const NDS = skin({
  id: 'nds',
  name: 'Nintendo DS',
  faces: {
    A: face('rgba(229,231,235,0.3)', '#fff', 'rgba(255,255,255,0.7)'),
    B: face('rgba(229,231,235,0.3)', '#fff', 'rgba(255,255,255,0.7)'),
    X: face('rgba(229,231,235,0.3)', '#fff', 'rgba(255,255,255,0.7)'),
    Y: face('rgba(229,231,235,0.3)', '#fff', 'rgba(255,255,255,0.7)'),
  },
  dpad: { style: 'cross', bg: 'rgba(200,203,210,0.25)', border: 'rgba(240,240,245,0.6)', arrow: 'rgba(255,255,255,0.7)' },
  rect: { bg: 'rgba(200,203,210,0.22)', border: 'rgba(240,240,245,0.55)', label: '#fff', radius: 16 },
});

// Dreamcast: A rojo, B azul, X amarillo, Y verde
const DREAMCAST = skin({
  id: 'dreamcast',
  name: 'Dreamcast',
  faces: {
    A: face('rgba(220,38,38,0.82)'),
    B: face('rgba(37,99,235,0.82)'),
    X: face('rgba(234,179,8,0.85)', '#3a2c00'),
    Y: face('rgba(22,163,74,0.82)'),
  },
  stick: { base: 'rgba(235,235,240,0.2)', puck: 'rgba(240,240,245,0.55)', border: 'rgba(255,255,255,0.5)' },
});

const BY_CORE: Partial<Record<CoreId, PadSkin>> = {
  snes9x: SNES,
  mgba: GBA,
  pcsx: DUALSHOCK,
  swanstation: DUALSHOCK,
  ppsspp: DUALSHOCK,
  mupen64: N64,
  fbneo: ARCADE,
  mame: ARCADE,
  cannonball: ARCADE,
  fceumm: NES,
  gambatte: GB,
  genesis: GENESIS,
  yabause: GENESIS,
  melonds: NDS,
  desmume: NDS,
  flycast: DREAMCAST,
};

export function skinFor(core: CoreId | null | undefined, enabled = true): PadSkin {
  if (!enabled || !core) return BASE;
  return BY_CORE[core] ?? BASE;
}

export const DEFAULT_SKIN = BASE;

// Preferencia: skins por consola (activadas por defecto) o el estilo neutro de siempre
const KEY = 'jl.padskins.v1';
let skinsOn = true;
const listeners = new Set<(on: boolean) => void>();
AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v === '0') {
      skinsOn = false;
      listeners.forEach((l) => l(false));
    }
  })
  .catch(() => {});

export function skinsEnabled(): boolean {
  return skinsOn;
}

export function setSkinsEnabled(on: boolean): void {
  skinsOn = on;
  listeners.forEach((l) => l(on));
  AsyncStorage.setItem(KEY, on ? '1' : '0').catch(() => {});
}

export function subscribeSkins(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
