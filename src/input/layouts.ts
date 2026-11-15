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
// toDpad: el stick emite direcciones de cruceta (consolas sin analógico: GBA, Sega, PS1, arcade)
export type StickZone = { kind: 'stick'; cx: number; cy: number; r: number; toDpad?: boolean };
export type Zone = ButtonZone | DpadZone | StickZone;

export type Cluster = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zones: Zone[];
  /** Grupo original (pad dividido en botones sueltos): sus ajustes antiguos se heredan. */
  group?: string;
  /** Fracción del cluster que ocupa el dibujo (stick/cruceta llevan margen para seguir el dedo). */
  vis?: number;
};
export type PadLayout = { name: string; clusters: Cluster[] };

export const rect = (label: string, x: number, y: number, w: number, h: number, bits: number, tint?: string): ButtonZone =>
  ({ kind: 'button', label, shape: 'rect', x, y, w, h, bits, tint });

export const circle = (label: string, x: number, y: number, d: number, bits: number, tint?: string): ButtonZone =>
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
      id: 'top', x: 0, y: 0, w: 1, h: 0.14,
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

// N64 en horizontal: pad translúcido sobre toda la pantalla. Stick abajo a la izquierda,
// C en diamante a la izquierda de A/B, Z y L arriba a la izquierda, R arriba a la derecha.
export const N64_LANDSCAPE_LAYOUT: PadLayout = {
  name: 'Nintendo 64 (horizontal)',
  clusters: [
    {
      id: 'top-left', x: 0, y: 0, w: 0.3, h: 0.16,
      zones: [
        rect('Z', 0.02, 0.1, 0.46, 0.8, Btn.L2, '#8a8f98'),
        rect('L', 0.52, 0.1, 0.46, 0.8, Btn.SELECT),
      ],
    },
    {
      id: 'top-right', x: 0.7, y: 0, w: 0.3, h: 0.16,
      zones: [rect('R', 0.02, 0.1, 0.96, 0.8, Btn.R2)],
    },
    {
      id: 'stick', x: 0, y: 0.5, w: 0.3, h: 0.5,
      zones: [{ kind: 'stick', cx: 0.5, cy: 0.5, r: 0.46 }],
    },
    {
      id: 'dpad', x: 0, y: 0.5, w: 0.3, h: 0.5,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: false }],
    },
    {
      id: 'cbuttons', x: 0.3, y: 0.45, w: 0.22, h: 0.55,
      zones: [
        circle('C▲', 0.5, 0.18, 0.34, Btn.X, C_YELLOW),
        circle('C◀', 0.14, 0.5, 0.34, Btn.L, C_YELLOW),
        circle('C▶', 0.86, 0.5, 0.34, Btn.R, C_YELLOW),
        circle('C▼', 0.5, 0.82, 0.34, Btn.A, C_YELLOW),
      ],
    },
    {
      id: 'face', x: 0.74, y: 0.36, w: 0.26, h: 0.48,
      zones: [
        circle('A', 0.68, 0.6, 0.46, Btn.B, '#3b82f6'),
        circle('B', 0.28, 0.38, 0.4, Btn.Y, '#ef4444'),
      ],
    },
    {
      id: 'start', x: 0.76, y: 0.86, w: 0.2, h: 0.14,
      zones: [rect('START', 0.1, 0.15, 0.8, 0.7, Btn.START)],
    },
  ],
};

// ---- PlayStation (PCSX ReARMed) --------------------------------------------
// Mapeo del core: Cruz=B, Círculo=A, Triángulo=X, Cuadrado=Y (pcsx frontend/libretro.c).
// Gatillos L1/L2 a la izquierda y R1/R2 a la derecha, en una franja delgada arriba.
export const PS1_LAYOUT: PadLayout = {
  name: 'PlayStation',
  clusters: [
    {
      id: 'shoulders', x: 0, y: 0, w: 1, h: 0.14,
      zones: [
        rect('L2', 0.02, 0.1, 0.22, 0.8, Btn.L2, '#8a8f98'),
        rect('L1', 0.26, 0.1, 0.22, 0.8, Btn.L, '#8a8f98'),
        rect('R1', 0.52, 0.1, 0.22, 0.8, Btn.R, '#8a8f98'),
        rect('R2', 0.76, 0.1, 0.22, 0.8, Btn.R2, '#8a8f98'),
      ],
    },
    {
      id: 'dpad', x: 0, y: 0.22, w: 0.36, h: 0.42,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: false }],
    },
    {
      id: 'center', x: 0.38, y: 0.5, w: 0.24, h: 0.5,
      zones: [rect('SEL', 0, 0.2, 1, 0.25, Btn.SELECT), rect('START', 0, 0.6, 1, 0.25, Btn.START)],
    },
    {
      id: 'face', x: 0.6, y: 0.22, w: 0.4, h: 0.78,
      zones: [
        circle('△', 0.5, 0.2, 0.32, Btn.X, '#4ade80'),
        circle('□', 0.2, 0.5, 0.32, Btn.Y, '#f0abfc'),
        circle('○', 0.8, 0.5, 0.32, Btn.A, '#f87171'),
        circle('✕', 0.5, 0.8, 0.32, Btn.B, '#60a5fa'),
      ],
    },
  ],
};

// ---- Horizontal (todas las consolas) ----------------------------------------
// El pad ocupa el área BAJO la barra de menú. Columnas laterales de 26 % (el juego queda en
// el centro, libre): gatillos arriba en las esquinas, direccional y botones de acción en la
// mitad inferior, SELECT/START en las esquinas inferiores.
const SIDE_W = 0.26;
const TRIG_H = 0.17;
const BODY_Y = 0.3;
const BODY_H = 0.54;
const FOOT_Y = 0.86;
const FOOT_H = 0.14;
const GRAY = '#8a8f98';

function sideClusters(opts: {
  leftTriggers: ButtonZone[];
  rightTriggers: ButtonZone[];
  face: Zone[];
  select?: ButtonZone;
  start: ButtonZone;
  eightWay: boolean;
}): Cluster[] {
  const clusters: Cluster[] = [];
  if (opts.leftTriggers.length) {
    clusters.push({ id: 'trig-left', x: 0, y: 0, w: SIDE_W, h: TRIG_H, zones: opts.leftTriggers });
  }
  if (opts.rightTriggers.length) {
    clusters.push({ id: 'trig-right', x: 1 - SIDE_W, y: 0, w: SIDE_W, h: TRIG_H, zones: opts.rightTriggers });
  }
  clusters.push({
    id: 'dpad', x: 0, y: BODY_Y, w: SIDE_W, h: BODY_H,
    zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: opts.eightWay }],
  });
  clusters.push({ id: 'face', x: 1 - SIDE_W, y: BODY_Y, w: SIDE_W, h: BODY_H, zones: opts.face });
  if (opts.select) {
    clusters.push({ id: 'select', x: 0.04, y: FOOT_Y, w: SIDE_W - 0.06, h: FOOT_H, zones: [opts.select] });
  }
  clusters.push({ id: 'start', x: 1 - SIDE_W + 0.02, y: FOOT_Y, w: SIDE_W - 0.06, h: FOOT_H, zones: [opts.start] });
  return clusters;
}

const footBtn = (label: string, bits: number) => rect(label, 0.1, 0.15, 0.8, 0.7, bits);
const trig = (label: string, x: number, w: number, bits: number, tint?: string) =>
  rect(label, x, 0.12, w, 0.76, bits, tint);

export const GBA_LANDSCAPE_LAYOUT: PadLayout = {
  name: 'Game Boy Advance (horizontal)',
  clusters: sideClusters({
    leftTriggers: [trig('L', 0.06, 0.88, Btn.L)],
    rightTriggers: [trig('R', 0.06, 0.88, Btn.R)],
    face: [circle('B', 0.3, 0.62, 0.42, Btn.B), circle('A', 0.72, 0.38, 0.42, Btn.A)],
    select: footBtn('SELECT', Btn.SELECT),
    start: footBtn('START', Btn.START),
    eightWay: false,
  }),
};

function genesisLandscape(sixButton: boolean): PadLayout {
  const face: Zone[] = sixButton
    ? [
        circle('X', 0.18, 0.28, 0.32, Btn.X),
        circle('Y', 0.5, 0.22, 0.32, Btn.L),
        circle('Z', 0.82, 0.16, 0.32, Btn.R),
        circle('A', 0.18, 0.72, 0.32, Btn.B),
        circle('B', 0.5, 0.66, 0.32, Btn.A),
        circle('C', 0.82, 0.6, 0.32, Btn.Y),
      ]
    : [
        circle('A', 0.18, 0.62, 0.36, Btn.B),
        circle('B', 0.5, 0.46, 0.36, Btn.A),
        circle('C', 0.82, 0.3, 0.36, Btn.Y),
      ];
  return {
    name: sixButton ? 'Mega Drive 6 (horizontal)' : 'Mega Drive 3 (horizontal)',
    clusters: sideClusters({
      leftTriggers: [],
      rightTriggers: [],
      face,
      start: footBtn('START', Btn.START),
      eightWay: true,
    }),
  };
}

export const PS1_LANDSCAPE_LAYOUT: PadLayout = {
  name: 'PlayStation (horizontal)',
  clusters: sideClusters({
    leftTriggers: [trig('L2', 0.04, 0.44, Btn.L2, GRAY), trig('L1', 0.52, 0.44, Btn.L, GRAY)],
    rightTriggers: [trig('R1', 0.04, 0.44, Btn.R, GRAY), trig('R2', 0.52, 0.44, Btn.R2, GRAY)],
    face: [
      circle('△', 0.5, 0.2, 0.34, Btn.X, '#4ade80'),
      circle('□', 0.2, 0.5, 0.34, Btn.Y, '#f0abfc'),
      circle('○', 0.8, 0.5, 0.34, Btn.A, '#f87171'),
      circle('✕', 0.5, 0.8, 0.34, Btn.B, '#60a5fa'),
    ],
    select: footBtn('SELECT', Btn.SELECT),
    start: footBtn('START', Btn.START),
    eightWay: false,
  }),
};

// ---- Nintendo DS (melonDS / DeSmuME) --------------------------------------
// Rombo A (derecha), B (abajo), X (arriba), Y (izquierda), como en la consola. La pantalla
// táctil se maneja tocando directamente la imagen inferior (puntero), no con el pad.
const ndsFace = (d: number): Zone[] => [
  circle('X', 0.5, 0.2, d, Btn.X),
  circle('Y', 0.2, 0.5, d, Btn.Y),
  circle('A', 0.8, 0.5, d, Btn.A),
  circle('B', 0.5, 0.8, d, Btn.B),
];

export const NDS_LAYOUT: PadLayout = {
  name: 'Nintendo DS',
  clusters: [
    {
      id: 'shoulders', x: 0, y: 0, w: 1, h: 0.16,
      zones: [rect('L', 0.02, 0.1, 0.3, 0.8, Btn.L), rect('R', 0.68, 0.1, 0.3, 0.8, Btn.R)],
    },
    {
      id: 'dpad', x: 0, y: 0.2, w: 0.42, h: 0.8,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: false }],
    },
    { id: 'face', x: 0.58, y: 0.2, w: 0.42, h: 0.8, zones: ndsFace(0.3) },
    {
      id: 'menu', x: 0.42, y: 0.5, w: 0.16, h: 0.5,
      zones: [rect('SEL', 0, 0.2, 1, 0.25, Btn.SELECT), rect('START', 0, 0.6, 1, 0.25, Btn.START)],
    },
  ],
};

export const NDS_LANDSCAPE_LAYOUT: PadLayout = {
  name: 'Nintendo DS (horizontal)',
  clusters: sideClusters({
    leftTriggers: [trig('L', 0.06, 0.88, Btn.L)],
    rightTriggers: [trig('R', 0.06, 0.88, Btn.R)],
    face: ndsFace(0.34),
    select: footBtn('SELECT', Btn.SELECT),
    start: footBtn('START', Btn.START),
    eightWay: false,
  }),
};

// ---- Super Nintendo (Snes9x) ------------------------------------------------
// Rombo como en el mando de Super Famicom: X azul arriba, Y verde izquierda, A roja derecha,
// B amarilla abajo. Snes9x usa los mismos bits libretro (A=A, B=B, X=X, Y=Y).
const snesFace = (d: number): Zone[] => [
  circle('X', 0.5, 0.2, d, Btn.X, '#3b82f6'),
  circle('Y', 0.2, 0.5, d, Btn.Y, '#22c55e'),
  circle('A', 0.8, 0.5, d, Btn.A, '#ef4444'),
  circle('B', 0.5, 0.8, d, Btn.B, '#facc15'),
];

export const SNES_LAYOUT: PadLayout = {
  name: 'Super Nintendo',
  clusters: [
    {
      id: 'shoulders', x: 0, y: 0, w: 1, h: 0.16,
      zones: [rect('L', 0.02, 0.1, 0.3, 0.8, Btn.L, GRAY), rect('R', 0.68, 0.1, 0.3, 0.8, Btn.R, GRAY)],
    },
    {
      id: 'dpad', x: 0, y: 0.2, w: 0.42, h: 0.8,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: true }],
    },
    { id: 'face', x: 0.58, y: 0.2, w: 0.42, h: 0.8, zones: snesFace(0.3) },
    {
      id: 'menu', x: 0.42, y: 0.5, w: 0.16, h: 0.5,
      zones: [rect('SELECT', 0, 0.2, 1, 0.25, Btn.SELECT), rect('START', 0, 0.6, 1, 0.25, Btn.START)],
    },
  ],
};

export const SNES_LANDSCAPE_LAYOUT: PadLayout = {
  name: 'Super Nintendo (horizontal)',
  clusters: sideClusters({
    leftTriggers: [trig('L', 0.06, 0.88, Btn.L, GRAY)],
    rightTriggers: [trig('R', 0.06, 0.88, Btn.R, GRAY)],
    face: snesFace(0.34),
    select: footBtn('SELECT', Btn.SELECT),
    start: footBtn('START', Btn.START),
    eightWay: true,
  }),
};

// ---- NES (FCEUmm) y Game Boy / Color (Gambatte) ------------------------------
// Cruceta grande, B y A en diagonal, SELECT y START. Ambos núcleos: B=JOYPAD_B, A=JOYPAD_A.
function twoButtonLayout(name: string, tint: string): PadLayout {
  return {
    name,
    clusters: [
      {
        id: 'dpad', x: 0, y: 0.08, w: 0.46, h: 0.92,
        zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.48, eightWay: true }],
      },
      {
        id: 'face', x: 0.54, y: 0.12, w: 0.46, h: 0.88,
        zones: [circle('B', 0.28, 0.62, 0.36, Btn.B, tint), circle('A', 0.72, 0.38, 0.36, Btn.A, tint)],
      },
      {
        id: 'menu', x: 0.46, y: 0.5, w: 0.08, h: 0.5,
        zones: [rect('SEL', 0, 0.2, 1, 0.25, Btn.SELECT), rect('START', 0, 0.6, 1, 0.25, Btn.START)],
      },
    ],
  };
}

function twoButtonLandscape(name: string, tint: string): PadLayout {
  return {
    name,
    clusters: sideClusters({
      leftTriggers: [],
      rightTriggers: [],
      face: [circle('B', 0.28, 0.62, 0.44, Btn.B, tint), circle('A', 0.72, 0.38, 0.44, Btn.A, tint)],
      select: footBtn('SELECT', Btn.SELECT),
      start: footBtn('START', Btn.START),
      eightWay: true,
    }),
  };
}

export const NES_LAYOUT = twoButtonLayout('NES', '#dc2626');
export const NES_LANDSCAPE_LAYOUT = twoButtonLandscape('NES (horizontal)', '#dc2626');
export const GB_LAYOUT = twoButtonLayout('Game Boy', '#9d174d');
export const GB_LANDSCAPE_LAYOUT = twoButtonLandscape('Game Boy (horizontal)', '#9d174d');

// ---- Sega Saturn (Yabause) -------------------------------------------------
// Mapeo del core (yabause/src/libretro/libretro.c): A<-B, B<-A, C<-R, X<-Y, Y<-X, Z<-L,
// gatillos L/R <- L2/R2.
const saturnFace = (d: number, top: number, bottom: number): Zone[] => [
  circle('X', 0.18, top + 0.06, d, Btn.Y),
  circle('Y', 0.5, top, d, Btn.X),
  circle('Z', 0.82, top - 0.06, d, Btn.L),
  circle('A', 0.18, bottom + 0.06, d, Btn.B),
  circle('B', 0.5, bottom, d, Btn.A),
  circle('C', 0.82, bottom - 0.06, d, Btn.R),
];

export const SATURN_LAYOUT: PadLayout = {
  name: 'Sega Saturn',
  clusters: [
    {
      id: 'shoulders', x: 0, y: 0, w: 1, h: 0.16,
      zones: [rect('L', 0.02, 0.1, 0.3, 0.8, Btn.L2, GRAY), rect('R', 0.68, 0.1, 0.3, 0.8, Btn.R2, GRAY)],
    },
    {
      id: 'dpad', x: 0, y: 0.22, w: 0.4, h: 0.78,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: true }],
    },
    {
      id: 'start', x: 0.4, y: 0.6, w: 0.18, h: 0.4,
      zones: [circle('START', 0.5, 0.4, 0.6, Btn.START)],
    },
    { id: 'face', x: 0.56, y: 0.2, w: 0.44, h: 0.8, zones: saturnFace(0.28, 0.3, 0.7) },
  ],
};

export const SATURN_LANDSCAPE_LAYOUT: PadLayout = {
  name: 'Sega Saturn (horizontal)',
  clusters: sideClusters({
    leftTriggers: [trig('L', 0.06, 0.88, Btn.L2, GRAY)],
    rightTriggers: [trig('R', 0.06, 0.88, Btn.R2, GRAY)],
    face: saturnFace(0.3, 0.28, 0.68),
    start: footBtn('START', Btn.START),
    eightWay: true,
  }),
};

// ---- FinalBurn Neo ---------------------------------------------------------
// Seis botones A-F con el mapeo estándar de FBNeo: Neo-Geo A/B/C/D = A/B/C/D; en placas de
// 6 botones (CPS-1/2/3) fila superior C/D/E = puñetazos y fila inferior A/B/F = patadas.
// COIN = SELECT. Stick arcade (cruceta digital de 8 direcciones) por defecto.
const fbneoFace = (d: number, top: number, bottom: number): Zone[] => [
  circle('C', 0.18, top + 0.06, d, Btn.Y, '#f0abfc'),
  circle('D', 0.5, top, d, Btn.X, '#60a5fa'),
  circle('E', 0.82, top - 0.06, d, Btn.L),
  circle('A', 0.18, bottom + 0.06, d, Btn.B, '#f87171'),
  circle('B', 0.5, bottom, d, Btn.A, '#facc15'),
  circle('F', 0.82, bottom - 0.06, d, Btn.R),
];

export const FBNEO_LAYOUT: PadLayout = {
  name: 'FinalBurn Neo',
  clusters: [
    {
      id: 'menu', x: 0.3, y: 0, w: 0.4, h: 0.16,
      zones: [rect('COIN', 0.02, 0.15, 0.46, 0.7, Btn.SELECT), rect('START', 0.52, 0.15, 0.46, 0.7, Btn.START)],
    },
    {
      id: 'dpad', x: 0, y: 0.2, w: 0.42, h: 0.8,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: true }],
    },
    { id: 'face', x: 0.5, y: 0.2, w: 0.5, h: 0.8, zones: fbneoFace(0.27, 0.3, 0.7) },
  ],
};

export const FBNEO_LANDSCAPE_LAYOUT: PadLayout = {
  name: 'FinalBurn Neo (horizontal)',
  clusters: sideClusters({
    leftTriggers: [],
    rightTriggers: [],
    face: fbneoFace(0.3, 0.28, 0.68),
    select: footBtn('COIN', Btn.SELECT),
    start: footBtn('START', Btn.START),
    eightWay: true,
  }),
};

// ---- PSP (PPSSPP) ------------------------------------------------------------
// Mapeo del core (libretro/libretro.cpp): Círculo=A, Cruz=B, Triángulo=X, Cuadrado=Y, L/R.
// Cruceta arriba y nub analógico debajo, como en la consola.
const pspFace = (d: number): Zone[] => [
  circle('△', 0.5, 0.2, d, Btn.X, '#4ade80'),
  circle('□', 0.2, 0.5, d, Btn.Y, '#f0abfc'),
  circle('○', 0.8, 0.5, d, Btn.A, '#f87171'),
  circle('✕', 0.5, 0.8, d, Btn.B, '#60a5fa'),
];

export const PSP_LAYOUT: PadLayout = {
  name: 'PSP',
  clusters: [
    {
      id: 'shoulders', x: 0, y: 0, w: 1, h: 0.14,
      zones: [rect('L', 0.02, 0.1, 0.3, 0.8, Btn.L, GRAY), rect('R', 0.68, 0.1, 0.3, 0.8, Btn.R, GRAY)],
    },
    {
      id: 'dpad', x: 0, y: 0.17, w: 0.38, h: 0.45,
      zones: [{ kind: 'dpad', cx: 0.5, cy: 0.5, r: 0.46, eightWay: false }],
    },
    {
      id: 'stick', x: 0.02, y: 0.62, w: 0.34, h: 0.38,
      zones: [{ kind: 'stick', cx: 0.5, cy: 0.5, r: 0.44 }],
    },
    {
      id: 'center', x: 0.38, y: 0.62, w: 0.24, h: 0.38,
      zones: [rect('SELECT', 0, 0.15, 1, 0.28, Btn.SELECT), rect('START', 0, 0.6, 1, 0.28, Btn.START)],
    },
    { id: 'face', x: 0.6, y: 0.17, w: 0.4, h: 0.62, zones: pspFace(0.32) },
  ],
};

export const PSP_LANDSCAPE_LAYOUT: PadLayout = {
  name: 'PSP (horizontal)',
  clusters: [
    ...sideClusters({
      leftTriggers: [trig('L', 0.06, 0.88, Btn.L, GRAY)],
      rightTriggers: [trig('R', 0.06, 0.88, Btn.R, GRAY)],
      face: pspFace(0.34),
      select: footBtn('SELECT', Btn.SELECT),
      start: footBtn('START', Btn.START),
      eightWay: false,
    }),
    // Nub analógico: comparte columna con la cruceta (withDirMode reparte el alto)
    {
      id: 'stick', x: 0, y: BODY_Y, w: SIDE_W, h: BODY_H,
      zones: [{ kind: 'stick', cx: 0.5, cy: 0.5, r: 0.46 }],
    },
  ],
};

export type DirMode = 'stick' | 'dpad' | 'both';

/** Modo direccional por defecto: stick en N64 (analógico real), cruceta en el resto. */
export function defaultDirMode(core: CoreId): DirMode {
  if (core === 'mupen64') return 'stick';
  if (core === 'fbneo') return 'stick'; // stick arcade
  if (core === 'ppsspp') return 'both'; // cruceta + nub analógico
  return 'dpad';
}

function overlapRatio(a: Cluster, b: Cluster): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

/**
 * Aplica el modo direccional a cualquier consola:
 *  - 'stick': solo stick (en consolas sin analógico se sintetiza sobre la cruceta y emite
 *    direcciones de cruceta)
 *  - 'dpad': solo cruceta
 *  - 'both': ambos; si ocupan el mismo sitio se reparte el área (stick arriba, cruceta abajo)
 */
export function withDirMode(layout: PadLayout, mode: DirMode): PadLayout {
  const dpad = layout.clusters.find((c) => c.id === 'dpad');
  let stick = layout.clusters.find((c) => c.id === 'stick');
  if (!dpad && !stick) return layout;
  const others = layout.clusters.filter((c) => c.id !== 'dpad' && c.id !== 'stick');
  if (!stick && dpad) {
    stick = { ...dpad, id: 'stick', zones: [{ kind: 'stick', cx: 0.5, cy: 0.5, r: 0.46, toDpad: true }] };
  }
  if (mode === 'stick' && stick) return { ...layout, clusters: [...others, stick] };
  if (mode === 'dpad' && dpad) return { ...layout, clusters: [...others, dpad] };
  if (!stick || !dpad) return layout;
  if (overlapRatio(stick, dpad) < 0.5) return { ...layout, clusters: [...others, stick, dpad] };
  const half = dpad.h / 2;
  return {
    ...layout,
    clusters: [
      ...others,
      { ...stick, x: dpad.x, y: dpad.y, w: dpad.w, h: half },
      { ...dpad, y: dpad.y + half, h: half },
    ],
  };
}

export function layoutFor(core: CoreId, genesisSixButton: boolean, landscape = false): PadLayout {
  if (landscape) {
    switch (core) {
      case 'mupen64':
        return N64_LANDSCAPE_LAYOUT;
      case 'genesis':
        return genesisLandscape(genesisSixButton);
      case 'pcsx':
        return PS1_LANDSCAPE_LAYOUT;
      case 'mgba':
      case 'mame':
        return GBA_LANDSCAPE_LAYOUT;
      case 'melonds':
      case 'desmume':
        return NDS_LANDSCAPE_LAYOUT;
      case 'yabause':
        return SATURN_LANDSCAPE_LAYOUT;
      case 'fbneo':
        return FBNEO_LANDSCAPE_LAYOUT;
      case 'ppsspp':
        return PSP_LANDSCAPE_LAYOUT;
      case 'snes9x':
        return SNES_LANDSCAPE_LAYOUT;
      case 'fceumm':
        return NES_LANDSCAPE_LAYOUT;
      case 'gambatte':
        return GB_LANDSCAPE_LAYOUT;
    }
  }
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
    case 'pcsx':
      return PS1_LAYOUT;
    case 'melonds':
    case 'desmume':
      return NDS_LAYOUT;
    case 'yabause':
      return SATURN_LAYOUT;
    case 'fbneo':
      return FBNEO_LAYOUT;
    case 'ppsspp':
      return PSP_LAYOUT;
    case 'snes9x':
      return SNES_LAYOUT;
    case 'fceumm':
      return NES_LAYOUT;
    case 'gambatte':
      return GB_LAYOUT;
  }
}
