import { Libretro } from 'react-native-libretro';

// Clips de partida con ReplayKit: grabación manual de la pantalla del juego (con micrófono).
// La vista previa de iOS permite guardar el MP4 en Fotos o compartirlo.
export function clipsAvailable(): boolean {
  try {
    return Libretro.clipAvailable();
  } catch {
    return false;
  }
}

export function startClip(): Promise<boolean> {
  try {
    return Libretro.clipStart();
  } catch (e) {
    return Promise.reject(e);
  }
}

export function stopClip(): Promise<boolean> {
  try {
    return Libretro.clipStop();
  } catch (e) {
    return Promise.reject(e);
  }
}
