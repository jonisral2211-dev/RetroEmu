import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Libretro } from 'react-native-libretro';
import { Btn } from '../emulator/buttons';
import { theme } from '../theme';
import { buildPad } from './buildPad';
import { evaluateZones, Pt, Tuning } from './evaluate';
import type { Cluster, PadLayout, Zone } from './layouts';
import type { Feel, PadPrefs } from './padPrefs';

type Size = { w: number; h: number };
/** Rectángulo de la imagen del juego en px relativos al pad (para el puntero táctil). */
export type PointerRect = { x: number; y: number; w: number; h: number };
type Touch = { identifier: string | number; locationX: number; locationY: number; pageX: number; pageY: number };
type Knob = { x: number; y: number }; // desplazamiento normalizado del stick [-1, 1]
// Arrastre en modo edición: desplazamiento en px desde el inicio del toque
type Drag = { id: string; touchId: string | number; x0: number; y0: number; dx: number; dy: number };

// Diagnóstico del último cálculo (se muestra en el panel Debug de PlayerScreen)
let padDebugText = '';
export function getPadDebug(): string {
  return padDebugText;
}

const isAnalog = (c: Cluster) => c.zones[0]?.kind === 'stick' || c.zones[0]?.kind === 'dpad';
// Un dedo que empezó en el stick o la cruceta lo sigue controlando hasta 3 radios de distancia
const ANALOG_KEEP = 3;

/**
 * Distancia normalizada del toque al control (1 = borde del dibujo). Para elegir el control
 * más cercano cuando las áreas de detección se solapan.
 */
function distanceTo(c: Cluster, x: number, y: number, W: number, H: number): number {
  const cx = (c.x + c.w / 2) * W;
  const cy = (c.y + c.h / 2) * H;
  const w = c.w * W * (c.vis ?? 1);
  const h = c.h * H * (c.vis ?? 1);
  const z = c.zones[0];
  if (z?.kind === 'button' && z.shape === 'rect') {
    return Math.max(Math.abs(x - cx) / (w / 2), Math.abs(y - cy) / (h / 2));
  }
  const r = Math.min(w, h) / 2;
  return Math.hypot(x - cx, y - cy) / r;
}

// Entrada táctil con los eventos nativos de React Native (onTouch*): en cada evento se
// recalcula el estado completo a partir de todos los dedos activos (estado puro: un evento
// perdido no deja botones pegados). Cada dedo pertenece a un control: el del stick no se
// pierde al salirse del círculo y un dedo puede deslizar de un botón a otro.
export function VirtualPad({
  layout,
  prefs,
  feel,
  style,
  opacity = 1,
  editing = false,
  selectedId,
  onSelect,
  onMoveControl,
  pointerRect,
  pointerBottom = false,
  trackpadLabel,
}: {
  /** Layout por grupos (consola + modo direccional); aquí se divide en botones sueltos. */
  layout: PadLayout;
  prefs: PadPrefs;
  feel: Feel;
  style?: StyleProp<ViewStyle>;
  opacity?: number;
  /** Modo edición: los toques seleccionan y arrastran controles en vez de pulsarlos. */
  editing?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Fin de un arrastre: desplazamiento normalizado al tamaño del pad. */
  onMoveControl?: (id: string, dx: number, dy: number) => void;
  /** Si se indica, un toque fuera de los botones y sobre la imagen actúa como puntero (NDS). */
  pointerRect?: PointerRect;
  /** El rectángulo del puntero representa solo la pantalla inferior de la DS (trackpad en TV). */
  pointerBottom?: boolean;
  /** Dibuja el rectángulo del puntero como trackpad con este texto. */
  trackpadLabel?: string;
}) {
  const stickEdge = useRef(false);
  const pointerDown = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [active, setActive] = useState(0); // máscara pintada (feedback al pulsar)
  const [knob, setKnob] = useState<Knob>({ x: 0, y: 0 }); // posición del puck del stick
  const sizeRef = useRef<Size>({ w: 0, h: 0 });
  const mask = useRef(0);
  const axis = useRef({ x: 0, y: 0 });
  const owners = useRef(new Map<string | number, string>());

  const pad = useMemo(() => buildPad(layout, prefs, size.w, size.h), [layout, prefs, size.w, size.h]);
  const padRef = useRef(pad);
  padRef.current = pad;
  const tuning: Tuning = { sensitivity: feel.sensitivity, deadzone: feel.deadzone, hitSlop: feel.hitSlop };
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;
  const hapticsRef = useRef(feel.haptics);
  hapticsRef.current = feel.haptics;

  // Control al que pertenece un dedo: se conserva el stick/cruceta; si no, el más cercano
  const ownerOf = (t: Touch, byId: Map<string, Cluster>, W: number, H: number): Cluster | undefined => {
    const prev = owners.current.get(t.identifier);
    const prevC = prev ? byId.get(prev) : undefined;
    if (prevC && isAnalog(prevC) && distanceTo(prevC, t.locationX, t.locationY, W, H) <= ANALOG_KEEP) {
      return prevC;
    }
    const slop = tuningRef.current.hitSlop;
    let best: Cluster | undefined;
    let bestD = Infinity;
    for (const c of padRef.current.clusters) {
      const d = distanceTo(c, t.locationX, t.locationY, W, H);
      const limit = isAnalog(c) ? 1 / (c.vis ?? 1) : slop; // stick/cruceta: todo su cluster
      if (d <= limit && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  };

  const compute = (touches: Touch[]) => {
    const W = sizeRef.current.w;
    const H = sizeRef.current.h;
    if (W <= 0 || H <= 0) return;
    const clusters = padRef.current.clusters;
    const byId = new Map(clusters.map((c) => [c.id, c]));

    // Reparto de dedos entre controles
    const live = new Set(touches.map((t) => t.identifier));
    for (const k of [...owners.current.keys()]) if (!live.has(k)) owners.current.delete(k);
    const ptsBy = new Map<string, Pt[]>();
    const used = new Set<string | number>();
    for (const t of touches) {
      const c = ownerOf(t, byId, W, H);
      if (!c) {
        owners.current.delete(t.identifier);
        continue;
      }
      owners.current.set(t.identifier, c.id);
      used.add(t.identifier);
      const list = ptsBy.get(c.id) ?? [];
      list.push({ x: t.locationX - c.x * W, y: t.locationY - c.y * H });
      ptsBy.set(c.id, list);
    }

    let bits = 0;
    let ax = 0;
    let ay = 0;
    let kx = 0;
    let ky = 0;
    for (const c of clusters) {
      const pts = ptsBy.get(c.id);
      if (!pts) continue;
      // El área ampliada ya se aplicó al elegir el control: dentro de él cuenta todo el botón
      const r = evaluateZones(c.zones, pts, c.w * W, c.h * H, { ...tuningRef.current, hitSlop: Math.max(1, tuningRef.current.hitSlop) * 1.5 });
      bits |= r.bits;
      if (c.zones[0]?.kind === 'stick') {
        ax = r.ax;
        ay = r.ay;
        kx = r.kx;
        ky = r.ky;
      }
    }

    if (pointerRect && pointerRect.w > 0 && pointerRect.h > 0) {
      const t = touches.find(
        (tt) =>
          !used.has(tt.identifier) &&
          tt.locationX >= pointerRect.x &&
          tt.locationX <= pointerRect.x + pointerRect.w &&
          tt.locationY >= pointerRect.y &&
          tt.locationY <= pointerRect.y + pointerRect.h,
      );
      if (t) {
        pointerDown.current = true;
        const v = (t.locationY - pointerRect.y) / pointerRect.h;
        Libretro.setPointer(
          ((t.locationX - pointerRect.x) / pointerRect.w) * 2 - 1,
          // Pantallas apiladas: la inferior ocupa la mitad de abajo del frame ([0, 1])
          pointerBottom ? v : v * 2 - 1,
          true,
        );
      } else if (pointerDown.current) {
        pointerDown.current = false;
        Libretro.setPointer(0, 0, false);
      }
    }

    padDebugText =
      `pad: toques=${touches.length} ` +
      touches.map((t) => `(${Math.round(t.locationX)},${Math.round(t.locationY)})→${owners.current.get(t.identifier) ?? '-'}`).join(' ') +
      ` W=${Math.round(W)} H=${Math.round(H)}`;

    if (bits !== mask.current) {
      // Vibración solo al pulsar un botón nuevo (no al soltar ni al mantener)
      if (hapticsRef.current && (bits & ~mask.current) !== 0) Libretro.haptic(0.5);
      mask.current = bits;
      Libretro.setButtons(bits);
      setActive(bits);
    }
    if (ax !== axis.current.x || ay !== axis.current.y) {
      axis.current = { x: ax, y: ay };
      Libretro.setAnalog(ax, ay);
    }
    setKnob((k) => (k.x === kx && k.y === ky ? k : { x: kx, y: ky }));
    // Vibración suave al llevar el stick al tope
    const edge = kx * kx + ky * ky > 0.94;
    if (edge && !stickEdge.current && hapticsRef.current) Libretro.haptic(0.3);
    stickEdge.current = edge;
  };

  // ---- Modo edición: tocar selecciona, arrastrar mueve ----------------------------
  const controlAt = (x: number, y: number): Cluster | undefined => {
    const W = sizeRef.current.w;
    const H = sizeRef.current.h;
    let best: Cluster | undefined;
    let bestD = Infinity;
    for (const c of padRef.current.clusters) {
      const d = distanceTo(c, x, y, W, H);
      if (d <= 1.25 && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  };
  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const editStart = (e: GestureResponderEvent) => {
    if (dragRef.current) return;
    const t = (e.nativeEvent.changedTouches as Touch[])[0];
    const c = t && controlAt(t.locationX, t.locationY);
    if (!c) return;
    onSelect?.(c.id);
    setDragBoth({ id: c.id, touchId: t.identifier, x0: t.pageX, y0: t.pageY, dx: 0, dy: 0 });
  };
  const editMove = (e: GestureResponderEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const t = (e.nativeEvent.touches as Touch[]).find((tt) => tt.identifier === d.touchId);
    if (t) setDragBoth({ ...d, dx: t.pageX - d.x0, dy: t.pageY - d.y0 });
  };
  const editEnd = (e: GestureResponderEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const ended = (e.nativeEvent.changedTouches as Touch[]).some((tt) => tt.identifier === d.touchId);
    if (!ended) return;
    const W = sizeRef.current.w || 1;
    const H = sizeRef.current.h || 1;
    // Un toque sin mover (< 4 px) solo selecciona
    if (Math.hypot(d.dx, d.dy) >= 4) onMoveControl?.(d.id, d.dx / W, d.dy / H);
    setDragBoth(null);
  };

  // Al entrar en edición se sueltan todos los botones
  useEffect(() => {
    if (!editing) return;
    mask.current = 0;
    axis.current = { x: 0, y: 0 };
    owners.current.clear();
    Libretro.setButtons(0);
    Libretro.setAnalog(0, 0);
    setActive(0);
    setKnob({ x: 0, y: 0 });
  }, [editing]);

  // Al levantar dedos, excluir los que terminan en este evento
  const remaining = (e: GestureResponderEvent): Touch[] => {
    const ended = new Set((e.nativeEvent.changedTouches as Touch[]).map((t) => t.identifier));
    return (e.nativeEvent.touches as Touch[]).filter((t) => !ended.has(t.identifier));
  };

  // Al desmontar (cambio de consola o salida) soltamos todo
  useEffect(
    () => () => {
      Libretro.setButtons(0);
      Libretro.setAnalog(0, 0);
      Libretro.setPointer(0, 0, false);
    },
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { w: width, h: height };
    setSize({ w: width, h: height });
  };

  return (
    <View
      onLayout={onLayout}
      onTouchStart={(e) => (editing ? editStart(e) : compute(e.nativeEvent.touches as Touch[]))}
      onTouchMove={(e) => (editing ? editMove(e) : compute(e.nativeEvent.touches as Touch[]))}
      onTouchEnd={(e) => (editing ? editEnd(e) : compute(remaining(e)))}
      onTouchCancel={(e) => (editing ? editEnd(e) : compute(remaining(e)))}
      style={[styles.pad, style]}>
      {trackpadLabel && pointerRect && pointerRect.w > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.trackpad,
            { left: pointerRect.x, top: pointerRect.y, width: pointerRect.w, height: pointerRect.h },
          ]}>
          <Text style={styles.trackpadText}>{trackpadLabel}</Text>
        </View>
      ) : null}
      {pad.clusters.map((c) => (
        <ClusterView
          key={c.id}
          cluster={c}
          size={size}
          active={active}
          knob={knob}
          opacity={opacity}
          editing={editing}
          selected={editing && selectedId === c.id}
          dragging={drag?.id === c.id}
          offset={drag?.id === c.id ? { x: drag.dx, y: drag.dy } : undefined}
        />
      ))}
    </View>
  );
}

function ClusterView({
  cluster,
  size,
  active,
  knob,
  opacity,
  editing,
  selected,
  dragging,
  offset,
}: {
  cluster: Cluster;
  size: Size;
  active: number;
  knob: Knob;
  opacity: number;
  editing: boolean;
  selected: boolean;
  dragging: boolean;
  offset?: { x: number; y: number };
}) {
  // En edición el contorno rodea solo el dibujo (sin el margen táctil del stick)
  const inset = ((1 - (cluster.vis ?? 1)) / 2) * 100;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.cluster,
        {
          left: `${cluster.x * 100}%`,
          top: `${cluster.y * 100}%`,
          width: `${cluster.w * 100}%`,
          height: `${cluster.h * 100}%`,
          opacity: editing ? Math.max(opacity, 0.6) : opacity,
        },
        offset ? { transform: [{ translateX: offset.x }, { translateY: offset.y }] } : null,
      ]}>
      {editing ? (
        <View
          style={[
            styles.editFrame,
            { left: `${inset}%`, top: `${inset}%`, right: `${inset}%`, bottom: `${inset}%` },
            selected && styles.editFrameSelected,
            dragging && styles.editFrameDragging,
          ]}
        />
      ) : null}
      {cluster.zones.map((z, i) => (
        <ZoneView key={i} zone={z} w={size.w * cluster.w} h={size.h * cluster.h} active={active} knob={knob} />
      ))}
    </View>
  );
}

// Un botón está pulsado si todos sus bits están en la máscara activa
function isPressed(zone: { bits: number }, active: number): boolean {
  return zone.bits !== 0 && (active & zone.bits) === zone.bits;
}

function ZoneView({ zone, w, h, active, knob }: { zone: Zone; w: number; h: number; active: number; knob: Knob }) {
  if (w <= 0) return null; // esperar al primer layout
  const m = Math.min(w, h);

  if (zone.kind === 'button') {
    const pressed = isPressed(zone, active);
    const tint = zone.tint ?? 'rgba(255,255,255,0.25)';
    const common = [styles.key, { borderColor: tint }, pressed && styles.keyPressed];
    // Texto proporcional al botón (los botones redimensionados no quedan con letras diminutas)
    const fontSize = Math.max(9, Math.min(18, (zone.shape === 'rect' ? Math.min(zone.h * h, zone.w * w / 3) : zone.w * m) * 0.36));
    if (zone.shape === 'rect') {
      return (
        <View
          pointerEvents="none"
          style={[
            common,
            {
              left: zone.x * w,
              top: zone.y * h,
              width: zone.w * w,
              height: zone.h * h,
              transform: [{ scale: pressed ? 0.92 : 1 }],
            },
          ]}>
          <Text style={[styles.label, { fontSize }]}>{zone.label}</Text>
        </View>
      );
    }
    const d = zone.w * m;
    return (
      <View
        pointerEvents="none"
        style={[
          common,
          styles.round,
          {
            left: zone.x * w - d / 2,
            top: zone.y * h - d / 2,
            width: d,
            height: d,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          },
        ]}>
        <Text style={[styles.label, { fontSize }]}>{zone.label}</Text>
      </View>
    );
  }

  if (zone.kind === 'dpad') {
    const d = 2 * zone.r * m;
    const pressed = (active & (Btn.UP | Btn.DOWN | Btn.LEFT | Btn.RIGHT)) !== 0;
    return (
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          styles.round,
          pressed && styles.ringPressed,
          { left: zone.cx * w - d / 2, top: zone.cy * h - d / 2, width: d, height: d },
        ]}>
        <Text style={[styles.arrow, { fontSize: Math.max(14, d * 0.3) }]}>✚</Text>
      </View>
    );
  }

  // Stick 3D: base cóncava translúcida + puck que sigue el pulgar dentro del radio
  const baseD = 2 * zone.r * m;
  const puckD = baseD * 0.5;
  const travel = baseD / 2 - puckD / 2; // desplazamiento máximo del centro del puck
  return (
    <View
      pointerEvents="none"
      style={[
        styles.stickBase,
        styles.round,
        { left: zone.cx * w - baseD / 2, top: zone.cy * h - baseD / 2, width: baseD, height: baseD },
      ]}>
      <View
        style={[
          styles.puck,
          styles.round,
          {
            width: puckD,
            height: puckD,
            left: baseD / 2 - puckD / 2 + knob.x * travel,
            top: baseD / 2 - puckD / 2 + knob.y * travel,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { position: 'relative', width: '100%' },
  trackpad: {
    position: 'absolute',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(56,189,248,0.6)',
    backgroundColor: 'rgba(56,189,248,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackpadText: { color: 'rgba(186,230,253,0.8)', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  cluster: { position: 'absolute' },
  // Modo edición: contorno ámbar discontinuo en cada control; el seleccionado, dorado y sólido
  editFrame: {
    position: 'absolute',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(212,175,55,0.7)',
    borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.05)',
  },
  editFrameSelected: {
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: theme.amber,
    backgroundColor: 'rgba(212,175,55,0.16)',
    shadowColor: theme.amber,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  editFrameDragging: { backgroundColor: 'rgba(212,175,55,0.28)' },
  // Botón translúcido con relieve: borde claro arriba, sombra abajo
  key: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderTopColor: 'rgba(255,255,255,0.75)',
    borderBottomColor: 'rgba(0,0,0,0.5)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  keyPressed: { backgroundColor: 'rgba(255,255,255,0.4)' },
  round: { borderRadius: 999 },
  label: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 12, textShadowColor: '#000', textShadowRadius: 3 },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPressed: { backgroundColor: 'rgba(255,255,255,0.2)' },
  arrow: { color: 'rgba(255,255,255,0.5)', fontSize: 18 },
  // Base del stick: fondo oscuro translúcido con borde biselado
  stickBase: {
    position: 'absolute',
    borderWidth: 2,
    borderTopColor: 'rgba(255,255,255,0.2)',
    borderBottomColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  // Puck: relieve con sombra proyectada
  puck: {
    position: 'absolute',
    borderWidth: 2,
    borderTopColor: 'rgba(255,255,255,0.8)',
    borderBottomColor: 'rgba(0,0,0,0.4)',
    backgroundColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
});
