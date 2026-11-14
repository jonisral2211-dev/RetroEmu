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
  /** Consola verificada por contenido: 'gba' | 'n64' | 'sega' | 'ps1' | 'mame' (solo .zip en arcade/), o ''. */
  consoleOf(romPath: string): string;
  /**
   * Importa un archivo descargado (ruta temporal): zip -> extrae la ROM a su carpeta de consola
   * (o lo deja en arcade/ si no hay ROM); ROM suelta -> la mueve a su carpeta de consola.
   * Devuelve la ruta final, o '' si falla (motivo en lastError()). Elimina el origen si se importa.
   */
  importRom(downloadedPath: string): string;
  /** Motivo del último fallo al cargar núcleo o ROM (texto para el usuario). */
  lastError(): string;
  /** Opción de core elegida por el usuario (p. ej. resolución de PS1). Se aplica en caliente. */
  setCoreOption(key: string, value: string): void;
  /** Relación de aspecto de pantalla que declara el core (ancho/alto); 0 si aún no se conoce. */
  videoAspect(): number;
  /** Diagnóstico de entrada: lo que escribe la UI y lo que pidió el core (se reinicia al leer). */
  debugState(): string;
  /** true si hay un DualSense (PS5) conectado ahora mismo. */
  hasDualSense(): boolean;
  // Requeridos por NativeEventEmitter para el evento 'gamepadStatus'
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Libretro');
