import { Btn } from '../emulator/buttons';
import type { Zone } from './layouts';

// Cálculo puro (sin estado): los puntos llegan en px relativos al cluster.

export type Pt = { x: number; y: number };
// ax/ay = valor analógico enviado al core; kx/ky = posición visual del puck (también en toDpad)
export type Evaluation = { bits: number; ax: number; ay: number; kx: number; ky: number };

/** Respuesta táctil: sensibilidad del stick, zona muerta y área de detección de botones. */
export type Tuning = { sensitivity: number; deadzone: number; hitSlop: number };
export const DEFAULT_TUNING: Tuning = { sensitivity: 1, deadzone: 0.2, hitSlop: 1 };

/** Dirección del D-Pad a partir del vector (dx, dy) normalizado, con y hacia abajo. */
function dirBits(dx: number, dy: number, eightWay: boolean, deadzone: number): number {
  if (!eightWay) {
    // Cruz: cada eje se activa por separado, así las diagonales salen de dos ejes a la vez.
    // Con la zona muerta por defecto (20 %) el umbral por eje es el 35 % de siempre.
    const t = deadzone + 0.15;
    let b = 0;
    if (dx > t) b |= Btn.RIGHT;
    else if (dx < -t) b |= Btn.LEFT;
    if (dy > t) b |= Btn.DOWN;
    else if (dy < -t) b |= Btn.UP;
    return b;
  }
  // 8 direcciones: sector de 45° según el ángulo; zona muerta cerca del centro
  if (dx * dx + dy * dy < deadzone * deadzone) return 0;
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

/** true si el punto cae en el botón, con el área de detección ampliada o reducida. */
export function hitsButton(z: Zone, px: number, py: number, W: number, H: number, slop: number): boolean {
  if (z.kind !== 'button') return false;
  if (z.shape === 'rect') {
    const cx = (z.x + z.w / 2) * W;
    const cy = (z.y + z.h / 2) * H;
    return Math.abs(px - cx) <= (z.w * W * slop) / 2 && Math.abs(py - cy) <= (z.h * H * slop) / 2;
  }
  const m = Math.min(W, H);
  const dx = px - z.x * W;
  const dy = py - z.y * H;
  const rad = ((z.w * m) / 2) * slop;
  return dx * dx + dy * dy <= rad * rad;
}

/**
 * Evalúa todos los puntos activos de un cluster y devuelve la máscara de botones
 * y el vector del stick (si el cluster tiene uno).
 */
export function evaluateZones(zones: Zone[], pts: Pt[], W: number, H: number, tuning: Tuning = DEFAULT_TUNING): Evaluation {
  const m = Math.min(W, H);
  const dz = tuning.deadzone;
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
        if (hitsButton(z, px, py, W, H, tuning.hitSlop)) bits |= z.bits;
      } else if (z.kind === 'dpad') {
        const r = z.r * m;
        const dx = (px - z.cx * W) / r;
        const dy = (py - z.cy * H) / r;
        // Más allá del radio también cuenta (hasta 3 radios): el dedo que empezó en la cruceta puede
        // salirse del círculo sin perder la dirección
        if (dx * dx + dy * dy <= 9) bits |= dirBits(dx, dy, z.eightWay, dz);
      } else {
        const r = z.r * m;
        const dx = (px - z.cx * W) / r;
        const dy = (py - z.cy * H) / r;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= 3) {
          const k = d > 1 ? 1 / d : 1; // clamp al radio: stick con radio delimitado
          kx = dx * k;
          ky = dy * k;
          const dc = Math.min(1, d);
          if (z.toDpad) {
            // Stick sobre consola sin analógico: 8 direcciones
            if (dc > dz + 0.1) bits |= dirBits(kx, ky, true, 0);
          } else if (dc > dz) {
            // Zona muerta reescalada (sin salto al salir de ella) y sensibilidad: con 150 % se
            // llega al tope con 2/3 del recorrido; con 50 % el tope es medio stick
            const mag = Math.min(1, ((dc - dz) / (1 - dz)) * tuning.sensitivity);
            ax = (kx / dc) * mag;
            ay = (ky / dc) * mag;
          }
        }
      }
    }
  }
  return { bits, ax, ay, kx, ky };
}
