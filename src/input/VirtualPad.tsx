import React, { useEffect, useRef, useState } from 'react';
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
import { evaluateZones, Pt } from './evaluate';
import type { Cluster, PadLayout, Zone } from './layouts';

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

// Entrada táctil con los eventos nativos de React Native (onTouch*), sin gestos de RNGH:
// en cada evento se recalcula el estado completo a partir de todos los dedos activos.
// Es estado puro (sin acumular), así un evento perdido no deja botones pegados.
export function VirtualPad({
  layout,
  style,
  opacity = 1,
  editing = false,
  onMoveCluster,
  pointerRect,
}: {
  layout: PadLayout;
  style?: StyleProp<ViewStyle>;
  opacity?: number;
  /** Modo edición: los toques arrastran controles en vez de pulsarlos. */
  editing?: boolean;
  /** Fin de un arrastre: desplazamiento normalizado al tamaño del pad. */
  onMoveCluster?: (id: string, dx: number, dy: number) => void;
  /** Si se indica, un toque fuera de los botones y sobre la imagen actúa como puntero (NDS). */
  pointerRect?: PointerRect;
}) {
  const pointerDown = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [active, setActive] = useState(0); // máscara pintada (feedback al pulsar)
  const [knob, setKnob] = useState<Knob>({ x: 0, y: 0 }); // posición del puck del stick
  const sizeRef = useRef<Size>({ w: 0, h: 0 });
  const mask = useRef(0);
  const axis = useRef({ x: 0, y: 0 });

  const compute = (touches: Touch[]) => {
    const W = sizeRef.current.w;
    const H = sizeRef.current.h;
    if (W <= 0 || H <= 0) return;

    let bits = 0;
    let ax = 0;
    let ay = 0;
    // Toques que caen en algún cluster: el resto puede ser el stylus
    const used = new Set<string | number>();
    let stickPts = 0;
    let kx = 0;
    let ky = 0;
    for (const c of layout.clusters) {
      const cx = c.x * W;
      const cy = c.y * H;
      const cw = c.w * W;
      const ch = c.h * H;
      // Puntos dentro de este cluster, en px relativos a él
      const pts: Pt[] = [];
      for (const t of touches) {
        const px = t.locationX - cx;
        const py = t.locationY - cy;
        if (px >= 0 && px <= cw && py >= 0 && py <= ch) {
          pts.push({ x: px, y: py });
          used.add(t.identifier);
        }
      }
      const r = evaluateZones(c.zones, pts, cw, ch);
      bits |= r.bits;
      if (c.zones.some((z: Zone) => z.kind === 'stick')) {
        ax = r.ax;
        ay = r.ay;
        kx = r.kx;
        ky = r.ky;
        stickPts = pts.length;
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
        Libretro.setPointer(
          ((t.locationX - pointerRect.x) / pointerRect.w) * 2 - 1,
          ((t.locationY - pointerRect.y) / pointerRect.h) * 2 - 1,
          true,
        );
      } else if (pointerDown.current) {
        pointerDown.current = false;
        Libretro.setPointer(0, 0, false);
      }
    }

    padDebugText =
      `pad: toques=${touches.length} ` +
      touches.map((t) => `(${Math.round(t.locationX)},${Math.round(t.locationY)})`).join(' ') +
      ` W=${Math.round(W)} H=${Math.round(H)} enStick=${stickPts}`;

    if (bits !== mask.current) {
      mask.current = bits;
      Libretro.setButtons(bits);
      setActive(bits);
    }
    if (ax !== axis.current.x || ay !== axis.current.y) {
      axis.current = { x: ax, y: ay };
      Libretro.setAnalog(ax, ay);
    }
    setKnob((k) => (k.x === kx && k.y === ky ? k : { x: kx, y: ky }));
  };

  // ---- Modo edición: arrastrar clusters --------------------------------------
  const clusterAt = (x: number, y: number): Cluster | undefined => {
    const W = sizeRef.current.w;
    const H = sizeRef.current.h;
    // El último dibujado está encima
    for (let i = layout.clusters.length - 1; i >= 0; i--) {
      const c = layout.clusters[i];
      if (x >= c.x * W && x <= (c.x + c.w) * W && y >= c.y * H && y <= (c.y + c.h) * H) return c;
    }
    return undefined;
  };
  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const editStart = (e: GestureResponderEvent) => {
    if (dragRef.current) return;
    const t = (e.nativeEvent.changedTouches as Touch[])[0];
    const c = t && clusterAt(t.locationX, t.locationY);
    if (c) setDragBoth({ id: c.id, touchId: t.identifier, x0: t.pageX, y0: t.pageY, dx: 0, dy: 0 });
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
    if (d.dx !== 0 || d.dy !== 0) onMoveCluster?.(d.id, d.dx / W, d.dy / H);
    setDragBoth(null);
  };

  // Al entrar en edición se sueltan todos los botones
  useEffect(() => {
    if (!editing) return;
    mask.current = 0;
    axis.current = { x: 0, y: 0 };
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
      {layout.clusters.map((c) => (
        <ClusterView
          key={c.id}
          cluster={c}
          size={size}
          active={active}
          knob={knob}
          opacity={opacity}
          editing={editing}
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
  dragging,
  offset,
}: {
  cluster: Cluster;
  size: Size;
  active: number;
  knob: Knob;
  opacity: number;
  editing: boolean;
  dragging: boolean;
  offset?: { x: number; y: number };
}) {
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
          opacity,
        },
        offset ? { transform: [{ translateX: offset.x }, { translateY: offset.y }] } : null,
        editing && styles.clusterEditing,
        dragging && styles.clusterDragging,
      ]}>
      {cluster.zones.map((z, i) => (
        <ZoneView
          key={i}
          zone={z}
          w={size.w * cluster.w}
          h={size.h * cluster.h}
          active={active}
          knob={knob}
        />
      ))}
    </View>
  );
}

// Un botón está pulsado si todos sus bits están en la máscara activa
function isPressed(zone: { bits: number }, active: number): boolean {
  return zone.bits !== 0 && (active & zone.bits) === zone.bits;
}

function ZoneView({
  zone,
  w,
  h,
  active,
  knob,
}: {
  zone: Zone;
  w: number;
  h: number;
  active: number;
  knob: Knob;
}) {
  if (w <= 0) return null; // esperar al primer layout
  const m = Math.min(w, h);

  if (zone.kind === 'button') {
    const pressed = isPressed(zone, active);
    const tint = zone.tint ?? 'rgba(255,255,255,0.25)';
    const common = [
      styles.key,
      { borderColor: tint },
      pressed && styles.keyPressed,
    ];
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
          <Text style={styles.label}>{zone.label}</Text>
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
        <Text style={styles.label}>{zone.label}</Text>
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
        <Text style={styles.arrow}>✚</Text>
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
  cluster: { position: 'absolute' },
  // Modo edición: contorno ámbar discontinuo para ver qué se puede arrastrar
  clusterEditing: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.amber,
    borderRadius: 10,
    backgroundColor: 'rgba(212,175,55,0.06)',
  },
  clusterDragging: { borderStyle: 'solid', backgroundColor: 'rgba(212,175,55,0.18)' },
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
