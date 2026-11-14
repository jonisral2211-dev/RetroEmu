import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
import { getPadDebug, PointerRect, VirtualPad } from '../input/VirtualPad';
import { useGamepadStatus } from '../input/useGamepadStatus';
import { theme } from '../theme';
import { Slider } from '../ui/Slider';

type Props = { romPath: string; coreOverride?: CoreId; onExit: () => void };

// Ranuras de guardado. Un mismo juego abierto con otro núcleo (FBNeo vs MAME, DeSmuME vs
// melonDS) usa ranuras propias: sus estados no son compatibles entre núcleos.
function slotsFor(core: CoreId | null): { save: number; auto: number } {
  const alt = core === 'fbneo' || core === 'desmume';
  return alt ? { save: 1, auto: 98 } : { save: 0, auto: 99 };
}

const isNdsCore = (c: CoreId | null) => c === 'melonds' || c === 'desmume';

// Disposición de las dos pantallas de DS: apiladas en vertical, lado a lado en horizontal
function setNdsLayout(landscape: boolean) {
  Libretro.setCoreOption('melonds_screen_layout', landscape ? 'Left/Right' : 'Top/Bottom');
  Libretro.setCoreOption('desmume_screens_layout', landscape ? 'left/right' : 'top/bottom');
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

const DIR_LABEL: Record<DirMode, string> = { stick: 'Stick', dpad: 'D-Pad', both: 'Stick + D-Pad' };
const NEXT_DIR: Record<DirMode, DirMode> = { stick: 'dpad', dpad: 'both', both: 'stick' };

export default function PlayerScreen({ romPath, coreOverride, onExit }: Props) {
  // Consola por contenido verificado (nativo), no por extensión; en arcade, el núcleo elegido
  const baseCore = useMemo(
    () => coreOverride ?? coreForConsole(Libretro.consoleOf(romPath)),
    [romPath, coreOverride],
  );
  // Núcleo que realmente arrancó (NDS: DeSmuME si melonDS no pudo)
  const [loadedCore, setLoadedCore] = useState<CoreId | null>(null);
  const core = loadedCore ?? baseCore;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [touchOverride, setTouchOverride] = useState<boolean | null>(null);
  useEffect(() => setTouchOverride(null), [pad.dualSense]);
  const touchVisible = editing || (touchOverride ?? !pad.dualSense);

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
    // Opciones que el core lee al cargar el juego
    if (isNdsCore(baseCore)) setNdsLayout(landscapeRef.current);
    let started: CoreId | null = null;
    const errors: string[] = [];
    for (const candidate of [baseCore, FALLBACK_CORE[baseCore]]) {
      if (!candidate) continue;
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
    // Reanuda donde se dejó (si hay auto-guardado de la última salida)
    Libretro.loadState(slots.auto);
    Libretro.start();
    setLoadedCore(started);
    setReady(true);
    return () => {
      // Auto-guardado al salir, mientras el core aún corre; luego para y persiste la SRAM
      Libretro.saveState(slots.auto);
      Libretro.stop();
      Libretro.unloadGame();
    };
  }, [romPath, baseCore]);

  // DS: al girar el iPhone las pantallas pasan de apiladas a lado a lado (en caliente)
  useEffect(() => {
    if (ready && isNdsCore(core)) setNdsLayout(landscape);
  }, [ready, core, landscape]);

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

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    Libretro.setPaused(next);
  };

  // Editar controles pausa el juego; al salir se restaura el estado de pausa anterior
  const toggleEditing = () => {
    const next = !editing;
    setEditing(next);
    setSelectedId(null);
    setPanelCollapsed(false);
    Libretro.setPaused(next || paused);
  };

  if (error || !ready || !core) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{error ?? 'Cargando…'}</Text>
        <Pressable onPress={onExit} style={styles.button}>
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const dirMode: DirMode = padPrefs.dirMode ?? defaultDirMode(core);
  const padLayout = withDirMode(layoutFor(core, genesisSix, landscape), dirMode);
  const smooth3d = core === 'mupen64' || core === 'pcsx' || core === 'ppsspp';

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

  const hudButtons = (
    <>
      <HudButton label="Salir" onPress={onExit} />
      <HudButton label={paused ? 'Reanudar' : 'Pausa'} onPress={togglePause} />
      <HudButton label="Editar controles" onPress={toggleEditing} active={editing} />
      <HudButton
        label={DIR_LABEL[dirMode]}
        onPress={() => updatePadPrefs((p) => ({ ...p, dirMode: NEXT_DIR[dirMode] }))}
      />
      <HudButton label={display.stretch ? 'Expandir pantalla' : `${aspectLabel(aspect)} Original`} onPress={toggleStretch} />
      {core === 'pcsx' ? (
        <HudButton label={ps1Hd ? '2x HD' : '1x Fluido'} onPress={togglePs1Hd} active={ps1Hd} />
      ) : null}
      {core === 'genesis' ? (
        <HudButton label={genesisSix ? '6 btn' : '3 btn'} onPress={() => setGenesisSix((v) => !v)} />
      ) : null}
      <HudButton
        label={touchVisible ? 'Ocultar pad' : 'Mostrar pad'}
        onPress={() => setTouchOverride(!touchVisible)}
      />
      <HudButton
        label="Guardar"
        onPress={() => flash(Libretro.saveState(slotsFor(core).save) ? 'Estado guardado' : 'Error al guardar')}
      />
      <HudButton
        label="Cargar"
        onPress={() => flash(Libretro.loadState(slotsFor(core).save) ? 'Estado cargado' : 'Sin estado guardado')}
      />
      <HudButton label={debugOn ? 'Ocultar debug' : 'Debug'} onPress={() => setDebugOn((v) => !v)} />
    </>
  );
  // Horizontal: una fila desplazable de alto fijo (no tapa gatillos ni juego).
  // Vertical: los botones se reparten en varias filas.
  const hud = landscape ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.hudBar}
      contentContainerStyle={styles.hudBarContent}>
      {hudButtons}
    </ScrollView>
  ) : (
    <View style={styles.hud}>{hudButtons}</View>
  );

  // Avisos flotando sobre la imagen (no desplazan el layout)
  const notices = (
    <View style={styles.notices} pointerEvents="none">
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {debugOn && debugText ? <Text style={styles.debug}>{debugText}</Text> : null}
      {pad.connected && pad.dualSense ? (
        <Text style={styles.notice}>DualSense conectado: {pad.name || 'PS5'}</Text>
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

  const nds = isNdsCore(core);
  const padView = (style: object, pointerRect?: PointerRect) =>
    touchVisible ? (
      <VirtualPad
        key={`${padLayout.name}:${dirMode}`}
        layout={padLayout}
        prefs={padPrefs}
        feel={feel}
        style={style}
        opacity={padPrefs.opacity}
        editing={editing}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMoveControl={moveControl}
        pointerRect={pointerRect}
      />
    ) : null;

  // Horizontal, o vertical con el pad oculto: barra arriba con margen limpio; debajo, la imagen
  // a todo el área y el pad translúcido encima (gatillos justo bajo la barra)
  if (landscape || !touchVisible) {
    return (
      <View style={styles.root}>
        {hud}
        <View
          style={styles.flex}
          onLayout={onArea}
          {...(nds && !touchVisible ? pointerHandlers(fitRect(area.w, area.h, aspect, display.stretch)) : {})}>
          <LibretroView style={StyleSheet.absoluteFill} filter={smooth3d} stretch={display.stretch} />
          {padView(StyleSheet.absoluteFill, nds ? fitRect(area.w, area.h, aspect, display.stretch) : undefined)}
          {notices}
        </View>
        {editPanel}
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
      {hud}
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
      {editPanel}
    </View>
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
  editPanelLandscape: { left: '27%', right: '27%', top: BAR_H + 8, bottom: 8 },
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
  panelChipLandscape: { top: BAR_H + 8 },
  panelChipText: { color: theme.amber, fontWeight: '700', fontSize: 13 },
});
