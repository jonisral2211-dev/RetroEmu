import { Btn } from '../emulator/buttons';
import type { CoreId } from '../emulator/cores';

// Coordenadas normalizadas al cluster (0..1). Un cluster es un área táctil con su propio
// GestureDetector; los clusters no se solapan.
//  - rect:   (x, y) = esquina superior izquierda, (w, h) = tamaño
//  - circle: (x, y) = centro, w = diámetro (en unidades de min(ancho, alto) del cluster)
//  - dpad/stick: (cx, cy) = centro, r = radio (en unidades de min(ancho, alto))

export type ButtonZone = {
  kind: 'button';
  label: string;
  shape: 'rect' | 'circle';
  x: number;
  y: number;
  w: number;
  h: number;
  bits: number;
  tint?: string;
};
export type DpadZone = { kind: 'dpad'; cx: number; cy: number; r: number; eightWay: boolean };
export type StickZone = { kind: 'stick'; cx: number; cy: number; r: number };
export type Zone = ButtonZone | DpadZone | StickZone;

export type Cluster = { id: string; x: number; y: number; w: number; h: number; zones: Zone[] };
export type PadLayout = { name: string; clusters: Cluster[] };

const rect = (label: string, x: number, y: number, w: number, h: number, bits: number, tint?: string): ButtonZone =>
  ({ kind: 'button', label, shape: 'rect', x, y, w, h, bits, tint });

const circle = (label: string, x: number, y: number, d: number, bits: number, tint?: string): ButtonZone =>
  ({ kind: 'button', label, shape: 'circle', x, y, w: d, h: d, bits, tint });

// ---- Game Boy Advance -----------------------------------------------------
// D-Pad en cruz, A/B en diagonal, L/R arriba en las esquinas, Start/Select abajo al centro.
export const GBA_LAYOUT: PadLayout = {
  name: 'Game Boy Advance',
  clusters: [
    {
      id: 'shoulders', x: 0, y: 0, w: 1, h: 0.24,
      zones: [rect('L', 0.02, 0.1, 0.28, 0.8, Btn.L), rect('R', 0.7, 0.1, 0.28, 0.8, Btn.R)],
    },
    {
      id: 'dpad', x: 0, y: 0.24, w: 0.44, h: 0.76,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: false }],
    },
    {
      id: 'face', x: 0.56, y: 0.24, w: 0.44, h: 0.76,
      zones: [circle('B', 0.3, 0.64, 0.3, Btn.B), circle('A', 0.7, 0.36, 0.3, Btn.A)],
    },
    {
      id: 'menu', x: 0.44, y: 0.5, w: 0.12, h: 0.5,
      zones: [rect('SEL', 0, 0.2, 1, 0.25, Btn.SELECT), rect('START', 0, 0.6, 1, 0.25, Btn.START)],
    },
  ],
};

// ---- Sega Genesis / Mega Drive ---------------------------------------------
// Mapeo de botones a bits libretro: asunción por defecto del core (A->B, B->A, C->Y,
// X->X, Y->L, Z->R). Validar en dispositivo con Genesis Plus GX.
function genesisLayout(sixButton: boolean): PadLayout {
  const face: Zone[] = sixButton
    ? [
        circle('X', 0.2, 0.22, 0.3, Btn.X),
        circle('Y', 0.5, 0.22, 0.3, Btn.L),
        circle('Z', 0.8, 0.22, 0.3, Btn.R),
        circle('A', 0.2, 0.68, 0.3, Btn.B),
        circle('B', 0.5, 0.68, 0.3, Btn.A),
        circle('C', 0.8, 0.68, 0.3, Btn.Y),
      ]
    : [
        // Tres botones en arco
        circle('A', 0.2, 0.65, 0.36, Btn.B),
        circle('B', 0.5, 0.4, 0.36, Btn.A),
        circle('C', 0.8, 0.65, 0.36, Btn.Y),
      ];

  return {
    name: sixButton ? 'Mega Drive (6 botones)' : 'Mega Drive (3 botones)',
    clusters: [
      {
        id: 'dpad', x: 0, y: 0.1, w: 0.4, h: 0.9,
        zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: true }],
      },
      {
        id: 'start', x: 0.4, y: 0.45, w: 0.2, h: 0.55,
        zones: [circle('START', 0.5, 0.4, 0.5, Btn.START)],
      },
      {
        id: 'face', x: 0.6, y: sixButton ? 0 : 0.2, w: 0.4, h: sixButton ? 1 : 0.8,
        zones: face,
      },
    ],
  };
}

export const GENESIS3_LAYOUT = genesisLayout(false);
export const GENESIS6_LAYOUT = genesisLayout(true);

// ---- Nintendo 64 ------------------------------------------------------------
// Stick analógico, D-Pad secundario, Z trasero-izquierdo, rombo de botones C (amarillo),
// A, B, L, R y Start. Mapeo por defecto de mupen64plus-next (emulate_game_controller_via_libretro.c):
// A=JOYPAD_B, B=JOYPAD_Y, C-Up=X, C-Down=A, C-Left=L, C-Right=R, Z=L2, R=R2, L=SELECT.
const C_YELLOW = '#ffd400';
export const N64_LAYOUT: PadLayout = {
  name: 'Nintendo 64',
  clusters: [
    {
      id: 'top', x: 0, y: 0, w: 1, h: 0.22,
      zones: [
        rect('Z', 0.02, 0.1, 0.26, 0.8, Btn.L2, '#8a8f98'),
        rect('L', 0.36, 0.1, 0.26, 0.8, Btn.SELECT),
        rect('R', 0.72, 0.1, 0.26, 0.8, Btn.R2),
      ],
    },
    {
      id: 'stick', x: 0, y: 0.22, w: 0.42, h: 0.46,
      zones: [{ kind: 'stick', cx: 0.5, cy: 0.5, r: 0.46 }],
    },
    {
      id: 'dpad', x: 0, y: 0.64, w: 0.36, h: 0.36,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: false }],
    },
    {
      id: 'cbuttons', x: 0.38, y: 0.22, w: 0.24, h: 0.78,
      zones: [
        circle('C▲', 0.5, 0.2, 0.36, Btn.X, C_YELLOW),
        circle('C◀', 0.15, 0.5, 0.36, Btn.L, C_YELLOW),
        circle('C▶', 0.85, 0.5, 0.36, Btn.R, C_YELLOW),
        circle('C▼', 0.5, 0.8, 0.36, Btn.A, C_YELLOW),
      ],
    },
    {
      id: 'face', x: 0.64, y: 0.22, w: 0.36, h: 0.78,
      zones: [
        circle('A', 0.7, 0.55, 0.42, Btn.B, '#3b82f6'),
        circle('B', 0.3, 0.4, 0.36, Btn.Y, '#ef4444'),
        rect('START', 0.25, 0.86, 0.5, 0.12, Btn.START),
      ],
    },
  ],
};

export function layoutFor(core: CoreId, genesisSixButton: boolean): PadLayout {
  switch (core) {
    case 'mgba':
      return GBA_LAYOUT;
    case 'genesis':
      return genesisSixButton ? GENESIS6_LAYOUT : GENESIS3_LAYOUT;
    case 'mupen64':
      return N64_LAYOUT;
    case 'mame':
      // Arcade: D-Pad, dos botones y Start/Select (layout de GBA)
      return GBA_LAYOUT;
  }
}
