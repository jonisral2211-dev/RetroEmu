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
  /** Stick derecho táctil (mirar/girar la cámara en Doom, Quake…), -1..1. */
  setLook(x: number, y: number): void;
  saveState(slot: number): boolean;
  loadState(slot: number): boolean;
  /** "existe|fecha ms|ruta png" de una ranura del juego cargado. */
  stateInfo(slot: number): string;
  /** Rebobina ~seconds; devuelve los segundos retrocedidos (0 = nada disponible). */
  rewind(seconds: number): number;
  /** Segundos de rebobinado disponibles; -1 = desactivado para este juego. */
  rewindAvailable(): number;
  /** JSON con los códigos de truco activos. false si el núcleo no admite trucos. */
  setCheats(codesJson: string): boolean;
  /** Shader (0 según filtro, 3 CRT, 4 LCD), suavizado 0..1, nitidez CAS 0..1, color 0/1/2. */
  setImageOptions(shader: number, smooth: number, sharpen: number, color: number): void;
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
  /** Puntero táctil (stylus de NDS): x/y en [-1, 1] sobre el frame completo del core. */
  setPointer(x: number, y: number, pressed: boolean): void;
  /** Opción de core elegida por el usuario (p. ej. resolución de PS1). Se aplica en caliente. */
  setCoreOption(key: string, value: string): void;
  /** Relación de aspecto de pantalla que declara el core (ancho/alto); 0 si aún no se conoce. */
  videoAspect(): number;
  /** Comprimidos (.zip/.7z) pendientes de descomprimir en carpetas de consola o descargas. */
  pendingArchives(): string[];
  /**
   * Descomprime en segundo plano los pendientes (streaming, sin cargar el archivo en memoria) y
   * borra cada comprimido que se extrae bien. Resuelve con JSON: [{name, ok, files, error}].
   */
  unpackArchives(): Promise<string>;
  /** Netplay: crea una sala en el puerto (este iPhone es el Jugador 1). */
  netHost(port: number): boolean;
  /** Netplay: se une a la sala de otro iPhone por IP (Jugador 2). */
  netJoin(address: string, port: number): boolean;
  /** Netplay a distancia: crea sala en el servidor relay (código de 6 caracteres en netStatus). */
  netHostRelay(relayHost: string, port: number): boolean;
  /** Netplay a distancia: entra en la sala con su código. */
  netJoinCode(code: string, relayHost: string, port: number): boolean;
  /** Mando web del Jugador 2 (sin app): abre una sala en el relay; el navegador manda al puerto 1. */
  webPadStart(relayHost: string, port: number): boolean;
  webPadStop(): void;
  /** Expulsa al mando web del puerto 1-3 (libera el asiento). */
  webPadKick(port: number): void;
  /** Puertos (bits) ocupados por mandos físicos: no se asignan a mandos web. */
  webPadReserve(mask: number): void;
  /** "fase|código|mensaje|asientos" (0 apagado, 1 conectando, 2 esperando, 3 alguien conectado; bit p = puerto p). */
  webPadStatus(): string;
  /** Organizador: archivos fuera de su carpeta, JSON [{path, name, from, to, label, unsupported}]. */
  scanFiles(): string;
  /** Mueve los archivos (JSON [{path, to}]) a su carpeta; devuelve JSON {moved, failed}. */
  organizeFiles(movesJson: string): string;
  /** Ruta del juego antes de loadCore (arcade: su carpeta hace de system directory). */
  prepareContent(romPath: string): void;
  /** Copia texto al portapapeles del iPhone. */
  /** Abre Fotos y guarda la imagen elegida como PNG en destPath (dentro de Documents). */
  pickImage(destPath: string): Promise<boolean>;
  /** Subir por Wi-Fi: arranca el servidor (puerto 8888) y devuelve la URL ('' si falla). */
  wifiStart(): string;
  wifiStop(): void;
  /** JSON {running, port, files, bytes, current, progress, last, error}. */
  wifiStatus(): string;
  /** Ruta de un PNG con el código QR del texto ('' si falla). */
  qrCode(text: string): string;
  /** JSON [{console, file, found, md5ok, required, note}] de las BIOS conocidas. */
  biosStatus(): string;
  /** Carpeta vinculada: abre el selector de carpetas de Archivos; resuelve su nombre ('' = cancelado). */
  pickScanFolder(): Promise<string>;
  /** JSON {linked, name, available} de la carpeta vinculada. */
  scanFolderInfo(): string;
  unlinkScanFolder(): void;
  /** Analiza la carpeta vinculada sin cambiar nada: JSON {ok, error, folder, items, summary}. */
  scanLinkedFolder(): Promise<string>;
  /** Importa lo nuevo y reconocido (move = borra el original): JSON {ok, imported, bios, failed…}. */
  importLinkedFolder(move: boolean): Promise<string>;
  /** Progreso del escáner: JSON {busy, phase, current, done, total}. */
  folderScanStatus(): string;
  /** Identificación por cabecera de un juego: JSON {console, serial, title}. */
  romInfo(romPath: string): string;
  /** Sonido sutil de interfaz: 'move' | 'select' | 'back' | 'tab'. */
  uiSound(kind: string): void;
  /** Crea el respaldo .zip de partidas y abre Compartir; resuelve la ruta. */
  exportBackup(): Promise<string>;
  /** Elige un .zip de respaldo y lo restaura; resuelve el número de archivos (-1 = cancelado). */
  restoreBackup(): Promise<number>;
  /** Elige un parche .ips/.bps/.ups para la ROM (se guarda aparte; la ROM no se modifica). Resuelve el nombre o "". */
  patchPick(romPath: string): Promise<string>;
  /** JSON {active, name} del parche de la ROM. */
  patchInfo(romPath: string): string;
  patchRemove(romPath: string): void;
  /** Importa un paquete de texturas HD de PPSSPP para el ID de juego (carpeta PSP/TEXTURES/<ID>). Resuelve nº de archivos. */
  texturesImport(serial: string): Promise<number>;
  /** JSON {installed, enabled, files} de las texturas del juego. */
  texturesInfo(serial: string): string;
  texturesToggle(serial: string, enabled: boolean): void;
  texturesRemove(serial: string): void;
  copyToClipboard(text: string): void;
  netStop(): void;
  /** "fase|mensaje|código|ping_ms"; fase: idle, waiting, connecting, syncing, playing. */
  netStatus(): string;
  /** IP local (Wi-Fi) de este iPhone. */
  localAddress(): string;
  /** Pantalla externa (HDMI / AirPlay): JSON {connected, name, width, height}. */
  tvStatus(): string;
  /** Imagen en la TV: expandir, filtro suave y si hay partida (sin partida: portada JL). */
  setTVOptions(stretch: boolean, smooth: boolean, playing: boolean): void;
  /** Abre el selector nativo de AirPlay. */
  showAirPlayPicker(): void;
  /**
   * Mapeo del mando físico: 16 entradas (UP, DOWN, LEFT, RIGHT, Cruz/A, Círculo/B, Cuadrado/X,
   * Triángulo/Y, L1, R1, L2, R2, L3, R3, Options/Menú, Create/Vista) -> id de botón libretro (-1 = nada).
   */
  setPadMapping(mapping: ReadonlyArray<number>): void;
  /** Zona muerta de los sticks del mando (0..0.6) y si el stick izquierdo mueve también la cruceta. */
  setPadOptions(deadzone: number, stickToDpad: boolean): void;
  /** Estado físico del mando del Jugador 1 (JSON {buttons, lx, ly}) para la pantalla de prueba. */
  gamepadInput(): string;
  /** Busca mandos inalámbricos (GCController.startWirelessControllerDiscovery). */
  discoverControllers(): void;
  /** Bloquea la interfaz del iPhone en vertical (modo control mientras se transmite a la TV). */
  setOrientationLock(portrait: boolean): void;
  /** Orientación de la interfaz: 'portrait', 'landscape', 'auto' (libre) o 'normal'. */
  setOrientationMode(mode: string): void;
  /** Intercambia Jugador 1 y Jugador 2 entre los dos mandos físicos. */
  swapPlayers(): void;
  /** Vibración háptica breve (0..1 = intensidad). */
  haptic(strength: number): void;
  /** Taptic Engine: 'click' (A/B/X/Y), 'trigger' (L/R), 'dpad', 'soft', 'success'. */
  hapticKind(kind: string): void;
  /** Vibración Rumble del núcleo en el iPhone cuando el mando no vibra (y DualShock en PS1). */
  setPhoneRumble(enabled: boolean): void;
  /** Avance rápido: 1 = normal, 2-8 = veces más rápido (sin audio en los frames extra). */
  setFastForward(speed: number): void;
  fastForward(): number;
  /** Discos del juego (multidisco .m3u/.pbp): JSON {count, index, labels}. */
  diskInfo(): string;
  /** Cambia de disco (abre la bandeja, cambia y la cierra). */
  diskSet(index: number): boolean;
  /** Parte del frame en la TV: 0 completo, 1 mitad superior (DS: pantalla de arriba), 2 inferior. */
  setTVRegion(region: number): void;
  /** Hash RetroAchievements del juego ('!' + motivo si falla). consoleId = id de consola de RA. */
  raHash(romPath: string, consoleId: number): Promise<string>;
  /** Activa los logros [{id, memaddr}] del juego en curso. */
  raActivate(json: string, consoleId: number): boolean;
  raReset(): void;
  /** Eventos desde la última consulta: JSON [{id, type: 'unlock'|'progress', value, target}]. */
  raPoll(): string;
  /** Carpeta de iCloud Drive para las partidas: abre el selector; resuelve su nombre ('' = cancelado). */
  cloudPickFolder(): Promise<string>;
  /** JSON {linked, name, available, lastSync}. */
  cloudInfo(): string;
  cloudUnlink(): void;
  /** Sincroniza las partidas de un juego ('' = todas): 'push' | 'pull' | 'both'. JSON {ok, pushed, pulled, pending, error}. */
  cloudSync(romPath: string, direction: string): Promise<string>;
  /** Live Activity de la partida (Dynamic Island / pantalla de bloqueo). */
  liveActivityAvailable(): boolean;
  /** JSON {title, console, coverPath, accent, startedAt}. */
  liveActivityStart(json: string): void;
  /** JSON {paused, lastSave, startedAt}. */
  liveActivityUpdate(json: string): void;
  liveActivityEnd(): void;
  /** Giroscopio para el paralaje de las carátulas. */
  motionStart(): void;
  motionStop(): void;
  /** "x|y" en [-1, 1]. */
  motionTilt(): string;
  /** Música ambiental de la interfaz: suena si se quiere y no hay otro audio. */
  ambientMusic(wanted: boolean): void;
  ambientVolume(volume: number): void;
  /** Diagnóstico de entrada: lo que escribe la UI y lo que pidió el core (se reinicia al leer). */
  debugState(): string;
  /** true si hay un DualSense (PS5) conectado ahora mismo. */
  hasDualSense(): boolean;
  // Requeridos por NativeEventEmitter para el evento 'gamepadStatus'
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Libretro');
