import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  LayoutChangeEvent,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getGfxPreset, gfxOptions, GFX_CORES, GfxPreset, saveGfxPreset } from '../emulator/graphics';
import {
  defaultImagePrefs,
  ImagePrefs,
  loadImagePrefs,
  nativeImageArgs,
  REMASTER_2D,
  REMASTER_3D,
  saveImagePrefs,
} from '../input/imagePrefs';
import { addPlaytime } from '../library/playtime';
import { applySavedCheats, CheatsPanel, ImagePanel, RewindPanel, SaveSlots } from './MenuPanels';
import { Libretro, LibretroView } from 'react-native-libretro';
import {
  CoreId,
  coreForConsole,
  FALLBACK_CORE,
  isMisplacedZip,
  misplacedZipMessage,
} from '../emulator/cores';
import { defaultDirMode, DirMode, layoutFor, withDirMode } from '../input/layouts';
import { controlLabel, groupOf } from '../input/buildPad';
import {
  BUTTON_SIZE_MAX,
  BUTTON_SIZE_MIN,
  DEFAULT_FEEL,
  defaultPadPrefs,
  DisplayPrefs,
  Feel,
  loadDisplayPrefs,
  loadFeel,
  loadPadPrefs,
  loadPs1Hd,
  loadQuality,
  loadTvOrientation,
  saveQuality,
  saveTvOrientation,
  TvOrientation,
  OPACITY_MIN,
  Orientation,
  PadPrefs,
  saveDisplayPrefs,
  saveFeel,
  savePadPrefs,
  savePs1Hd,
  SCALE_MAX,
  SCALE_MIN,
} from '../input/padPrefs';
import { applyPadMapping, loadPadMapping } from '../input/padMapping';
import { tvPadFor } from '../input/tvLayouts';
import { getPadDebug, PointerRect, VirtualPad } from '../input/VirtualPad';
import { useGamepadStatus } from '../input/useGamepadStatus';
import { theme } from '../theme';
import { Slider } from '../ui/Slider';
import {
  FilterMode,
  GameMenu,
  GearButton,
  NetState,
  parseNetStatus,
  parseWebPadStatus,
  TouchMode,
  WebPadState,
} from './GameMenu';
import ControllerScreen from './ControllerScreen';
import GuideScreen from './GuideScreen';
import Svg, { Path, Rect } from 'react-native-svg';
import { slotsFor } from '../emulator/slots';
import { AchievementBanner, AchievementProgress, useAchievements } from '../achievements/useAchievements';
import { pullBeforePlay, pushAfterSave } from '../library/cloudSync';
import { skinFor, skinsEnabled, subscribeSkins } from '../input/skins';
import { getExperience, useExperience } from '../ui/experiencePrefs';
import { subscribeCover } from '../covers/CoverCache';
import { CONSOLE_LABEL, Console } from '../emulator/cores';
import TVDeskPanel from './TVDeskPanel';

type Props = {
  romPath: string;
  coreOverride?: CoreId;
  onExit: () => void;
  /** Volver a abrir el juego con otro núcleo (arcade: FBNeo <-> MAME). */
  onRetryWithCore?: (core: CoreId) => void;
  /** Vuelve a abrir el juego (p. ej. tras cambiar la calidad gráfica). */
  onRestart?: () => void;
  /** Ranura 0-4 desde la que empezar (ficha del juego); sin ella se reanuda el auto-guardado. */
  startSlot?: number;
};


const isNdsCore = (c: CoreId | null) => c === 'melonds' || c === 'desmume';

// Disposición de las dos pantallas de DS: apiladas en vertical, lado a lado en horizontal.
// 'swap' intercambia las pantallas; 'top'/'bottom' muestran una sola (la táctil sigue
// funcionando tocando la imagen: el núcleo traduce el puntero según su disposición).
// Diseño del mando web (/play?type=) que corresponde a cada núcleo
const WEB_PAD_TYPE: Record<CoreId, string> = {
  mgba: 'gba', genesis: 'arcade', mupen64: 'n64', mame: 'arcade', pcsx: 'ps', melonds: 'snes', desmume: 'snes',
  yabause: 'arcade', fbneo: 'arcade', ppsspp: 'ps', snes9x: 'snes', fceumm: 'nes', gambatte: 'nes',
  prboom: 'fps', ecwolf: 'fps', tyrquake: 'fps', vitaquake2: 'fps', nxengine: 'snes', cannonball: 'arcade',
  reminiscence: 'snes', easyrpg: 'nes', scummvm: 'nes', flycast: 'ps', swanstation: 'ps',
};

export type NdsScreen = 'both' | 'swap' | 'top' | 'bottom';
let ndsScreenMode: NdsScreen = 'both';

function setNdsLayout(landscape: boolean, mode: NdsScreen = ndsScreenMode) {
  ndsScreenMode = mode;
  const melon =
    mode === 'top' ? 'Top Only' : mode === 'bottom' ? 'Bottom Only'
    : mode === 'swap' ? (landscape ? 'Right/Left' : 'Bottom/Top') : landscape ? 'Left/Right' : 'Top/Bottom';
  const desmume =
    mode === 'top' ? 'top only' : mode === 'bottom' ? 'bottom only'
    : mode === 'swap' ? (landscape ? 'right/left' : 'bottom/top') : landscape ? 'left/right' : 'top/bottom';
  Libretro.setCoreOption('melonds_screen_layout', melon);
  Libretro.setCoreOption('desmume_screens_layout', desmume);
}

// Paleta de los juegos de Game Boy clásico (Gambatte). 'auto' = colores de GBC por juego.
export type GbPalette = 'auto' | 'dmg' | 'pocket' | 'light' | 'gray';
const GB_PALETTE: Record<GbPalette, [string, string]> = {
  auto: ['auto', 'GB - DMG'],
  dmg: ['internal', 'GB - DMG'],
  pocket: ['internal', 'GB - Pocket'],
  light: ['internal', 'GB - Light'],
  gray: ['internal', 'GBC - Grayscale'],
};
const GB_PALETTE_KEY = 'jl.gbpalette.v1';

function applyGbPalette(p: GbPalette) {
  const [colorization, palette] = GB_PALETTE[p] ?? GB_PALETTE.auto;
  Libretro.setCoreOption('gambatte_gb_colorization', colorization);
  Libretro.setCoreOption('gambatte_gb_internal_palette', palette);
}

// Rectángulo de la imagen dentro de una vista (mismo cálculo que el letterbox de Metal)
function fitRect(w: number, h: number, aspect: number, stretch: boolean): PointerRect {
  if (stretch || w <= 0 || h <= 0) return { x: 0, y: 0, w, h };
  const iw = w / h > aspect ? h * aspect : w;
  const ih = w / h > aspect ? h : w / aspect;
  return { x: (w - iw) / 2, y: (h - ih) / 2, w: iw, h: ih };
}

// Toque directo sobre la imagen como stylus (vista sin pad encima)
function pointerHandlers(rect: PointerRect) {
  type T = { locationX: number; locationY: number };
  const send = (t: T | undefined) => {
    if (!t || rect.w <= 0 || rect.h <= 0) return Libretro.setPointer(0, 0, false);
    const inside =
      t.locationX >= rect.x && t.locationX <= rect.x + rect.w && t.locationY >= rect.y && t.locationY <= rect.y + rect.h;
    if (!inside) return Libretro.setPointer(0, 0, false);
    Libretro.setPointer(((t.locationX - rect.x) / rect.w) * 2 - 1, ((t.locationY - rect.y) / rect.h) * 2 - 1, true);
  };
  return {
    onTouchStart: (e: { nativeEvent: { touches: T[] } }) => send(e.nativeEvent.touches[0]),
    onTouchMove: (e: { nativeEvent: { touches: T[] } }) => send(e.nativeEvent.touches[0]),
    onTouchEnd: () => Libretro.setPointer(0, 0, false),
    onTouchCancel: () => Libretro.setPointer(0, 0, false),
  };
}
// Vertical: alto mínimo del pad (los botones no deben quedar diminutos)
const PAD_MIN_FRACTION = 0.36;
const PAD_MIN_PX = 250;

// Barra de menú en horizontal: una sola fila de alto fijo; el juego y el pad van debajo
const BAR_H = 44;
const PS1_RES_KEY = 'pcsx_rearmed_neon_enhancement_enable';

// Título legible del juego para la cabecera del menú
function gameTitle(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
  return base.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || base;
}

export default function PlayerScreen({ romPath, coreOverride, onExit, onRetryWithCore, onRestart, startSlot }: Props) {
  // Consola por contenido verificado (nativo), no por extensión; en arcade, el núcleo elegido
  const baseCore = useMemo(
    () => coreOverride ?? coreForConsole(Libretro.consoleOf(romPath), romPath),
    [romPath, coreOverride],
  );
  // Núcleo que realmente arrancó (NDS: DeSmuME si melonDS no pudo)
  const [loadedCore, setLoadedCore] = useState<CoreId | null>(null);
  const core = loadedCore ?? baseCore;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Partidas en iCloud Drive: se traen las más recientes antes de abrir el juego (máx. 4 s)
  const [cloudReady, setCloudReady] = useState(false);
  useEffect(() => {
    let alive = true;
    setCloudReady(false);
    pullBeforePlay(romPath)
      .catch(() => null)
      .then(() => alive && setCloudReady(true));
    return () => {
      alive = false;
    };
  }, [romPath]);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [genesisSix, setGenesisSix] = useState(false);
  const [editing, setEditing] = useState(false);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const orientation: Orientation = landscape ? 'landscape' : 'portrait';
  const landscapeRef = useRef(landscape);
  landscapeRef.current = landscape;

  // Preferencias del pad (por consola y orientación) y de imagen (por orientación)
  const [padPrefs, setPadPrefs] = useState<PadPrefs>(() => defaultPadPrefs(orientation));
  const [display, setDisplay] = useState<DisplayPrefs>({ stretch: false });
  useEffect(() => {
    let alive = true;
    if (core) loadPadPrefs(core, orientation).then((p) => alive && setPadPrefs(p));
    loadDisplayPrefs(orientation).then((d) => alive && setDisplay(d));
    return () => {
      alive = false;
    };
  }, [core, orientation]);
  const updatePadPrefs = useCallback(
    (fn: (p: PadPrefs) => PadPrefs) =>
      setPadPrefs((prev) => {
        const next = fn(prev);
        if (core) savePadPrefs(core, orientation, next);
        return next;
      }),
    [core, orientation],
  );
  // Respuesta táctil por consola (sensibilidad, zona muerta, área de botones, vibración)
  const [feel, setFeel] = useState<Feel>(DEFAULT_FEEL);
  useEffect(() => {
    let alive = true;
    if (core) loadFeel(core).then((f) => alive && setFeel(f));
    return () => {
      alive = false;
    };
  }, [core]);
  const updateFeel = (patch: Partial<Feel>) =>
    setFeel((prev) => {
      const next = { ...prev, ...patch };
      if (core) saveFeel(core, next);
      return next;
    });
  // Control seleccionado en el editor (borde dorado) y panel plegado para ver lo que tapa
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const toggleStretch = () => {
    const next = { stretch: !display.stretch };
    setDisplay(next);
    saveDisplayPrefs(orientation, next);
  };

  // Relación de aspecto que declara el core (puede cambiar en PS1 al cambiar de modo de vídeo)
  const [aspect, setAspect] = useState(4 / 3);
  useEffect(() => {
    if (!ready) return;
    const poll = () => {
      const a = Libretro.videoAspect();
      if (a > 0.2 && a < 5) setAspect((prev) => (Math.abs(prev - a) > 0.001 ? a : prev));
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [ready]);

  // Con un DualSense conectado el pad táctil se oculta; el usuario puede forzarlo con el botón.
  // Al cambiar la conexión se descarta el override manual.
  const pad = useGamepadStatus();
  const [touchMode, setTouchMode] = useState<TouchMode>('auto');
  const touchVisible = editing || touchMode === 'show' || (touchMode === 'auto' && !pad.connected);
  // Transición suave: al conectar el mando el pad se desvanece y baja; luego se libera el espacio
  const padAnim = useRef(new Animated.Value(touchVisible ? 1 : 0)).current;
  const [padShown, setPadShown] = useState(touchVisible);
  useEffect(() => {
    if (touchVisible) {
      setPadShown(true);
      Animated.timing(padAnim, { toValue: 1, duration: 260, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(padAnim, { toValue: 0, duration: 380, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setPadShown(false);
    });
  }, [touchVisible, padAnim]);
  const wasConnected = useRef(pad.connected);
  useEffect(() => {
    if (pad.connected && !wasConnected.current) flash(`🎮 ${pad.name || 'Mando'} conectado · controles táctiles ocultos`);
    wasConnected.current = pad.connected;
  }, [pad.connected]); // eslint-disable-line react-hooks/exhaustive-deps
  // Skin de los controles táctiles según la consola
  const [skinsOn, setSkinsOn] = useState(skinsEnabled());
  useEffect(() => subscribeSkins(setSkinsOn), []);

  // Menú de configuración (engranaje) y filtro de imagen elegido
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterMode, setFilterModeState] = useState<FilterMode>('sharp');
  useEffect(() => {
    loadQuality().then(setFilterModeState);
  }, []);
  const setFilterMode = (q: FilterMode) => {
    setFilterModeState(q);
    saveQuality(q);
  };
  // Acomodo propio del mando de TV (por consola) y su editor
  const [tvPrefs, setTvPrefs] = useState<PadPrefs>(() => defaultPadPrefs('tv'));
  const [tvEditing, setTvEditing] = useState(false);
  const [tvSelected, setTvSelected] = useState<string | null>(null);

  // Netplay: estado consultado al nativo (barato y síncrono)
  const [net, setNet] = useState<NetState>({ phase: 'idle', message: '', code: '', ping: -1 });
  const [webPad, setWebPad] = useState<WebPadState>({ phase: 0, code: '', message: '', seats: 0 });
  useEffect(() => {
    if (!ready) return;
    const poll = () =>
      setNet((prev) => {
        const next = parseNetStatus(Libretro.netStatus());
        return next.phase === prev.phase && next.message === prev.message && next.code === prev.code && next.ping === prev.ping
          ? prev
          : next;
      });
    const pollPad = () =>
      setWebPad((prev) => {
        const next = parseWebPadStatus(Libretro.webPadStatus());
        return next.phase === prev.phase && next.code === prev.code && next.message === prev.message && next.seats === prev.seats
          ? prev
          : next;
      });
    poll();
    pollPad();
    const id = setInterval(() => {
      poll();
      pollPad();
    }, 700);
    return () => clearInterval(id);
  }, [ready]);
  // Al salir del juego se cierra el mando web
  useEffect(() => () => Libretro.webPadStop(), []);
  // Puertos ocupados por mandos Bluetooth: el relay no los da a los navegadores
  const physicalCount = pad.count ?? (pad.connected ? 1 : 0);
  useEffect(() => {
    if (webPad.phase === 0) return;
    let mask = 0;
    for (let port = 1; port < Math.min(4, physicalCount); port++) mask |= 1 << port;
    Libretro.webPadReserve(mask);
  }, [webPad.phase, physicalCount]);
  // PS1 a 4 jugadores: multitap en el puerto 1 solo cuando hay J3 o J4 (algunos juegos fallan con él)
  const fourPlayers = (webPad.seats & 0b1100) !== 0 || physicalCount > 2;
  useEffect(() => {
    if (core === 'pcsx' && ready) Libretro.setCoreOption('pcsx_rearmed_multitap', fourPlayers ? 'port 1' : 'disabled');
    // SNES: Super Multitap en el puerto 2 -> J2-J4 en los puertos 1-3 (Snes9x).
    // 257 = RETRO_DEVICE_SUBCLASS(JOYPAD, 0); 1 = mando normal.
    if (core === 'snes9x' && ready) Libretro.setCoreOption('jl_port1_device', fourPlayers ? '257' : '1');
  }, [core, ready, fourPlayers]);
  const online = net.phase !== 'idle';

  // Modo TV: pantalla externa (HDMI / AirPlay). El juego sale solo por la TV y el iPhone hace de
  // mando (o muestra el panel de consola si hay mandos físicos).
  const [tvConnected, setTvConnected] = useState(false);
  // AirPlay solo de audio (sin pantalla externa): se avisa, pero el juego sigue en el iPhone
  const [airplayAudioOnly, setAirplayAudioOnly] = useState(false);
  const [airplayNoticeHidden, setAirplayNoticeHidden] = useState(false);
  const [tvStretch, setTvStretch] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // Modo control vertical: con TV real o activado a mano (Chromecast, capturadora…)
  const [forceController, setForceController] = useState(false);
  const [airplayModal, setAirplayModal] = useState(false);
  const [controllerTest, setControllerTest] = useState(false);
  useEffect(() => {
    const poll = () => {
      try {
        const st = JSON.parse(Libretro.tvStatus());
        const screen = Boolean(st.connected);
        setTvConnected(screen);
        setAirplayAudioOnly(Boolean(st.audioAirPlay) && !screen);
      } catch {
        setTvConnected(false);
        setAirplayAudioOnly(false);
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, []);
  const tvSmooth = filterMode === 'smooth';
  useEffect(() => {
    Libretro.setTVOptions(tvStretch, tvSmooth, ready);
  }, [tvStretch, tvSmooth, ready]);
  useEffect(() => () => Libretro.setTVOptions(false, false, false), []);
  // DS en modo sobremesa: arriba en la TV, abajo táctil en el iPhone (se decide al dibujar)
  const tvRegionRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => Libretro.setTVRegion(tvRegionRef.current), 500);
    return () => {
      clearInterval(id);
      Libretro.setTVRegion(0);
    };
  }, []);
  const controllerMode = tvConnected || forceController;
  // Orientación del mando de TV: Vertical (palanca), Horizontal (mando clásico) o Automática
  const [tvOrient, setTvOrientState] = useState<TvOrientation>('portrait');
  useEffect(() => {
    loadTvOrientation().then(setTvOrientState);
  }, []);
  const setTvOrient = (v: TvOrientation) => {
    setTvOrientState(v);
    saveTvOrientation(v);
  };
  const tvLayoutPortrait = tvOrient === 'portrait' || (tvOrient === 'auto' && height >= width);
  const tvPrefsKey = tvLayoutPortrait ? 'tv' : 'tvl';
  useEffect(() => {
    let alive = true;
    if (core) loadPadPrefs(core, tvPrefsKey).then((pp) => alive && setTvPrefs(pp));
    return () => {
      alive = false;
    };
  }, [core, tvPrefsKey]);
  const updateTvPrefs = (fn: (pp: PadPrefs) => PadPrefs) =>
    setTvPrefs((prev) => {
      const next = fn(prev);
      if (core) savePadPrefs(core, tvPrefsKey, next);
      return next;
    });
  // Fuera del modo control no se edita el mando de TV
  useEffect(() => {
    if (!controllerMode) {
      setTvEditing(false);
      setTvSelected(null);
    }
  }, [controllerMode]);
  // Mientras el iPhone es el mando, la interfaz se bloquea según la orientación elegida
  const orientMode = controllerMode ? tvOrient : 'normal';
  useEffect(() => {
    Libretro.setOrientationMode(orientMode);
  }, [orientMode]);
  // Si iOS aún no giró a la orientación pedida, se vuelve a pedir
  const orientMismatch = (orientMode === 'portrait' && landscape) || (orientMode === 'landscape' && !landscape);
  useEffect(() => {
    if (!orientMismatch) return;
    Libretro.setOrientationMode(orientMode);
    const id = setTimeout(() => Libretro.setOrientationMode(orientMode), 600);
    return () => clearTimeout(id);
  }, [orientMismatch, orientMode]);
  useEffect(() => () => Libretro.setOrientationMode('normal'), []);
  // Al conectarse una pantalla real ya no hace falta el modo forzado
  useEffect(() => {
    if (tvConnected) setAirplayModal(false);
  }, [tvConnected]);
  // Mapeo del mando físico; el stick izquierdo mueve también la cruceta salvo en núcleos analógicos
  useEffect(() => {
    if (!core) return;
    loadPadMapping().then((m) => applyPadMapping(m, core !== 'mupen64' && core !== 'ppsspp'));
  }, [core]);
  // Al desconectar el audio AirPlay se rearma el aviso para la próxima vez
  useEffect(() => {
    if (!airplayAudioOnly) setAirplayNoticeHidden(false);
  }, [airplayAudioOnly]);

  // Diagnóstico de entrada en pantalla (sin Mac no hay otra forma de ver los logs nativos)
  const [debugOn, setDebugOn] = useState(false);
  const [debugText, setDebugText] = useState<string | null>(null);
  useEffect(() => {
    if (!debugOn) return;
    const id = setInterval(() => setDebugText(`${Libretro.debugState()}\n${getPadDebug()}`), 500);
    return () => clearInterval(id);
  }, [debugOn]);

  useEffect(() => {
    if (!baseCore) {
      setError(
        isMisplacedZip(romPath)
          ? misplacedZipMessage(romPath)
          : 'Esta ROM no tiene una cabecera válida para ninguna consola soportada',
      );
      return;
    }
    if (!cloudReady) return;
    // Opciones que el core lee al cargar el juego
    if (isNdsCore(baseCore)) setNdsLayout(landscapeRef.current);
    // Vibración Rumble: en el mando o en el iPhone; N64 con Rumble Pak, PS1 con DualShock
    const exp = getExperience();
    Libretro.setPhoneRumble(exp.rumble);
    Libretro.setCoreOption('mupen64plus-pak1', exp.rumble && exp.n64RumblePak ? 'rumble' : 'memory');
    let started: CoreId | null = null;
    const errors: string[] = [];
    // Arcade: la carpeta del romset (arcade/ o fbneo/) es el system directory de MAME y FBNeo
    Libretro.prepareContent(romPath);
    // Calidad gráfica: GPU (HD/Ultra) o software (Estándar) y opciones del núcleo, antes de cargar
    const preset = getGfxPreset();
    Libretro.setCoreOption('jl_hw_render', preset === 'std' ? 'disabled' : 'enabled');
    for (const candidate of [baseCore, FALLBACK_CORE[baseCore]]) {
      if (!candidate) continue;
      gfxOptions(candidate, preset).forEach(([k, v]) => Libretro.setCoreOption(k, v));
      if (!Libretro.loadCore(candidate)) {
        errors.push(Libretro.lastError() || `No se pudo cargar el núcleo "${candidate}"`);
        continue;
      }
      if (!Libretro.loadGame(romPath)) {
        errors.push(Libretro.lastError() || 'No se pudo abrir la ROM');
        continue;
      }
      started = candidate;
      break;
    }
    if (!started) {
      setError(errors.join('\n\n'));
      return;
    }
    const slots = slotsFor(started);
    // Ranura elegida en la ficha del juego; si no, reanuda donde se dejó (auto-guardado)
    if (startSlot === undefined || !Libretro.loadState(10 + slots.save * 10 + startSlot)) Libretro.loadState(slots.auto);
    Libretro.start();
    setLoadedCore(started);
    setReady(true);
    return () => {
      // Auto-guardado al salir, mientras el core aún corre; luego para y persiste la SRAM
      Libretro.netStop();
      Libretro.saveState(slots.auto);
      Libretro.stop();
      Libretro.unloadGame();
      // Copia en iCloud Drive de la partida y del guardado nativo (.srm) recién escrito
      pushAfterSave(romPath, 200);
    };
  }, [romPath, baseCore, cloudReady]);

  // DS: al girar el iPhone las pantallas pasan de apiladas a lado a lado (en caliente)
  const [ndsScreen, setNdsScreen] = useState<NdsScreen>(ndsScreenMode);
  useEffect(() => {
    // En la TV las dos pantallas van apiladas (como la consola)
    if (ready && isNdsCore(core)) setNdsLayout(landscape && !tvConnected, ndsScreen);
  }, [ready, core, landscape, tvConnected, ndsScreen]);

  // Calidad gráfica: cambia de renderizador (software/GPU) y a veces de núcleo -> reabrir el juego
  const [gfxPreset, setGfxPreset] = useState<GfxPreset>(getGfxPreset());
  const chooseGfx = (p: GfxPreset) => {
    if (p === gfxPreset) return;
    setGfxPreset(p);
    saveGfxPreset(p);
    Alert.alert(
      'Calidad gráfica',
      'Se aplica al volver a abrir el juego (cambia el renderizador). La partida se guarda automáticamente antes.',
      [
        { text: 'Más tarde', style: 'cancel' },
        { text: 'Reiniciar ahora', onPress: () => onRestart?.() },
      ],
    );
  };

  // Ajustes de imagen por consola (shader, nitidez CAS, suavizado, color): en vivo por GPU
  const consoleId = useMemo(() => Libretro.consoleOf(romPath), [romPath]);
  const [imagePrefs, setImagePrefs] = useState<ImagePrefs>(() => defaultImagePrefs(consoleId));
  useEffect(() => {
    loadImagePrefs(consoleId).then(setImagePrefs);
  }, [consoleId]);
  useEffect(() => {
    Libretro.setImageOptions(...nativeImageArgs(imagePrefs));
  }, [imagePrefs]);
  useEffect(() => () => Libretro.setImageOptions(0, 0, 0, 0), []);
  const changeImage = (p: ImagePrefs) => {
    setImagePrefs(p);
    saveImagePrefs(consoleId, p);
  };
  const remaster = () => {
    if (core && GFX_CORES.has(core)) {
      changeImage(REMASTER_3D);
      chooseGfx('remaster');
    } else {
      changeImage(REMASTER_2D);
      flash('✨ Ultra HD Remaster activado');
    }
  };

  // Logros (RetroAchievements): banner tipo trofeo al desbloquear
  const achievements = useAchievements(romPath, ready ? core : null, ready);
  useEffect(() => {
    if (achievements.status === 'active' || achievements.status === 'none') flash(achievements.message);
  }, [achievements.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live Activity: Dynamic Island y pantalla de bloqueo mientras dura la partida
  const experience = useExperience();
  const sessionStart = useRef(Date.now());
  useEffect(() => {
    if (!ready || !core || !experience.liveActivity) return;
    let available = false;
    try {
      available = Libretro.liveActivityAvailable();
    } catch {
      available = false;
    }
    if (!available) return;
    const consoleId = Libretro.consoleOf(romPath) as Console;
    let started = false;
    const start = (cover: string | null) => {
      if (started) return;
      started = true;
      Libretro.liveActivityStart(
        JSON.stringify({
          title: gameTitle(romPath),
          console: CONSOLE_LABEL[consoleId] ?? '',
          coverPath: cover ? cover.replace(/^file:\/\//, '').split('?')[0] : '',
          accent: '#1A9FFF',
          startedAt: sessionStart.current,
        }),
      );
    };
    // Con carátula si ya está en caché; si tarda, sin ella
    const unsub = subscribeCover(romPath, consoleId, (uri) => start(uri));
    const fallback = setTimeout(() => start(null), 1500);
    return () => {
      unsub();
      clearTimeout(fallback);
      Libretro.liveActivityEnd();
    };
  }, [ready, core, romPath, experience.liveActivity]);
  const noteSaved = useCallback(() => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    try {
      Libretro.liveActivityUpdate(JSON.stringify({ lastSave: `Guardado ${hhmm}` }));
    } catch {
      // sin Live Activity
    }
    pushAfterSave(romPath);
  }, [romPath]);

  // Botones de la Live Activity: jlemu://save guarda el estado; jlemu://resume solo vuelve
  useEffect(() => {
    if (!ready || !core) return;
    const quick = slotsFor(core).save;
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (!url.startsWith('jlemu://save')) return;
      const ok = Libretro.saveState(quick);
      flash(ok ? 'Partida guardada desde la Dynamic Island' : 'Error al guardar');
      if (ok) noteSaved();
    });
    return () => sub.remove();
  }, [ready, core, noteSaved]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al minimizar la app: copia de las partidas en iCloud
  useEffect(() => {
    if (!ready) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') pushAfterSave(romPath, 100);
    });
    return () => sub.remove();
  }, [ready, romPath]);

  // Trucos guardados para este juego y tiempo jugado (no cuenta con el menú abierto o en pausa)
  const pausedRef = useRef(false);
  pausedRef.current = paused || menuOpen;
  useEffect(() => {
    if (ready) applySavedCheats(romPath);
  }, [ready, romPath]);
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      if (!pausedRef.current) addPlaytime(romPath, 15);
    }, 15000);
    return () => clearInterval(id);
  }, [ready, romPath]);

  // Game Boy: paleta clásica elegida (recordada en el dispositivo)
  const [gbPalette, setGbPalette] = useState<GbPalette>('auto');
  useEffect(() => {
    AsyncStorage.getItem(GB_PALETTE_KEY)
      .then((v) => {
        if (v && v in GB_PALETTE) setGbPalette(v as GbPalette);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (core === 'gambatte') applyGbPalette(gbPalette);
  }, [core, gbPalette]);
  const chooseGbPalette = (p: GbPalette) => {
    setGbPalette(p);
    AsyncStorage.setItem(GB_PALETTE_KEY, p).catch(() => {});
  };

  // PS1: resolución interna 1x (fluido, por defecto) o 2x HD. Se aplica en caliente.
  const [ps1Hd, setPs1Hd] = useState(false);
  useEffect(() => {
    if (core === 'pcsx') loadPs1Hd().then(setPs1Hd);
  }, [core]);
  useEffect(() => {
    if (core === 'pcsx') Libretro.setCoreOption(PS1_RES_KEY, ps1Hd ? 'enabled' : 'disabled');
  }, [core, ps1Hd]);
  const togglePs1Hd = () => {
    const next = !ps1Hd;
    setPs1Hd(next);
    savePs1Hd(next);
    flash(next ? '2x HD: más nítido, más exigente' : '1x Fluido: máximo rendimiento');
  };

  // Vertical: alto disponible bajo el HUD, para repartir imagen y pad sin huecos
  const [area, setArea] = useState({ w: 0, h: 0 });
  const onArea = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setArea((a) => (a.w === w && a.h === h ? a : { w, h }));
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 1500);
  };

  // Abrir el menú pausa la partida (salvo en línea: pararía también al otro jugador)
  const openMenu = () => {
    setMenuOpen(true);
    if (!online) Libretro.setPaused(true);
    pushAfterSave(romPath);
  };
  const closeMenu = () => {
    setMenuOpen(false);
    Libretro.setPaused(paused || editing);
  };

  // Editar controles pausa el juego; al salir se restaura el estado de pausa anterior
  const toggleEditing = () => {
    const next = !editing;
    setEditing(next);
    setSelectedId(null);
    setPanelCollapsed(false);
    Libretro.setPaused(next || paused);
  };

  const arcadeCore = baseCore === 'fbneo' || baseCore === 'mame';
  if (error && arcadeCore) {
    return (
      <ArcadeErrorCard
        romPath={romPath}
        core={baseCore}
        error={error}
        onExit={onExit}
        onRetry={onRetryWithCore ? () => onRetryWithCore(baseCore === 'fbneo' ? 'mame' : 'fbneo') : undefined}
      />
    );
  }
  if (error || !ready || !core) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{error ?? (cloudReady ? 'Cargando…' : 'Sincronizando partidas con iCloud…')}</Text>
        <Pressable onPress={onExit} style={styles.button}>
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const dirMode: DirMode = padPrefs.dirMode ?? defaultDirMode(core);
  const padLayout = withDirMode(layoutFor(core, genesisSix, landscape), dirMode);
  const smooth3d = filterMode === 'smooth';

  // Resolución: PS1 renderiza a 1x o 2x (GPU NEON); el resto a su resolución nativa y Metal la
  // escala a la pantalla Retina con filtro nítido (sin coste de CPU)
  const resolutions =
    core === 'pcsx'
      ? [
          { id: '1x', label: '1x Fluido' },
          { id: '2x', label: '2x HD' },
        ]
      : [{ id: 'native', label: 'Nativa → Retina (Metal)' }];
  const resolution = core === 'pcsx' ? (ps1Hd ? '2x' : '1x') : 'native';
  const resolutionNote =
    core === 'pcsx'
      ? '2x duplica la resolución interna (más nítido, más CPU). La imagen siempre se escala a Retina por GPU.'
      : core === 'ppsspp'
        ? 'PSP usa el renderizador por software de PPSSPP (iOS no permite JIT): 480×272 nativo, escalado a Retina por Metal. Más resolución interna bajaría mucho los FPS.'
        : core === 'mupen64'
          ? 'N64 usa el RDP por software (angrylion), siempre a resolución nativa; Metal escala a Retina con antialiasing.'
          : 'Escalado nítido a Retina por GPU (Metal): píxeles enteros, sin desenfoque.';

  // Cada botón guarda su propio desplazamiento; parte del de su grupo (ajustes anteriores)
  const moveControl = (id: string, dx: number, dy: number) =>
    updatePadPrefs((p) => {
      const prev = p.offsets[id] ?? p.offsets[groupOf(id)] ?? { dx: 0, dy: 0 };
      return { ...p, offsets: { ...p.offsets, [id]: { dx: prev.dx + dx, dy: prev.dy + dy } } };
    });
  const selectedSize = selectedId ? padPrefs.sizes?.[selectedId] ?? 1 : 1;
  const setSelectedSize = (v: number) =>
    selectedId && updatePadPrefs((p) => ({ ...p, sizes: { ...(p.sizes ?? {}), [selectedId]: v } }));
  const resetSelected = () =>
    selectedId &&
    updatePadPrefs((p) => {
      const offsets = { ...p.offsets };
      const sizes = { ...(p.sizes ?? {}) };
      delete offsets[selectedId];
      delete sizes[selectedId];
      return { ...p, offsets, sizes };
    });
  const pct = (v: number) => `${Math.round(v * 100)} %`;

  // Avisos flotando sobre la imagen (no desplazan el layout)
  const notices = (
    <View style={styles.notices} pointerEvents="box-none">
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <AchievementBanner unlock={achievements.banner} landscape={landscape} />
      <AchievementProgress progress={achievements.progress} />
      {debugOn && debugText ? <Text style={styles.debug}>{debugText}</Text> : null}
      {online && !menuOpen ? <Text style={styles.netNotice}>{net.message}</Text> : null}
      {webPad.seats && !menuOpen ? (
        <Text style={styles.netNotice}>
          Mando web: {[1, 2, 3].filter((p) => (webPad.seats >> p) & 1).map((p) => `J${p + 1}`).join(', ')}
        </Text>
      ) : null}
      {airplayAudioOnly && !airplayNoticeHidden && !menuOpen ? (
        <Pressable onPress={() => setAirplayNoticeHidden(true)} style={styles.airplayNotice}>
          <Text style={styles.airplayText}>
            Conectaste solo audio AirPlay. Para ver el juego en la TV y usar el iPhone como control, activa
            'Duplicar pantalla' (Screen Mirroring) en el Centro de control.
          </Text>
          <Text style={styles.airplayClose}>Entendido ✕</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const editPanel = !editing ? null : panelCollapsed ? (
    <Pressable
      onPress={() => setPanelCollapsed(false)}
      style={[styles.panelChip, landscape && styles.panelChipLandscape]}>
      <Text style={styles.panelChipText}>
        {selectedId ? `${controlLabel(selectedId)} · ` : ''}Mostrar panel
      </Text>
    </Pressable>
  ) : (
    <View style={[styles.editPanel, landscape && styles.editPanelLandscape]}>
      <View style={styles.editHeader}>
        <Text style={styles.editTitle}>Editar controles · {landscape ? 'Horizontal' : 'Vertical'}</Text>
        <Pressable onPress={() => setPanelCollapsed(true)} hitSlop={10}>
          <Text style={styles.editCollapse}>Ocultar ▾</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.editScroll} contentContainerStyle={styles.editScrollContent}>
        <Text style={styles.editHint}>
          Toca un botón para seleccionarlo (borde dorado) y arrástralo a donde quieras. Se guarda solo.
        </Text>
        {selectedId ? (
          <View style={styles.selectedBox}>
            <View style={styles.editHeader}>
              <Text style={styles.selectedTitle}>{controlLabel(selectedId)}</Text>
              <Pressable onPress={resetSelected} hitSlop={8}>
                <Text style={styles.editCollapse}>Restablecer botón</Text>
              </Pressable>
            </View>
            <Slider
              label="Tamaño de este botón"
              value={selectedSize}
              min={BUTTON_SIZE_MIN}
              max={BUTTON_SIZE_MAX}
              format={pct}
              onChange={setSelectedSize}
            />
          </View>
        ) : null}
        <Slider
          label="Tamaño global"
          value={padPrefs.scale}
          min={SCALE_MIN}
          max={SCALE_MAX}
          format={pct}
          onChange={(v) => updatePadPrefs((p) => ({ ...p, scale: v }))}
        />
        <Slider
          label="Transparencia"
          value={padPrefs.opacity}
          min={OPACITY_MIN}
          max={1}
          format={pct}
          onChange={(v) => updatePadPrefs((p) => ({ ...p, opacity: v }))}
        />
        <Text style={styles.editSection}>Respuesta táctil · {landscape ? 'ambas orientaciones' : 'ambas orientaciones'}</Text>
        <Slider
          label="Sensibilidad del stick"
          value={feel.sensitivity}
          min={0.5}
          max={2}
          format={pct}
          onChange={(v) => updateFeel({ sensitivity: v })}
        />
        <Slider
          label="Zona muerta (stick y cruceta)"
          value={feel.deadzone}
          min={0.05}
          max={0.4}
          format={pct}
          onChange={(v) => updateFeel({ deadzone: v })}
        />
        <Slider
          label="Área de detección de botones"
          value={feel.hitSlop}
          min={0.8}
          max={1.5}
          format={pct}
          onChange={(v) => updateFeel({ hitSlop: v })}
        />
        <Pressable onPress={() => updateFeel({ haptics: !feel.haptics })} style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Vibración háptica al pulsar</Text>
          <View style={[styles.toggle, feel.haptics && styles.toggleOn]}>
            <View style={[styles.toggleKnob, feel.haptics && styles.toggleKnobOn]} />
          </View>
        </Pressable>
      </ScrollView>
      <View style={styles.editActions}>
        <HudButton
          label="Restablecer todo"
          onPress={() => {
            setSelectedId(null);
            updatePadPrefs((p) => ({ ...defaultPadPrefs(orientation), dirMode: p.dirMode }));
          }}
        />
        <HudButton label="Listo" onPress={toggleEditing} active />
      </View>
    </View>
  );

  const slot = slotsFor(core).save;
  const menu = menuOpen ? (
    <GameMenu
      landscape={landscape}
      title={gameTitle(romPath)}
      onResume={closeMenu}
      onExit={onExit}
      onSave={() => {
        const ok = Libretro.saveState(slot);
        flash(ok ? 'Partida guardada' : 'Error al guardar');
        if (ok) noteSaved();
      }}
      onLoad={() => {
        const ok = Libretro.loadState(slot);
        flash(ok ? 'Partida cargada' : 'No hay partida guardada');
        if (ok) closeMenu();
      }}
      onReset={() => {
        Libretro.reset();
        closeMenu();
      }}
      onEditControls={() => {
        setMenuOpen(false);
        if (controllerMode) {
          setTvEditing(true);
          setTvSelected(null);
          Libretro.setPaused(true);
          return;
        }
        setEditing(true);
        setSelectedId(null);
        setPanelCollapsed(false);
        Libretro.setPaused(true);
      }}
      dirMode={dirMode}
      onDirMode={(m) => updatePadPrefs((pp) => ({ ...pp, dirMode: m }))}
      touchMode={touchMode}
      onTouchMode={setTouchMode}
      genesisSix={genesisSix}
      onGenesisSix={core === 'genesis' ? setGenesisSix : undefined}
      stretch={display.stretch}
      onStretch={(v) => v !== display.stretch && toggleStretch()}
      aspectName={aspectLabel(aspect)}
      resolutions={resolutions}
      resolution={resolution}
      onResolution={(id) => core === 'pcsx' && (id === '2x') !== ps1Hd && togglePs1Hd()}
      resolutionNote={resolutionNote}
      filter={smooth3d ? 'smooth' : 'sharp'}
      onFilter={setFilterMode}
      pad={pad}
      net={net}
      debugOn={debugOn}
      onDebug={() => setDebugOn((v) => !v)}
      tvConnected={tvConnected}
      airplayAudioOnly={airplayAudioOnly}
      tvStretch={tvStretch}
      onTvStretch={setTvStretch}
      onGuide={() => setGuideOpen(true)}
      onAirPlay={() => {
        if (tvConnected) {
          Libretro.showAirPlayPicker();
        } else {
          setAirplayModal(true);
        }
      }}
      forceController={forceController}
      onForceController={(v) => {
        setForceController(v);
        setMenuOpen(false);
        Libretro.setPaused(paused || editing);
      }}
      onControllerTest={() => setControllerTest(true)}
      webPad={webPad}
      tvOrient={tvOrient}
      onTvOrient={setTvOrient}
      webPadType={WEB_PAD_TYPE[core ?? 'mame']}
      slotsPanel={
        <SaveSlots
          base={10 + slotsFor(core).save * 10}
          canLoad={net.phase === 'idle'}
          onMessage={(m) => {
            flash(m);
            if (m.startsWith('Guardado')) noteSaved();
          }}
          onLoaded={closeMenu}
        />
      }
      rewindPanel={<RewindPanel onMessage={flash} onDone={closeMenu} />}
      cheatsPanel={<CheatsPanel romPath={romPath} />}
      imagePanel={
        <ImagePanel
          prefs={imagePrefs}
          onChange={changeImage}
          onRemaster={remaster}
          remasterNote={
            GFX_CORES.has(core)
              ? 'Consola 3D: resolución interna 4x con antialiasing, PGXP en PS1, panorámico 16:9 con recorte del overscan y nitidez adaptativa (reinicia el juego).'
              : 'Consola 2D / arcade: suavizado de bordes de sprites (tipo xBRZ / ScaleFX) + nitidez adaptativa CAS + color vívido, en vivo.'
          }
        />
      }
      extras={[
        ...(GFX_CORES.has(core)
          ? [
              {
                label: 'Calidad gráfica (resolución interna 3D)',
                value: gfxPreset,
                onChange: (v: string) => chooseGfx(v as GfxPreset),
                options: [
                  { id: 'std', label: 'Estándar 1x' },
                  { id: 'hd', label: 'Alta 2x HD' },
                  { id: 'ultra', label: 'Ultra Full HD' },
                  { id: 'remaster', label: '✨ Remaster' },
                ],
                note:
                  'Estándar: render por software (máxima batería y compatibilidad). Alta y Ultra usan la GPU: ' +
                  'PSP 960×544 / 1920×1088, PS1 con SwanStation 3x / 4x (necesita BIOS de PS1; si no, PCSX 2x), ' +
                  'N64 con GLideN64 1280×960 / 1920×1440 y Dreamcast 1280×960 / 1920×1440. Ultra añade PGXP, ' +
                  'panorámico 16:9 y filtrado anisotrópico. Packs de texturas HD: ver system/textures/LEEME.txt.',
              },
            ]
          : []),
        ...(isNdsCore(core)
          ? [
              {
                label: 'Pantallas DS',
                value: ndsScreen,
                onChange: (v: string) => setNdsScreen(v as NdsScreen),
                options: [
                  { id: 'both', label: 'Ambas' },
                  { id: 'swap', label: 'Cambiar pantalla' },
                  { id: 'top', label: 'Solo superior' },
                  { id: 'bottom', label: 'Solo táctil' },
                ],
                note: 'Toca directamente la pantalla inferior con el dedo para usar la pantalla táctil.',
              },
            ]
          : []),
        ...(core === 'gambatte'
          ? [
              {
                label: 'Paleta Game Boy',
                value: gbPalette,
                onChange: (v: string) => chooseGbPalette(v as GbPalette),
                options: [
                  { id: 'auto', label: 'Color auto' },
                  { id: 'dmg', label: 'Verde clásico' },
                  { id: 'pocket', label: 'Pocket' },
                  { id: 'light', label: 'Light' },
                  { id: 'gray', label: 'Gris' },
                ],
                note: 'Se aplica a los juegos de Game Boy clásico; los de Game Boy Color usan sus colores.',
              },
            ]
          : []),
      ]}
    />
  ) : null;
  const controllerScreen = controllerTest ? (
    <View style={styles.guideOverlay}>
      <ControllerScreen
        pad={pad}
        stickToDpad={core !== 'mupen64' && core !== 'ppsspp'}
        onClose={() => setControllerTest(false)}
      />
    </View>
  ) : null;
  const airplay = airplayModal ? (
    <View style={styles.modalBackdrop}>
      <View style={styles.modal}>
        <Text style={styles.modalKicker}>VÍDEO A LA TV</Text>
        <View style={styles.modalArt}>
          <Svg width={120} height={84} viewBox="0 0 120 84">
            <Rect x="2" y="2" width="116" height="80" rx="18" fill="#1D2028" stroke="#D4AF37" strokeWidth="2" />
            <Rect x="30" y="20" width="44" height="30" rx="4" fill="none" stroke="#ECEDEF" strokeWidth="3" />
            <Rect x="46" y="34" width="44" height="30" rx="4" fill="#1D2028" stroke="#ECEDEF" strokeWidth="3" />
            <Path d="M12 70h30" stroke="#7D828C" strokeWidth="3" strokeLinecap="round" />
          </Svg>
          <Text style={styles.modalArtLabel}>Duplicar pantalla</Text>
        </View>
        <Text style={styles.modalText}>
          Para enviar el VIDEO a tu TV: abre el Centro de Control de iPhone (desliza desde la esquina superior
          derecha), toca 'Duplicar pantalla' (ícono de dos pantallas) y selecciona tu TV. Al hacerlo, el video
          pasará a la TV y tu iPhone se convertirá automáticamente en un control vertical.
        </Text>
        <Text style={styles.modalNote}>
          El selector de AirPlay de las apps solo envía el audio; el vídeo necesita Duplicar pantalla o un
          adaptador HDMI.
        </Text>
        <View style={styles.modalActions}>
          <HudButton
            label="Activar modo control ahora"
            active
            onPress={() => {
              setAirplayModal(false);
              setMenuOpen(false);
              setForceController(true);
              Libretro.setPaused(paused || editing);
            }}
          />
          <HudButton label="Entendido" onPress={() => setAirplayModal(false)} />
        </View>
      </View>
    </View>
  ) : null;
  const guide = guideOpen ? (
    <View style={styles.guideOverlay}>
      <GuideScreen onClose={() => setGuideOpen(false)} />
    </View>
  ) : null;
  const gear = editing ? null : (
    <View style={[styles.gearSlot, landscape && styles.gearSlotLandscape]}>
      <GearButton onPress={openMenu} online={online} />
    </View>
  );

  const showTouchChip =
    pad.connected && touchMode === 'auto' && !editing ? (
      <Pressable onPress={() => setTouchMode('show')} style={[styles.touchChip, landscape && styles.touchChipLandscape]}>
        <Text style={styles.touchChipText}>🎮 {pad.name || 'Mando'} · Mostrar controles</Text>
      </Pressable>
    ) : null;

  const nds = isNdsCore(core);
  const padSkin = skinFor(core, skinsOn);
  const padView = (style: object, pointerRect?: PointerRect) =>
    padShown ? (
      <Animated.View
        pointerEvents={touchVisible ? 'box-none' : 'none'}
        style={[
          style,
          {
            opacity: padAnim,
            transform: [{ translateY: padAnim.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }],
          },
        ]}>
        <VirtualPad
          key={`${padLayout.name}:${dirMode}`}
          layout={padLayout}
          prefs={padPrefs}
          feel={feel}
          style={StyleSheet.absoluteFill}
          opacity={padPrefs.opacity}
          editing={editing}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMoveControl={moveControl}
          pointerRect={pointerRect}
          skin={padSkin}
        />
      </Animated.View>
    ) : null;

  // ---- Modo TV: el iPhone es el mando (sin vídeo duplicado) ----------------------------------
  if (controllerMode) {
    // Mando vertical u horizontal según la orientación elegida. Si iOS no gira la interfaz (bloqueo
    // de rotación del usuario), el mando se dibuja girado 90° para respetar la elegida.
    const tv = tvPadFor(core, tvLayoutPortrait);
    const rotated = tvOrient !== 'auto' && (tvLayoutPortrait ? area.w > area.h : area.h > area.w);
    const padW = rotated ? area.h : area.w;
    const padH = rotated ? area.w : area.h;
    const trackpad = tv.trackpad
      ? { x: tv.trackpad.x * padW, y: tv.trackpad.y * padH, w: tv.trackpad.w * padW, h: tv.trackpad.h * padH }
      : undefined;
    const players = pad.players ?? [];
    const finishTvEditing = () => {
      setTvEditing(false);
      setTvSelected(null);
      Libretro.setPaused(paused);
      flash('Botones guardados');
    };
    const tvSize = tvSelected ? tvPrefs.sizes?.[tvSelected] ?? 1 : 1;
    const tvAlpha = tvSelected ? tvPrefs.alphas?.[tvSelected] ?? 1 : 1;
    const showPad = tvEditing || !(pad.connected && touchMode !== 'show');
    // DS en el panel de sobremesa: la TV muestra solo la pantalla de arriba
    tvRegionRef.current = tvConnected && nds && !showPad ? 1 : 0;
    return (
      <View style={styles.root}>
        <View style={[styles.flex, styles.tvRoot]} onLayout={onArea}>
          <View style={[styles.tvGlow, { backgroundColor: tv.accent }]} pointerEvents="none" />
          {!showPad ? (
            <TVDeskPanel
              title={gameTitle(romPath)}
              slotBase={10 + slotsFor(core).save * 10}
              canLoad={net.phase === 'idle'}
              players={[0, 1]
                .map((i) => `J${i + 1} ${players[i] ? `· ${players[i].kind} conectado` : '· sin mando'}`)
                .join('     ')}
              nds={nds && tvConnected}
              dsAspect={aspect}
              cheatsPanel={<CheatsPanel romPath={romPath} />}
              onMessage={flash}
              onSaved={noteSaved}
              onOpenMenu={openMenu}
              onSwapPlayers={(pad.count ?? 0) >= 2 ? () => Libretro.swapPlayers() : undefined}
              onShowTouch={() => setTouchMode('show')}
            />
          ) : area.w > 0 ? (
            <View
              style={
                rotated
                  ? {
                      position: 'absolute',
                      width: padW,
                      height: padH,
                      left: (area.w - padW) / 2,
                      top: (area.h - padH) / 2,
                      transform: [{ rotate: tvLayoutPortrait ? '-90deg' : '90deg' }],
                    }
                  : StyleSheet.absoluteFill
              }>
              <Text style={styles.tvLabel}>
                Mando · {tv.title} · {tvConnected ? 'el juego se ve en la TV' : 'modo control manual'}
              </Text>
              <VirtualPad
                key={`tv:${tv.layout.name}`}
                layout={tv.layout}
                prefs={tvPrefs}
                feel={{ ...feel, haptics: true }}
                style={StyleSheet.absoluteFill}
                opacity={tvPrefs.opacity}
                editing={tvEditing}
                selectedId={tvSelected}
                onSelect={setTvSelected}
                onMoveControl={(id, dx, dy) =>
                  updateTvPrefs((pp) => {
                    const prev = pp.offsets[id] ?? pp.offsets[groupOf(id)] ?? { dx: 0, dy: 0 };
                    return { ...pp, offsets: { ...pp.offsets, [id]: { dx: prev.dx + dx, dy: prev.dy + dy } } };
                  })
                }
                pointerRect={trackpad}
                pointerBottom
                trackpadLabel={trackpad ? 'Pantalla táctil (lápiz)' : undefined}
                skin={padSkin}
              />
            </View>
          ) : null}
          {notices}
        </View>
        {tvEditing ? (
          <>
            <View style={styles.tvEditBar}>
              <HudButton
                label="Restablecer"
                onPress={() => {
                  setTvSelected(null);
                  updateTvPrefs(() => defaultPadPrefs(tvPrefsKey));
                }}
              />
              <Text style={styles.tvEditHint}>Arrastra cada botón · tócalo para su tamaño</Text>
              <HudButton label="Listo / Guardar" onPress={finishTvEditing} active />
            </View>
            {tvSelected ? (
              <View style={styles.tvEditPanel}>
                <View style={styles.editHeader}>
                  <Text style={styles.selectedTitle}>{controlLabel(tvSelected)}</Text>
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      updateTvPrefs((pp) => {
                        const offsets = { ...pp.offsets };
                        const sizes = { ...(pp.sizes ?? {}) };
                        const alphas = { ...(pp.alphas ?? {}) };
                        delete offsets[tvSelected];
                        delete sizes[tvSelected];
                        delete alphas[tvSelected];
                        return { ...pp, offsets, sizes, alphas };
                      })
                    }>
                    <Text style={styles.editCollapse}>Restablecer botón</Text>
                  </Pressable>
                </View>
                <Slider
                  label="Tamaño"
                  value={tvSize}
                  min={0.75}
                  max={1.5}
                  format={pct}
                  onChange={(v) => updateTvPrefs((pp) => ({ ...pp, sizes: { ...(pp.sizes ?? {}), [tvSelected]: v } }))}
                />
                <Slider
                  label="Opacidad"
                  value={tvAlpha}
                  min={0.2}
                  max={1}
                  format={pct}
                  onChange={(v) => updateTvPrefs((pp) => ({ ...pp, alphas: { ...(pp.alphas ?? {}), [tvSelected]: v } }))}
                />
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.tvGear}>
            <GearButton onPress={openMenu} online={online} />
          </View>
        )}
        {forceController && !tvConnected && !tvEditing ? (
          <Pressable onPress={() => setForceController(false)} style={styles.exitControl}>
            <Text style={styles.exitControlText}>Salir del modo control</Text>
          </Pressable>
        ) : null}
        {menu}
        {guide}
        {controllerScreen}
      </View>
    );
  }

  // Horizontal, o vertical con el pad oculto: barra arriba con margen limpio; debajo, la imagen
  // a todo el área y el pad translúcido encima (gatillos justo bajo la barra)
  if (landscape || !padShown) {
    return (
      <View style={styles.root}>
        <View
          style={styles.flex}
          onLayout={onArea}
          {...(nds && !padShown ? pointerHandlers(fitRect(area.w, area.h, aspect, display.stretch)) : {})}>
          <LibretroView style={StyleSheet.absoluteFill} filter={smooth3d} stretch={display.stretch} />
          {padView(StyleSheet.absoluteFill, nds ? fitRect(area.w, area.h, aspect, display.stretch) : undefined)}
          {notices}
        </View>
        {gear}
        {showTouchChip}
        {editPanel}
        {menu}
        {guide}
        {controllerScreen}
        {airplay}
      </View>
    );
  }

  // Vertical: la imagen ocupa todo el ancho y todo el alto posible hasta justo encima de los
  // gatillos del pad; el pad se queda con el resto (sin franja negra entre ambos).
  const padMin = Math.max(PAD_MIN_PX, area.h * PAD_MIN_FRACTION);
  const maxGameH = Math.max(0, area.h - padMin);
  const gameH = display.stretch ? maxGameH : Math.min(maxGameH, area.w / aspect);
  return (
    <View style={styles.root}>
      <View style={styles.flex} onLayout={onArea}>
        {area.h > 0 ? (
          <>
            <View
              style={{ width: '100%', height: gameH }}
              {...(nds ? pointerHandlers(fitRect(area.w, gameH, aspect, display.stretch)) : {})}>
              <LibretroView style={StyleSheet.absoluteFill} filter={smooth3d} stretch={display.stretch} />
            </View>
            {padView(styles.flex)}
          </>
        ) : null}
        {notices}
      </View>
      {gear}
      {showTouchChip}
      {editPanel}
      {menu}
      {guide}
      {controllerScreen}
      {airplay}
    </View>
  );
}

// Diagnóstico amigable cuando FBNeo / MAME 2003-Plus no aceptan un romset
function ArcadeErrorCard({
  romPath,
  core,
  error,
  onExit,
  onRetry,
}: {
  romPath: string;
  core: CoreId;
  error: string;
  onExit: () => void;
  onRetry?: () => void;
}) {
  const [details, setDetails] = useState(false);
  const name = romPath.split('/').pop() ?? romPath;
  const coreName = core === 'fbneo' ? 'FinalBurn Neo' : 'MAME 2003-Plus';
  const other = core === 'fbneo' ? 'MAME 2003-Plus' : 'FinalBurn Neo';
  const e = error.toLowerCase();
  const causes: string[] = [];
  if (/neogeo|bios/.test(e)) {
    causes.push('Falta la BIOS neogeo.zip o está dañada: cópiala sin descomprimir en arcade/ (o fbneo/), junto a tus juegos.');
  }
  if (/missing|not found|no se encuentr|crc|required|needed|incorrect|bad dump|wrong/.test(e) || /retro_load_game/.test(e)) {
    causes.push(
      `Romset incompleto o de otra versión: ${coreName} necesita el romset completo de su versión. Los ` +
        'romsets Split/Merged no incluyen todos los archivos: descarga la versión Non-Merged completa de FBNeo.',
    );
  }
  if (/driver|unknown|not supported|unsupported/.test(e)) {
    causes.push(`${coreName} no reconoce este juego (no tiene driver para él).`);
  }
  if (/versión modificada|juego original/.test(e)) {
    causes.push('Es una versión modificada (clon): necesita también el romset original en la misma carpeta.');
  }
  if (/pesa solo/.test(e)) causes.push('El archivo está incompleto (descarga cortada): vuelve a descargarlo.');
  if (/^superdbz\.zip$/i.test(name)) {
    causes.unshift(
      'superdbz.zip (Super Dragon Ball Z) es de la placa Namco System 246, basada en PlayStation 2: ni MAME ' +
        '2003-Plus ni FBNeo la emulan. No es un fallo del archivo; ese juego no puede funcionar en estos núcleos.',
    );
  }
  if (!causes.length) causes.push('El núcleo no aceptó el romset.');
  causes.push(
    `Prueba con el otro núcleo (${other}): mantén pulsado el juego en la biblioteca → Cambiar núcleo, o usa el botón de abajo.`,
  );
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.diagBody}>
      <View style={styles.diagCard}>
        <Text style={styles.modalKicker}>DIAGNÓSTICO ARCADE</Text>
        <Text style={styles.diagTitle}>No se pudo abrir {name}</Text>
        <Text style={styles.diagCore}>Núcleo: {coreName}</Text>
        {causes.map((c, i) => (
          <View key={i} style={styles.diagRow}>
            <Text style={styles.diagBullet}>{i + 1}</Text>
            <Text style={styles.diagText}>{c}</Text>
          </View>
        ))}
        <Pressable onPress={() => setDetails((v) => !v)}>
          <Text style={styles.diagToggle}>{details ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}</Text>
        </Pressable>
        {details ? <Text style={styles.diagRaw}>{error}</Text> : null}
        <View style={styles.modalActions}>
          {onRetry ? <HudButton label={`Probar con ${other}`} onPress={onRetry} active /> : null}
          <HudButton label="Volver" onPress={onExit} />
        </View>
      </View>
    </ScrollView>
  );
}

// Nombre corto de la relación de aspecto del core para el botón
function aspectLabel(a: number): string {
  if (Math.abs(a - 4 / 3) < 0.04) return '4:3';
  if (Math.abs(a - 3 / 2) < 0.04) return '3:2';
  if (Math.abs(a - 10 / 9) < 0.04) return '10:9';
  if (Math.abs(a - 16 / 9) < 0.04) return '16:9';
  return 'Aspecto';
}

function HudButton({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, active && styles.buttonActive, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  flex: { flex: 1 },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { color: theme.text, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  hud: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8, backgroundColor: theme.bg },
  hudBar: { flexGrow: 0, height: BAR_H, backgroundColor: theme.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  hudBarContent: { alignItems: 'center', gap: 6, paddingHorizontal: 10 },
  notices: { position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center' },
  button: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  buttonActive: { backgroundColor: theme.amber, borderColor: theme.amber },
  pressed: { opacity: 0.7 },
  buttonText: { color: theme.titaniumHi, fontWeight: '600', fontSize: 13 },
  buttonTextActive: { color: theme.bg },
  notice: { color: theme.amber, textAlign: 'center', paddingBottom: 4 },
  debug: { color: '#ff0', fontSize: 11, paddingHorizontal: 8, paddingBottom: 4 },
  editPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 70,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(21,23,29,0.96)',
    borderWidth: 1,
    borderColor: theme.amber,
  },
  editPanelLandscape: { left: '27%', right: '27%', top: 8, bottom: 8 },
  editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  editCollapse: { color: theme.amber, fontSize: 13, fontWeight: '600' },
  editScroll: { flexGrow: 0, maxHeight: 360 },
  editScrollContent: { paddingBottom: 4 },
  editHint: { color: theme.textDim, fontSize: 12, marginTop: 4, marginBottom: 6 },
  editSection: {
    color: theme.amber,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 2,
  },
  selectedBox: {
    borderWidth: 1,
    borderColor: theme.amber,
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    backgroundColor: 'rgba(212,175,55,0.08)',
  },
  selectedTitle: { color: theme.amber, fontSize: 15, fontWeight: '800' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  toggleLabel: { color: theme.titaniumHi, fontSize: 13, fontWeight: '600' },
  toggle: { width: 46, height: 28, borderRadius: 14, backgroundColor: theme.border, padding: 3 },
  toggleOn: { backgroundColor: theme.amber },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.titaniumHi },
  toggleKnobOn: { transform: [{ translateX: 18 }], backgroundColor: theme.bg },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  panelChip: {
    position: 'absolute',
    top: 70,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(21,23,29,0.95)',
    borderWidth: 1,
    borderColor: theme.amber,
  },
  panelChipLandscape: { top: 8 },
  gearSlot: { position: 'absolute', top: 8, right: 10 },
  guideOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg },
  touchChip: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(13,14,18,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.4)',
  },
  touchChipLandscape: { top: 12, left: 14 },
  touchChipText: { color: theme.titaniumHi, fontSize: 11, fontWeight: '700' },
  tvEditBar: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(21,23,29,0.95)',
    borderWidth: 1,
    borderColor: theme.amber,
  },
  tvEditHint: { flex: 1, color: theme.textDim, fontSize: 11, textAlign: 'center' },
  tvEditPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(21,23,29,0.96)',
    borderWidth: 1,
    borderColor: theme.amber,
  },
  exitControl: {
    position: 'absolute',
    top: 10,
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.amber,
    backgroundColor: 'rgba(13,14,18,0.8)',
  },
  exitControlText: { color: theme.amber, fontSize: 12, fontWeight: '800' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,6,8,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 20,
    padding: 20,
    gap: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.amber,
  },
  modalKicker: { color: theme.amber, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  modalArt: { alignItems: 'center', gap: 6 },
  modalArtLabel: { color: theme.titaniumHi, fontSize: 12, fontWeight: '700' },
  modalText: { color: theme.text, fontSize: 15, lineHeight: 22 },
  modalNote: { color: theme.textDim, fontSize: 12, lineHeight: 17 },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' },
  tvRoot: { backgroundColor: '#07080B', overflow: 'hidden' },
  tvGlow: { position: 'absolute', width: 520, height: 520, borderRadius: 260, opacity: 0.1, alignSelf: 'center', top: '20%' },
  tvLabel: { position: 'absolute', bottom: 6, alignSelf: 'center', color: theme.textDim, fontSize: 11, letterSpacing: 0.6 },
  tvGear: { position: 'absolute', top: 8, alignSelf: 'center' },
  diagBody: { flexGrow: 1, justifyContent: 'center', padding: 20, backgroundColor: theme.bg },
  diagCard: {
    borderRadius: 18,
    padding: 18,
    gap: 10,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: 'rgba(229,103,91,0.6)',
  },
  diagTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
  diagCore: { color: theme.textDim, fontSize: 12 },
  diagRow: { flexDirection: 'row', gap: 10 },
  diagBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 12,
    fontWeight: '900',
    color: theme.bg,
    backgroundColor: theme.amber,
    overflow: 'hidden',
  },
  diagText: { flex: 1, color: theme.text, fontSize: 14, lineHeight: 20 },
  diagToggle: { color: theme.amber, fontWeight: '700', fontSize: 13 },
  diagRaw: { color: theme.textDim, fontSize: 11, lineHeight: 16, fontFamily: 'Menlo' },
  consolePanel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  consoleKicker: { color: theme.amber, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  consoleTitle: { color: theme.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  consolePlayers: { color: '#4ADE80', fontSize: 14, fontWeight: '700' },
  consoleActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 10 },
  gearSlotLandscape: { top: 10, right: 14 },
  airplayNotice: {
    marginHorizontal: 16,
    marginTop: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(13,14,18,0.92)',
    borderWidth: 1,
    borderColor: theme.amber,
    maxWidth: 520,
    alignSelf: 'center',
  },
  airplayText: { color: theme.text, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  airplayClose: { color: theme.amber, fontSize: 12, fontWeight: '800', textAlign: 'center', marginTop: 6 },
  netNotice: {
    color: '#4ADE80',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  panelChipText: { color: theme.amber, fontWeight: '700', fontSize: 13 },
});
