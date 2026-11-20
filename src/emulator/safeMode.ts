import { Libretro } from 'react-native-libretro';

// Modo seguro: la app se cerró durante el último arranque de un juego, así que se usan ajustes base.
export function safeModeFlag(): boolean {
  try {
    return Libretro.safeMode();
  } catch {
    return false;
  }
}
