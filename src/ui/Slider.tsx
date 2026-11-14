import React, { useRef, useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

// Deslizador ligero (sin dependencias nativas): arrastrar o tocar la pista
export function Slider({
  label,
  value,
  min,
  max,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const track = useRef<View>(null);
  const geom = useRef({ left: 0, width: 1 });
  const [, force] = useState(0);
  const t = (value - min) / (max - min);

  const measure = () =>
    track.current?.measureInWindow((x, _y, w) => {
      geom.current = { left: x, width: Math.max(1, w) };
      force((n) => n + 1);
    });

  const update = (e: GestureResponderEvent) => {
    const { left, width } = geom.current;
    const k = Math.min(1, Math.max(0, (e.nativeEvent.pageX - left) / width));
    onChange(min + k * (max - min));
  };

  return (
    <View style={styles.row}>
      <View style={styles.labels}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{format(value)}</Text>
      </View>
      <View
        ref={track}
        onLayout={measure}
        style={styles.hit}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          measure();
          update(e);
        }}
        onResponderMove={update}>
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${t * 100}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.thumb, { left: `${t * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginVertical: 6 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { color: theme.titaniumHi, fontSize: 13, fontWeight: '600' },
  value: { color: theme.amber, fontSize: 13, fontWeight: '700' },
  hit: { height: 30, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: theme.border, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: theme.amber },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    borderRadius: 11,
    backgroundColor: theme.titaniumHi,
    borderWidth: 2,
    borderColor: theme.amber,
  },
});
