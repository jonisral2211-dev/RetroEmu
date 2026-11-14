import AsyncStorage from '@react-native-async-storage/async-storage';
import { Libretro } from 'react-native-libretro';
import { Btn } from '../emulator/buttons';

// Controles físicos del mando, en el orden que espera el nativo (GamepadBridge)
export const PHYSICAL: { id: string; label: string }[] = [
  { id: 'up', label: 'Cruceta / palanca ↑' },
  { id: 'down', label: 'Cruceta / palanca ↓' },
  { id: 'left', label: 'Cruceta / palanca ←' },
  { id: 'right', label: 'Cruceta / palanca →' },
  { id: 'a', label: 'Cruz ✕ / A / botón 1' },
  { id: 'b', label: 'Círculo ○ / B / botón 2' },
  { id: 'x', label: 'Cuadrado □ / X / botón 3' },
  { id: 'y', label: 'Triángulo △ / Y / botón 4' },
  { id: 'l1', label: 'L1 / LB / botón 5' },
  { id: 'r1', label: 'R1 / RB / botón 6' },
  { id: 'l2', label: 'L2 / LT' },
  { id: 'r2', label: 'R2 / RT' },
  { id: 'l3', label: 'L3 (clic stick izq.)' },
  { id: 'r3', label: 'R3 (clic stick der.)' },
  { id: 'menu', label: 'Options / Menú / START' },
  { id: 'options', label: 'Create / Vista / COIN' },
];

// Funciones de libretro que se pueden asignar (id = bit RETRO_DEVICE_ID_JOYPAD_*)
const bit = (b: number) => Math.round(Math.log2(b));
export const FUNCTIONS: { id: number; label: string }[] = [
  { id: bit(Btn.B), label: 'B (✕ / A arcade)' },
  { id: bit(Btn.A), label: 'A (○ / B arcade)' },
  { id: bit(Btn.Y), label: 'Y (□ / C arcade)' },
  { id: bit(Btn.X), label: 'X (△ / D arcade)' },
  { id: bit(Btn.L), label: 'L / L1 (E arcade)' },
  { id: bit(Btn.R), label: 'R / R1 (F arcade)' },
  { id: bit(Btn.L2), label: 'L2' },
  { id: bit(Btn.R2), label: 'R2' },
  { id: bit(Btn.L3), label: 'L3' },
  { id: bit(Btn.R3), label: 'R3' },
  { id: bit(Btn.START), label: 'START' },
  { id: bit(Btn.SELECT), label: 'SELECT / COIN' },
  { id: bit(Btn.UP), label: 'Arriba' },
  { id: bit(Btn.DOWN), label: 'Abajo' },
  { id: bit(Btn.LEFT), label: 'Izquierda' },
  { id: bit(Btn.RIGHT), label: 'Derecha' },
  { id: -1, label: 'Sin función' },
];

export const DEFAULT_MAPPING: number[] = [
  bit(Btn.UP), bit(Btn.DOWN), bit(Btn.LEFT), bit(Btn.RIGHT),
  bit(Btn.B), bit(Btn.A), bit(Btn.Y), bit(Btn.X),
  bit(Btn.L), bit(Btn.R), bit(Btn.L2), bit(Btn.R2),
  bit(Btn.L3), bit(Btn.R3), bit(Btn.START), bit(Btn.SELECT),
];

export type PadMappingPrefs = { mapping: number[]; deadzone: number };
export const DEFAULT_PAD_MAPPING: PadMappingPrefs = { mapping: DEFAULT_MAPPING, deadzone: 0.15 };
const KEY = 'jl.padmap.v1';

export function functionLabel(id: number): string {
  return FUNCTIONS.find((f) => f.id === id)?.label ?? 'Sin función';
}

export async function loadPadMapping(): Promise<PadMappingPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<PadMappingPrefs>) : {};
    const mapping = Array.isArray(saved.mapping) && saved.mapping.length === 16 ? saved.mapping : DEFAULT_MAPPING;
    return { mapping, deadzone: typeof saved.deadzone === 'number' ? saved.deadzone : DEFAULT_PAD_MAPPING.deadzone };
  } catch {
    return DEFAULT_PAD_MAPPING;
  }
}

export function savePadMapping(prefs: PadMappingPrefs): void {
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

/** Envía el mapeo al nativo. stickToDpad: el stick izquierdo también mueve la cruceta. */
export function applyPadMapping(prefs: PadMappingPrefs, stickToDpad = true): void {
  try {
    Libretro.setPadMapping(prefs.mapping);
    Libretro.setPadOptions(prefs.deadzone, stickToDpad);
  } catch {
    // nativo antiguo: sin mapeo configurable
  }
}
