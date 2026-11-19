import { useEffect, useRef } from 'react';
import { Libretro } from 'react-native-libretro';

// Bits de Libretro.gamepadInput().buttons: controles FÍSICOS del mando del Jugador 1, en el orden
// de GamepadBridge (enum Phys), no funciones de libretro.
export const PHYS = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  CROSS: 1 << 4, // ✕ / A
  CIRCLE: 1 << 5, // ○ / B
  SQUARE: 1 << 6, // □ / X
  TRIANGLE: 1 << 7, // △ / Y
  L1: 1 << 8,
  R1: 1 << 9,
  L2: 1 << 10,
  R2: 1 << 11,
  L3: 1 << 12,
  R3: 1 << 13,
  MENU: 1 << 14, // Options / Menú / START
  OPTIONS: 1 << 15, // Create / Vista / SELECT
} as const;

export type NavKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'accept' // ✕
  | 'back' // ○
  | 'action' // △
  | 'option' // □
  | 'prevTab' // L1
  | 'nextTab' // R1
  | 'menu' // Options
  | 'view'; // Create

const KEY_OF: [number, NavKey][] = [
  [PHYS.UP, 'up'],
  [PHYS.DOWN, 'down'],
  [PHYS.LEFT, 'left'],
  [PHYS.RIGHT, 'right'],
  [PHYS.CROSS, 'accept'],
  [PHYS.CIRCLE, 'back'],
  [PHYS.TRIANGLE, 'action'],
  [PHYS.SQUARE, 'option'],
  [PHYS.L1, 'prevTab'],
  [PHYS.R1, 'nextTab'],
  [PHYS.MENU, 'menu'],
  [PHYS.OPTIONS, 'view'],
];
const DIRS = PHYS.UP | PHYS.DOWN | PHYS.LEFT | PHYS.RIGHT;
const STICK = 0.55; // inclinación del stick izquierdo que cuenta como dirección
const REPEAT_DELAY = 380; // ms antes de repetir una dirección mantenida
const REPEAT_EVERY = 110;

/** Lee el mando: botones físicos + stick izquierdo convertido en cruceta. */
export function readPad(): number {
  try {
    const st = JSON.parse(Libretro.gamepadInput()) as { buttons?: number; lx?: number; ly?: number };
    let b = Number(st.buttons) || 0;
    const lx = Number(st.lx) || 0;
    const ly = Number(st.ly) || 0;
    if (lx < -STICK) b |= PHYS.LEFT;
    if (lx > STICK) b |= PHYS.RIGHT;
    if (ly < -STICK) b |= PHYS.UP; // negativo = arriba (convención libretro)
    if (ly > STICK) b |= PHYS.DOWN;
    return b;
  } catch {
    return 0;
  }
}

/**
 * Navegación de interfaz con el mando (DualSense, Xbox, MFi): llama a onKey en cada pulsación,
 * con repetición automática de las direcciones mantenidas. Solo escucha mientras enabled.
 */
export function usePadNav(onKey: (key: NavKey) => void, enabled: boolean): void {
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    if (!enabled) return;
    // Lo que ya está pulsado al activarse (p. ej. el ✕ que abrió esta pantalla) no cuenta
    let last = readPad();
    let heldSince = 0;
    let lastRepeat = 0;
    const id = setInterval(() => {
      const now = Date.now();
      const b = readPad();
      const pressed = b & ~last;
      const dirsHeld = b & DIRS;
      if (pressed & DIRS) {
        heldSince = now;
        lastRepeat = now;
      } else if (dirsHeld && dirsHeld === (last & DIRS) && now - heldSince > REPEAT_DELAY && now - lastRepeat > REPEAT_EVERY) {
        lastRepeat = now;
        for (const [bit, key] of KEY_OF) if (bit & DIRS && dirsHeld & bit) handler.current(key);
      }
      last = b;
      if (!pressed) return;
      for (const [bit, key] of KEY_OF) if (pressed & bit) handler.current(key);
    }, 45);
    return () => clearInterval(id);
  }, [enabled]);
}
