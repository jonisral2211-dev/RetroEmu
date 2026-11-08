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
import { evaluateZones, Pt } from './evaluate';
import type { Cluster, PadLayout, Zone } from './layouts';

type Size = { w: number; h: number };
type Touch = { identifier: string | number; locationX: number; locationY: number };

// Entrada táctil con los eventos nativos de React Native (onTouch*), sin gestos de RNGH:
// en cada evento se recalcula el estado completo a partir de todos los dedos activos.
// Es estado puro (sin acumular), así un evento perdido no deja botones pegados.
// Diagnóstico del último cálculo (se muestra en el panel Debug de PlayerScreen)
let padDebugText = '';
export function getPadDebug(): string {
  return padDebugText;
}

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
      if (c.zones.some((z: Zone) => z.kind === 'stick')) stickPts = pts.length;
      if (c.zones.some((z: Zone) => z.kind === 'stick')) {
        ax = r.ax;
        ay = r.ay;
      }
    }

    padDebugText =
      `pad: toques=${touches.length} ` +
      touches.map((t) => `(${Math.round(t.locationX)},${Math.round(t.locationY)})`).join(' ') +
      ` W=${Math.round(W)} H=${Math.round(H)} enStick=${stickPts}`;

    if (bits !== mask.current) {
      mask.current = bits;
      Libretro.setButtons(bits);
    }
    if (ax !== axis.current.x || ay !== axis.current.y) {
      axis.current = { x: ax, y: ay };
      Libretro.setAnalog(ax, ay);
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
        <ClusterView key={c.id} cluster={c} size={size} />
      ))}
    </View>
  );
}

function ClusterView({ cluster, size }: { cluster: Cluster; size: Size }) {
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
        <ZoneView key={i} zone={z} w={size.w * cluster.w} h={size.h * cluster.h} />
      ))}
    </View>
  );
}

function ZoneView({ zone, w, h }: { zone: Zone; w: number; h: number }) {
  if (w <= 0) return null; // esperar al primer layout
  const m = Math.min(w, h);

  if (zone.kind === 'button') {
    if (zone.shape === 'rect') {
      return (
        <View
          pointerEvents="none"
          style={[
            styles.key,
            {
              left: zone.x * w,
              top: zone.y * h,
              width: zone.w * w,
              height: zone.h * h,
              borderColor: zone.tint,
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
          styles.key,
          styles.round,
          {
            left: zone.x * w - d / 2,
            top: zone.y * h - d / 2,
            width: d,
            height: d,
            borderColor: zone.tint,
          },
        ]}>
        <Text style={styles.label}>{zone.label}</Text>
      </View>
    );
  }

  const d = 2 * zone.r * m;
  const left = zone.cx * w - d / 2;
  const top = zone.cy * h - d / 2;

  if (zone.kind === 'dpad') {
    return (
      <View
        pointerEvents="none"
        style={[styles.ring, styles.round, { left, top, width: d, height: d }]}>
        <Text style={styles.arrow}>✚</Text>
      </View>
    );
  }

  return (
    <View
      pointerEvents="none"
      style={[styles.ring, styles.round, { left, top, width: d, height: d }]}>
      <View style={styles.stickKnob} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { position: 'relative', width: '100%' },
  cluster: { position: 'absolute' },
  key: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
  },
  round: { borderRadius: 999 },
  label: { color: '#fff', fontWeight: '700', fontSize: 12 },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: { color: 'rgba(255,255,255,0.5)', fontSize: 18 },
  stickKnob: {
    width: '40%',
    height: '40%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
