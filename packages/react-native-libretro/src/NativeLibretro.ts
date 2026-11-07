import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** Carga un core por id: 'mgba' | 'genesis' | 'mupen64'. */
  loadCore(coreId: string): boolean;
  /** Carga una ROM (ruta absoluta) con el core activo. */
  loadGame(romPath: string): boolean;
  unloadGame(): void;
  start(): void;
  stop(): void;
  setPaused(paused: boolean): void;
  reset(): void;
  /** Máscara de botones: bit i = RETRO_DEVICE_ID_JOYPAD_i. Síncrono para baja latencia. */
  setButtons(mask: number): void;
  /** Stick analógico izquierdo, x/y en [-1, 1] (y negativo = arriba). Se escala a int16 en nativo. */
  setAnalog(x: number, y: number): void;
  saveState(slot: number): boolean;
  loadState(slot: number): boolean;
  /** Rutas absolutas de ROMs encontradas en Documents. */
  listRoms(): string[];
}

export default TurboModuleRegistry.getEnforcing<Spec>('Libretro');
