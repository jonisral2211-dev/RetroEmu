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
  return Libretro.clipStart();
}

export function stopClip(): Promise<boolean> {
  return Libretro.clipStop();
}
