import { Btn } from '../emulator/buttons';

// Turbo / auto-fire: los botones de cara (A, B, X, Y) se disparan de forma continua mientras están pulsados.
export const FACE_MASK = Btn.A | Btn.B | Btn.X | Btn.Y;

let touchTurbo = false;

/** Activa o desactiva el turbo de los controles táctiles (el del mando físico lo lleva el nativo). */
export function setTouchTurbo(on: boolean): void {
  touchTurbo = on;
}

export function isTouchTurbo(): boolean {
  return touchTurbo;
}
