import React, { useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { GestureTouchEvent, GestureType } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Libretro } from 'react-native-libretro';
import { evaluateZones, Pt } from './evaluate';
import type { Cluster, PadLayout, Zone } from './layouts';

type Size = { w: number; h: number };
type Axis = { x: number; y: number };

// Llamadas a nativo: se ejecutan en el hilo JS solo cuando cambia el estado (runOnJS)
const sendButtons = (mask: number) => Libretro.setButtons(mask);
const sendAxis = (x: number, y: number) => Libretro.setAnalog(x, y);

// Un gesto por cluster. RNGH asigna cada toque al cluster donde empezó, así que un dedo
// puede mantener una dirección del D-Pad mientras otro dedo pulsa A y B a la vez.
function makeClusterGesture(
  c: Cluster,
  digital: SharedValue<Record<string, number>>,
  axis: SharedValue<Axis>,
  sizes: SharedValue<Record<string, Size>>,
): GestureType {
  const id = c.id;
  const zones: Zone[] = c.zones;
  const hasStick = zones.some((z) => z.kind === 'stick');

  // mode: 0 = down/move, 1 = up (excluye los toques que se levantan), 2 = cancelado
  const handle = (e: GestureTouchEvent, mode: number) => {
    'worklet';
    const size = sizes.value[id];
    if (!size || size.w <= 0 || size.h <= 0) return;

    const pts: Pt[] = [];
    if (mode !== 2) {
      for (let i = 0; i < e.allTouches.length; i++) {
        const t = e.allTouches[i];
        let lifting = false;
        if (mode === 1) {
          for (let k = 0; k < e.changedTouches.length; k++) {
            if (e.changedTouches[k].id === t.id) lifting = true;
          }
        }
        if (!lifting) pts.push({ x: t.x, y: t.y });
      }
    }

    const r = evaluateZones(zones, pts, size.w, size.h);
    if ((digital.value[id] ?? 0) !== r.bits) {
      const next = { ...digital.value };
      next[id] = r.bits;
      digital.value = next;
    }
    if (hasStick && (axis.value.x !== r.ax || axis.value.y !== r.ay)) {
      axis.value = { x: r.ax, y: r.ay };
    }
  };

  return Gesture.Manual()
    .onTouchesDown((e) => {
      'worklet';
      handle(e, 0);
    })
    .onTouchesMove((e) => {
      'worklet';
      handle(e, 0);
    })
    .onTouchesUp((e) => {
      'worklet';
      handle(e, 1);
    })
    .onTouchesCancelled((e) => {
      'worklet';
      handle(e, 2);
    });
}

type PadProps = { layout: PadLayout; style?: StyleProp<ViewStyle>; opacity?: number };

export function VirtualPad({ layout, style, opacity = 1 }: PadProps) {
  // Estado de los controles en el runtime de UI: máscara por cluster y eje analógico
  const digital = useSharedValue<Record<string, number>>({});
  const axis = useSharedValue<Axis>({ x: 0, y: 0 });
  const sizes = useSharedValue<Record<string, Size>>({});

  const gestures = useMemo(() => {
    const list = layout.clusters.map((c) => makeClusterGesture(c, digital, axis, sizes));
    // Todos los gestos son simultáneos entre sí: ninguno cancela a los demás
    list.forEach((g, i) => {
      g.simultaneousWithExternalGesture(...list.filter((_, j) => j !== i));
    });
    return list;
  }, [layout, digital, axis, sizes]);

  // OR de todas las partes = máscara final de Libretro (bit i = RETRO_DEVICE_ID_JOYPAD_i)
  useAnimatedReaction(
    () => {
      const keys = Object.keys(digital.value);
      let mask = 0;
      for (let i = 0; i < keys.length; i++) mask |= digital.value[keys[i]];
      return mask;
    },
    (mask, prev) => {
      if (mask !== prev) runOnJS(sendButtons)(mask);
    },
  );

  useAnimatedReaction(
    () => axis.value,
    (a, prev) => {
      if (!prev || a.x !== prev.x || a.y !== prev.y) runOnJS(sendAxis)(a.x, a.y);
    },
  );

  // Al desmontar (cambio de consola o salida) soltamos todo
  useEffect(
    () => () => {
      sendButtons(0);
      sendAxis(0, 0);
    },
    [],
  );

  return (
    <View style={[styles.pad, style, { opacity }]} pointerEvents="box-none">
      {layout.clusters.map((c, i) => (
        <ClusterView key={c.id} cluster={c} gesture={gestures[i]} sizes={sizes} />
      ))}
    </View>
  );
}

function ClusterView({
  cluster,
  gesture,
  sizes,
}: {
  cluster: Cluster;
  gesture: GestureType;
  sizes: SharedValue<Record<string, Size>>;
}) {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
    sizes.value = { ...sizes.value, [cluster.id]: { w: width, h: height } };
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={onLayout}
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
          <ZoneView key={i} zone={z} w={size.w} h={size.h} />
        ))}
      </View>
    </GestureDetector>
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
