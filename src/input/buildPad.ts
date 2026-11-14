import type { Cluster, PadLayout, Zone } from './layouts';
import type { PadPrefs } from './padPrefs';

// Convierte un layout de grupos (cluster = varios botones) en un pad de botones sueltos: cada
// botón, la cruceta y el stick pasan a ser su propio cluster, con su id, su posición y su tamaño.
// Así se pueden mover y redimensionar uno por uno. Necesita el tamaño real del pad en px porque
// los botones redondos se miden respecto al lado menor de su grupo.

/** Margen del stick y la cruceta: el cluster es 1,5 veces el dibujo para no perder el dedo. */
const ANALOG_PAD = 1.5;

type PxBox = { id: string; group: string; cx: number; cy: number; w: number; h: number; vis: number; zone: Zone };

/** Id estable de cada control: "dpad", "stick" o "<grupo>:<etiqueta>". */
export function controlId(group: string, zone: Zone): string {
  if (zone.kind === 'dpad') return 'dpad';
  if (zone.kind === 'stick') return 'stick';
  return `${group}:${zone.label}`;
}

/** Grupo de un id de control (para heredar los desplazamientos guardados por grupo). */
export function groupOf(id: string): string {
  const i = id.indexOf(':');
  return i >= 0 ? id.slice(0, i) : id;
}

function explode(layout: PadLayout, W: number, H: number): { boxes: PxBox[]; groupCenter: Map<string, { x: number; y: number }> } {
  const boxes: PxBox[] = [];
  const groupCenter = new Map<string, { x: number; y: number }>();
  for (const c of layout.clusters) {
    const ox = c.x * W;
    const oy = c.y * H;
    const cw = c.w * W;
    const ch = c.h * H;
    const m = Math.min(cw, ch);
    groupCenter.set(c.id, { x: ox + cw / 2, y: oy + ch / 2 });
    for (const z of c.zones) {
      const id = controlId(c.id, z);
      if (z.kind === 'button') {
        if (z.shape === 'rect') {
          boxes.push({
            id, group: c.id, vis: 1,
            cx: ox + (z.x + z.w / 2) * cw, cy: oy + (z.y + z.h / 2) * ch, w: z.w * cw, h: z.h * ch,
            zone: { ...z, x: 0, y: 0, w: 1, h: 1 },
          });
        } else {
          const d = z.w * m;
          boxes.push({
            id, group: c.id, vis: 1,
            cx: ox + z.x * cw, cy: oy + z.y * ch, w: d, h: d,
            zone: { ...z, x: 0.5, y: 0.5, w: 1, h: 1 },
          });
        }
      } else {
        const side = 2 * z.r * m * ANALOG_PAD;
        boxes.push({
          id, group: c.id, vis: 1 / ANALOG_PAD,
          cx: ox + z.cx * cw, cy: oy + z.cy * ch, w: side, h: side,
          zone: { ...z, cx: 0.5, cy: 0.5, r: 0.5 / ANALOG_PAD },
        });
      }
    }
  }
  return { boxes, groupCenter };
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/**
 * Pad final en coordenadas normalizadas: un cluster por control, con el tamaño global
 * (escala también la separación dentro de cada grupo, como antes), el tamaño individual y el
 * desplazamiento de cada botón. El dibujo nunca se sale de la pantalla.
 */
export function buildPad(layout: PadLayout, prefs: PadPrefs, W: number, H: number): PadLayout {
  if (W <= 0 || H <= 0) return { ...layout, clusters: [] };
  const { boxes, groupCenter } = explode(layout, W, H);
  const clusters: Cluster[] = boxes.map((b) => {
    const g = groupCenter.get(b.group) ?? { x: b.cx, y: b.cy };
    const s = prefs.scale;
    const own = prefs.sizes?.[b.id] ?? 1;
    const off = prefs.offsets[b.id] ?? prefs.offsets[b.group] ?? { dx: 0, dy: 0 };
    let cx = g.x + (b.cx - g.x) * s + off.dx * W;
    let cy = g.y + (b.cy - g.y) * s + off.dy * H;
    const w = b.w * s * own;
    const h = b.h * s * own;
    // Lo visible (sin el margen del stick) dentro del pad
    cx = clamp(cx, (w * b.vis) / 2, W - (w * b.vis) / 2);
    cy = clamp(cy, (h * b.vis) / 2, H - (h * b.vis) / 2);
    return {
      id: b.id,
      group: b.group,
      vis: b.vis,
      x: (cx - w / 2) / W,
      y: (cy - h / 2) / H,
      w: w / W,
      h: h / H,
      zones: [b.zone],
    };
  });
  return { ...layout, clusters };
}

/** Etiqueta legible de un control (para el panel de edición). */
export function controlLabel(id: string): string {
  if (id === 'dpad') return 'Cruceta';
  if (id === 'stick') return 'Stick analógico';
  return id.slice(id.indexOf(':') + 1);
}
