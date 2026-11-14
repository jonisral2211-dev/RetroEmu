import { Btn } from '../emulator/buttons';
import type { Zone } from './layouts';

// Todo este módulo corre en el runtime de UI (worklets de Reanimated): sin llamadas async,
// sin acceso al hilo de JS. Los puntos llegan en px relativos al cluster.

export type Pt = { x: number; y: number };
// ax/ay = valor analógico enviado al core; kx/ky = posición visual del puck (también en toDpad)
export type Evaluation = { bits: number; ax: number; ay: number; kx: number; ky: number };

/** Dirección del D-Pad a partir del vector (dx, dy) normalizado, con y hacia abajo. */
function dirBits(dx: number, dy: number, eightWay: boolean): number {
  'worklet';
  if (!eightWay) {
    // Cruz: cada eje se activa por separado, así las diagonales salen de dos ejes a la vez
    const t = 0.35;
    let b = 0;
    if (dx > t) b |= Btn.RIGHT;
    else if (dx < -t) b |= Btn.LEFT;
    if (dy > t) b |= Btn.DOWN;
    else if (dy < -t) b |= Btn.UP;
    return b;
  }
  // 8 direcciones: sector de 45° según el ángulo; zona muerta cerca del centro
  if (dx * dx + dy * dy < 0.04) return 0;
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const idx = ((sector % 8) + 8) % 8;
  // 0 = derecha, 1 = abajo-derecha (y crece hacia abajo), ... siguiendo las agujas del reloj
  if (idx === 0) return Btn.RIGHT;
  if (idx === 1) return Btn.RIGHT | Btn.DOWN;
  if (idx === 2) return Btn.DOWN;
  if (idx === 3) return Btn.LEFT | Btn.DOWN;
  if (idx === 4) return Btn.LEFT;
  if (idx === 5) return Btn.LEFT | Btn.UP;
  if (idx === 6) return Btn.UP;
  return Btn.RIGHT | Btn.UP;
}

/**
 * Evalúa todos los puntos activos de un cluster y devuelve la máscara de botones
 * y el vector del stick (si el cluster tiene uno).
 */
export function evaluateZones(zones: Zone[], pts: Pt[], W: number, H: number): Evaluation {
  'worklet';
  const m = Math.min(W, H);
  let bits = 0;
  let ax = 0;
  let ay = 0;
  let kx = 0;
  let ky = 0;

  for (let i = 0; i < pts.length; i++) {
    const px = pts[i].x;
    const py = pts[i].y;
    for (let j = 0; j < zones.length; j++) {
      const z = zones[j];
      if (z.kind === 'button') {
        if (z.shape === 'rect') {
          if (px >= z.x * W && px <= (z.x + z.w) * W && py >= z.y * H && py <= (z.y + z.h) * H) {
            bits |= z.bits;
          }
        } else {
          const dx = px - z.x * W;
          const dy = py - z.y * H;
          const rad = (z.w * m) / 2;
          if (dx * dx + dy * dy <= rad * rad) bits |= z.bits;
        }
      } else if (z.kind === 'dpad') {
        const r = z.r * m;
        const dx = (px - z.cx * W) / r;
        const dy = (py - z.cy * H) / r;
        // Un poco más allá del radio para no perder la dirección al salirse del círculo
        if (dx * dx + dy * dy <= 1.44) bits |= dirBits(dx, dy, z.eightWay);
      } else {
        const r = z.r * m;
        const dx = (px - z.cx * W) / r;
        const dy = (py - z.cy * H) / r;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= 1.5) {
          const k = d > 1 ? 1 / d : 1; // clamp al radio: stick con radio delimitado
          kx = dx * k;
          ky = dy * k;
          if (z.toDpad) {
            // Stick sobre consola sin analógico: 8 direcciones con zona muerta del 30 %
            if (d > 0.3) bits |= dirBits(dx * k, dy * k, true);
          } else {
            ax = dx * k;
            ay = dy * k;
          }
        }
      }
    }
  }
  return { bits, ax, ay, kx, ky };
}
