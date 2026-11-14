import { Btn } from '../emulator/buttons';
import type { CoreId } from '../emulator/cores';
import { circle, PadLayout, rect, Zone } from './layouts';

// Modo TV sin mandos físicos: el iPhone entero es el mando (no se ve el juego en el teléfono).
// Diseños a pantalla completa en horizontal, con la disposición y colores de cada consola.
// `trackpad` (NDS) es la zona central que hace de lápiz sobre la pantalla inferior de la DS.

export type TvPad = { layout: PadLayout; accent: string; title: string; trackpad?: { x: number; y: number; w: number; h: number } };

const GRAY = '#8a8f98';
const PS = { tri: '#22c55e', cir: '#ef4444', cross: '#3b82f6', sq: '#ec4899' };

const dpad = (x: number, y: number, w: number, h: number, eightWay = false) => ({
  id: 'dpad', x, y, w, h,
  zones: [{ kind: 'dpad' as const, cx: 0.5, cy: 0.5, r: 0.46, eightWay }],
});
const stick = (x: number, y: number, w: number, h: number, toDpad = false) => ({
  id: 'stick', x, y, w, h,
  zones: [{ kind: 'stick' as const, cx: 0.5, cy: 0.5, r: 0.46, toDpad }],
});
const diamond = (top: [string, number, string?], left: [string, number, string?], right: [string, number, string?], bottom: [string, number, string?], d = 0.36): Zone[] => [
  circle(top[0], 0.5, 0.18, d, top[1], top[2]),
  circle(left[0], 0.18, 0.5, d, left[1], left[2]),
  circle(right[0], 0.82, 0.5, d, right[1], right[2]),
  circle(bottom[0], 0.5, 0.82, d, bottom[1], bottom[2]),
];
const pair = (id: string, x: number, w: number, a: [string, number, string?], b: [string, number, string?]) => ({
  id, x, y: 0, w, h: 0.15,
  zones: [rect(a[0], 0.03, 0.12, 0.45, 0.76, a[1], a[2]), rect(b[0], 0.52, 0.12, 0.45, 0.76, b[1], b[2])],
});
const single = (id: string, x: number, w: number, a: [string, number, string?]) => ({
  id, x, y: 0, w, h: 0.15,
  zones: [rect(a[0], 0.04, 0.12, 0.92, 0.76, a[1], a[2])],
});
const menu = (id: string, x: number, y: number, w: number, a: [string, number], b?: [string, number]) => ({
  id, x, y, w, h: 0.12,
  zones: b
    ? [rect(a[0], 0.02, 0.1, 0.46, 0.8, a[1]), rect(b[0], 0.52, 0.1, 0.46, 0.8, b[1])]
    : [rect(a[0], 0.1, 0.1, 0.8, 0.8, a[1])],
});

function playStation(name: string): TvPad {
  return {
    title: name,
    accent: '#3B82F6',
    layout: {
      name: `${name} (TV)`,
      clusters: [
        pair('trig-left', 0, 0.3, ['L2', Btn.L2, GRAY], ['L1', Btn.L, GRAY]),
        pair('trig-right', 0.7, 0.3, ['R1', Btn.R, GRAY], ['R2', Btn.R2, GRAY]),
        dpad(0.02, 0.19, 0.28, 0.45),
        stick(0.22, 0.58, 0.24, 0.42),
        menu('center', 0.37, 0.24, 0.26, ['SELECT', Btn.SELECT], ['START', Btn.START]),
        {
          id: 'face', x: 0.66, y: 0.17, w: 0.34, h: 0.62,
          zones: diamond(['△', Btn.X, PS.tri], ['□', Btn.Y, PS.sq], ['○', Btn.A, PS.cir], ['✕', Btn.B, PS.cross]),
        },
      ],
    },
  };
}

const N64: TvPad = {
  title: 'Nintendo 64',
  accent: '#22C55E',
  layout: {
    name: 'Nintendo 64 (TV)',
    clusters: [
      pair('trig-left', 0, 0.3, ['L', Btn.SELECT, GRAY], ['Z', Btn.L2, GRAY]),
      single('trig-right', 0.7, 0.3, ['R', Btn.R2, GRAY]),
      dpad(0.01, 0.17, 0.2, 0.33),
      // Stick central de alta precisión
      stick(0.18, 0.36, 0.3, 0.64),
      menu('start', 0.44, 0.19, 0.12, ['START', Btn.START]),
      {
        id: 'cbuttons', x: 0.54, y: 0.34, w: 0.2, h: 0.5,
        zones: diamond(['C▲', Btn.X, '#facc15'], ['C◀', Btn.L, '#facc15'], ['C▶', Btn.R, '#facc15'], ['C▼', Btn.A, '#facc15'], 0.34),
      },
      {
        id: 'face', x: 0.74, y: 0.3, w: 0.26, h: 0.62,
        zones: [circle('A', 0.62, 0.62, 0.5, Btn.B, '#3b82f6'), circle('B', 0.32, 0.3, 0.42, Btn.Y, '#22c55e')],
      },
    ],
  },
};

// Saturn: A<-B, B<-A, C<-R, X<-Y, Y<-X, Z<-L, L/R <- L2/R2. Mega Drive: A=B, B=A, C=Y, X=X, Y=L, Z=R
function sega(saturn: boolean): TvPad {
  const m = saturn
    ? { A: Btn.B, B: Btn.A, C: Btn.R, X: Btn.Y, Y: Btn.X, Z: Btn.L }
    : { A: Btn.B, B: Btn.A, C: Btn.Y, X: Btn.X, Y: Btn.L, Z: Btn.R };
  const d = 0.27;
  const face: Zone[] = [
    circle('X', 0.18, 0.3, d, m.X), circle('Y', 0.5, 0.24, d, m.Y), circle('Z', 0.82, 0.18, d, m.Z),
    circle('A', 0.18, 0.72, d, m.A, '#ef4444'), circle('B', 0.5, 0.66, d, m.B, '#facc15'), circle('C', 0.82, 0.6, d, m.C, '#22c55e'),
  ];
  return {
    title: saturn ? 'Sega Saturn' : 'Mega Drive',
    accent: saturn ? '#A855F7' : '#F43F5E',
    layout: {
      name: saturn ? 'Saturn (TV)' : 'Mega Drive (TV)',
      clusters: [
        ...(saturn ? [single('trig-left', 0, 0.3, ['L', Btn.L2, GRAY]), single('trig-right', 0.7, 0.3, ['R', Btn.R2, GRAY])] : []),
        dpad(0.02, 0.2, 0.36, 0.72, true),
        menu('start', 0.42, 0.78, 0.16, ['START', Btn.START]),
        { id: 'face', x: 0.56, y: 0.22, w: 0.44, h: 0.66, zones: face },
      ],
    },
  };
}

// Arcade: palanca grande y 6 botones como en la recreativa (A-F de FBNeo; MAME usa los mismos bits)
const ARCADE: TvPad = {
  title: 'Arcade',
  accent: '#F97316',
  layout: {
    name: 'Arcade (TV)',
    clusters: [
      menu('menu', 0.34, 0.02, 0.32, ['COIN', Btn.SELECT], ['START', Btn.START]),
      stick(0.02, 0.14, 0.4, 0.84, true),
      {
        id: 'face', x: 0.5, y: 0.26, w: 0.5, h: 0.66,
        zones: [
          circle('C', 0.18, 0.34, 0.27, Btn.Y, '#f0abfc'), circle('D', 0.5, 0.28, 0.27, Btn.X, '#60a5fa'), circle('E', 0.82, 0.22, 0.27, Btn.L),
          circle('A', 0.18, 0.76, 0.27, Btn.B, '#f87171'), circle('B', 0.5, 0.7, 0.27, Btn.A, '#facc15'), circle('F', 0.82, 0.64, 0.27, Btn.R),
        ],
      },
    ],
  },
};

const GBA: TvPad = {
  title: 'Game Boy Advance',
  accent: '#6366F1',
  layout: {
    name: 'GBA (TV)',
    clusters: [
      single('trig-left', 0, 0.3, ['L', Btn.L]),
      single('trig-right', 0.7, 0.3, ['R', Btn.R]),
      dpad(0.02, 0.2, 0.36, 0.72),
      menu('menu', 0.36, 0.82, 0.28, ['SELECT', Btn.SELECT], ['START', Btn.START]),
      { id: 'face', x: 0.62, y: 0.22, w: 0.38, h: 0.66, zones: [circle('B', 0.3, 0.64, 0.38, Btn.B), circle('A', 0.72, 0.36, 0.38, Btn.A)] },
    ],
  },
};

// NDS: trackpad central = pantalla táctil inferior
const NDS: TvPad = {
  title: 'Nintendo DS',
  accent: '#38BDF8',
  trackpad: { x: 0.31, y: 0.17, w: 0.38, h: 0.62 },
  layout: {
    name: 'NDS (TV)',
    clusters: [
      single('trig-left', 0, 0.28, ['L', Btn.L]),
      single('trig-right', 0.72, 0.28, ['R', Btn.R]),
      dpad(0.01, 0.22, 0.29, 0.6),
      menu('menu', 0.36, 0.84, 0.28, ['SELECT', Btn.SELECT], ['START', Btn.START]),
      {
        id: 'face', x: 0.7, y: 0.2, w: 0.3, h: 0.62,
        zones: diamond(['X', Btn.X], ['Y', Btn.Y], ['A', Btn.A], ['B', Btn.B], 0.34),
      },
    ],
  },
};

// ---- Modo control vertical (iPhone bloqueado en vertical mientras el vídeo sale por la TV) ----
// La franja superior (0-10 %) queda libre para el título y el engranaje.
const vPair = (id: string, x: number, y: number, w: number, h: number, a: [string, number, string?], b: [string, number, string?]) => ({
  id, x, y, w, h,
  zones: [rect(a[0], 0.03, 0.08, 0.45, 0.84, a[1], a[2]), rect(b[0], 0.52, 0.08, 0.45, 0.84, b[1], b[2])],
});
const vSingle = (id: string, x: number, y: number, w: number, h: number, a: [string, number, string?]) => ({
  id, x, y, w, h,
  zones: [rect(a[0], 0.05, 0.08, 0.9, 0.84, a[1], a[2])],
});

function playStationV(name: string): TvPad {
  return {
    title: name,
    accent: '#3B82F6',
    layout: {
      name: `${name} (vertical)`,
      clusters: [
        vPair('trig-left', 0, 0.11, 0.48, 0.09, ['L2', Btn.L2, GRAY], ['L1', Btn.L, GRAY]),
        vPair('trig-right', 0.52, 0.11, 0.48, 0.09, ['R1', Btn.R, GRAY], ['R2', Btn.R2, GRAY]),
        vPair('center', 0.24, 0.23, 0.52, 0.07, ['SELECT', Btn.SELECT], ['START', Btn.START]),
        dpad(0, 0.34, 0.5, 0.3),
        stick(0.03, 0.66, 0.47, 0.32),
        {
          id: 'face', x: 0.5, y: 0.4, w: 0.5, h: 0.44,
          zones: diamond(['△', Btn.X, PS.tri], ['□', Btn.Y, PS.sq], ['○', Btn.A, PS.cir], ['✕', Btn.B, PS.cross], 0.4),
        },
      ],
    },
  };
}

const N64_V: TvPad = {
  title: 'Nintendo 64',
  accent: '#22C55E',
  layout: {
    name: 'Nintendo 64 (vertical)',
    clusters: [
      vPair('trig-left', 0, 0.11, 0.48, 0.09, ['L', Btn.SELECT, GRAY], ['Z', Btn.L2, GRAY]),
      vSingle('trig-right', 0.52, 0.11, 0.48, 0.09, ['R', Btn.R2, GRAY]),
      dpad(0, 0.23, 0.36, 0.2),
      vSingle('start', 0.38, 0.27, 0.22, 0.07, ['START', Btn.START, '#ef4444']),
      {
        id: 'cbuttons', x: 0.6, y: 0.22, w: 0.4, h: 0.26,
        zones: diamond(['C▲', Btn.X, '#facc15'], ['C◀', Btn.L, '#facc15'], ['C▶', Btn.R, '#facc15'], ['C▼', Btn.A, '#facc15'], 0.36),
      },
      // Stick principal grande, abajo a la izquierda (donde cae el pulgar)
      stick(0, 0.5, 0.56, 0.48),
      {
        id: 'face', x: 0.56, y: 0.55, w: 0.44, h: 0.36,
        zones: [circle('A', 0.62, 0.62, 0.5, Btn.B, '#3b82f6'), circle('B', 0.3, 0.3, 0.42, Btn.Y, '#22c55e')],
      },
    ],
  },
};

// Fightstick vertical: palanca grande con anillo a la izquierda, 6 botones en arco a la derecha
const ARCADE_V: TvPad = {
  title: 'Arcade',
  accent: '#F97316',
  layout: {
    name: 'Arcade (vertical)',
    clusters: [
      vPair('menu', 0.12, 0.11, 0.76, 0.08, ['COIN', Btn.SELECT, '#facc15'], ['START', Btn.START]),
      stick(0, 0.24, 0.52, 0.72, true),
      {
        id: 'face', x: 0.5, y: 0.24, w: 0.5, h: 0.72,
        zones: [
          circle('A', 0.3, 0.22, 0.4, Btn.B, '#f87171'), circle('B', 0.74, 0.16, 0.4, Btn.A, '#facc15'),
          circle('C', 0.3, 0.5, 0.4, Btn.Y, '#f0abfc'), circle('D', 0.74, 0.44, 0.4, Btn.X, '#60a5fa'),
          circle('E', 0.3, 0.78, 0.34, Btn.L), circle('F', 0.74, 0.72, 0.34, Btn.R),
        ],
      },
    ],
  },
};

const GBA_V: TvPad = {
  title: 'Game Boy Advance',
  accent: '#6366F1',
  layout: {
    name: 'GBA (vertical)',
    clusters: [
      vSingle('trig-left', 0, 0.11, 0.46, 0.09, ['L', Btn.L]),
      vSingle('trig-right', 0.54, 0.11, 0.46, 0.09, ['R', Btn.R]),
      dpad(0, 0.3, 0.5, 0.4),
      { id: 'face', x: 0.5, y: 0.3, w: 0.5, h: 0.4, zones: [circle('B', 0.3, 0.64, 0.42, Btn.B), circle('A', 0.72, 0.36, 0.42, Btn.A)] },
      vPair('menu', 0.2, 0.8, 0.6, 0.08, ['SELECT', Btn.SELECT], ['START', Btn.START]),
    ],
  },
};

function segaV(saturn: boolean): TvPad {
  const m = saturn
    ? { A: Btn.B, B: Btn.A, C: Btn.R, X: Btn.Y, Y: Btn.X, Z: Btn.L }
    : { A: Btn.B, B: Btn.A, C: Btn.Y, X: Btn.X, Y: Btn.L, Z: Btn.R };
  const d = 0.3;
  return {
    title: saturn ? 'Sega Saturn' : 'Mega Drive',
    accent: saturn ? '#A855F7' : '#F43F5E',
    layout: {
      name: saturn ? 'Saturn (vertical)' : 'Mega Drive (vertical)',
      clusters: [
        ...(saturn
          ? [vSingle('trig-left', 0, 0.11, 0.46, 0.09, ['L', Btn.L2, GRAY]), vSingle('trig-right', 0.54, 0.11, 0.46, 0.09, ['R', Btn.R2, GRAY])]
          : []),
        dpad(0, 0.3, 0.5, 0.42, true),
        {
          id: 'face', x: 0.48, y: 0.32, w: 0.52, h: 0.38,
          zones: [
            circle('X', 0.18, 0.3, d, m.X), circle('Y', 0.5, 0.24, d, m.Y), circle('Z', 0.82, 0.18, d, m.Z),
            circle('A', 0.18, 0.74, d, m.A, '#ef4444'), circle('B', 0.5, 0.68, d, m.B, '#facc15'), circle('C', 0.82, 0.62, d, m.C, '#22c55e'),
          ],
        },
        vSingle('start', 0.34, 0.8, 0.32, 0.08, ['START', Btn.START]),
      ],
    },
  };
}

const NDS_V: TvPad = {
  title: 'Nintendo DS',
  accent: '#38BDF8',
  trackpad: { x: 0.08, y: 0.22, w: 0.84, h: 0.34 },
  layout: {
    name: 'NDS (vertical)',
    clusters: [
      vSingle('trig-left', 0, 0.11, 0.46, 0.09, ['L', Btn.L]),
      vSingle('trig-right', 0.54, 0.11, 0.46, 0.09, ['R', Btn.R]),
      dpad(0, 0.59, 0.46, 0.3),
      { id: 'face', x: 0.54, y: 0.59, w: 0.46, h: 0.3, zones: diamond(['X', Btn.X], ['Y', Btn.Y], ['A', Btn.A], ['B', Btn.B], 0.36) },
      vPair('menu', 0.2, 0.9, 0.6, 0.07, ['SELECT', Btn.SELECT], ['START', Btn.START]),
    ],
  },
};

/** Mando a pantalla completa en el iPhone mientras el vídeo sale por la TV. */
export function tvPadFor(core: CoreId, portrait = false): TvPad {
  if (portrait) {
    switch (core) {
      case 'pcsx':
        return playStationV('PlayStation');
      case 'ppsspp':
        return playStationV('PSP');
      case 'mupen64':
        return N64_V;
      case 'yabause':
        return segaV(true);
      case 'genesis':
        return segaV(false);
      case 'fbneo':
      case 'mame':
        return ARCADE_V;
      case 'melonds':
      case 'desmume':
        return NDS_V;
      case 'mgba':
        return GBA_V;
    }
  }
  return tvPadLandscape(core);
}

function tvPadLandscape(core: CoreId): TvPad {
  switch (core) {
    case 'pcsx':
      return playStation('PlayStation');
    case 'ppsspp':
      return playStation('PSP');
    case 'mupen64':
      return N64;
    case 'yabause':
      return sega(true);
    case 'genesis':
      return sega(false);
    case 'fbneo':
    case 'mame':
      return ARCADE;
    case 'melonds':
    case 'desmume':
      return NDS;
    case 'mgba':
      return GBA;
  }
}
