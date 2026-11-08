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
import { evaluateZones, Pt } from './evaluate';
import type { Cluster, PadLayout, Zone } from './layouts';

type Size = { w: number; h: number };
type Touch = { identifier: string | number; locationX: number; locationY: number };
type Knob = { x: number; y: number }; // desplazamiento normalizado del stick [-1, 1]

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
}: {
  layout: PadLayout;
  style?: StyleProp<ViewStyle>;
  opacity?: number;
}) {
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
    let stickPts = 0;
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
        if (px >= 0 && px <= cw && py >= 0 && py <= ch) pts.push({ x: px, y: py });
      }
      const r = evaluateZones(c.zones, pts, cw, ch);
      bits |= r.bits;
      if (c.zones.some((z: Zone) => z.kind === 'stick')) {
        ax = r.ax;
        ay = r.ay;
        stickPts = pts.length;
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
      setKnob({ x: ax, y: ay });
    }
  };

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
      onTouchStart={(e) => compute(e.nativeEvent.touches as Touch[])}
      onTouchMove={(e) => compute(e.nativeEvent.touches as Touch[])}
      onTouchEnd={(e) => compute(remaining(e))}
      onTouchCancel={(e) => compute(remaining(e))}
      style={[styles.pad, style, { opacity }]}>
      {layout.clusters.map((c) => (
        <ClusterView key={c.id} cluster={c} size={size} active={active} knob={knob} />
      ))}
    </View>
  );
}

function ClusterView({
  cluster,
  size,
  active,
  knob,
}: {
  cluster: Cluster;
  size: Size;
  active: number;
  knob: Knob;
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
        },
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
    const tint = zone.tint ?? '#ffffff';
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
  // Botón translúcido con relieve: borde claro arriba, sombra abajo
  key: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderTopColor: 'rgba(255,255,255,0.75)',
    borderBottomColor: 'rgba(0,0,0,0.5)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  keyPressed: { backgroundColor: 'rgba(255,255,255,0.4)' },
  round: { borderRadius: 999 },
  label: { color: '#fff', fontWeight: '700', fontSize: 12, textShadowColor: '#000', textShadowRadius: 3 },
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
