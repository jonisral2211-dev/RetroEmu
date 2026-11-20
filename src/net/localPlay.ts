import { Libretro } from 'react-native-libretro';

// Multijugador en red local (Wi-Fi / QR): el iPhone anfitrión sirve el mando para P2, P3 y P4.
export type LocalSeat = { slot: number; connected: boolean; stream: boolean };

/** Arranca el servidor de jugadores. Devuelve la URL para abrir en el teléfono, o '' si falla. */
export function localPlayStart(): string {
  try {
    return Libretro.localPlayStart();
  } catch {
    return '';
  }
}

export function localPlayStop(): void {
  try {
    Libretro.localPlayStop();
  } catch {
    // sin servidor activo
  }
}

export function localPlaySeats(): LocalSeat[] {
  try {
    return (JSON.parse(Libretro.localPlayStatus()) as { seats: LocalSeat[] }).seats;
  } catch {
    return [];
  }
}
