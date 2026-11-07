import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Btn } from '../emulator/buttons';

type Props = { onChange: (mask: number) => void };

export function VirtualPad({ onChange }: Props) {
  // Ref y no estado: varios dedos pueden pulsar a la vez y no esperamos a re-render.
  const mask = useRef(0);

  const down = (bit: number) => {
    mask.current |= bit;
    onChange(mask.current);
  };
  const up = (bit: number) => {
    mask.current &= ~bit;
    onChange(mask.current);
  };

  const key = (label: string, bit: number, extra?: object) => (
    <Pressable
      onPressIn={() => down(bit)}
      onPressOut={() => up(bit)}
      hitSlop={8}
      style={({ pressed }) => [styles.key, extra, pressed && styles.keyDown]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );

  const gap = <View style={styles.gap} />;

  return (
    <View style={styles.pad}>
      <View style={styles.side}>
        <View style={styles.row}>{gap}{key('▲', Btn.UP)}{gap}</View>
        <View style={styles.row}>{key('◀', Btn.LEFT)}{gap}{key('▶', Btn.RIGHT)}</View>
        <View style={styles.row}>{gap}{key('▼', Btn.DOWN)}{gap}</View>
      </View>

      <View style={styles.center}>
        <View style={styles.row}>
          {key('SEL', Btn.SELECT, styles.small)}
          {key('START', Btn.START, styles.small)}
        </View>
        <View style={styles.row}>
          {key('L', Btn.L, styles.small)}
          {key('R', Btn.R, styles.small)}
        </View>
      </View>

      <View style={styles.side}>
        <View style={styles.row}>{gap}{key('X', Btn.X)}{gap}</View>
        <View style={styles.row}>{key('Y', Btn.Y)}{gap}{key('A', Btn.A)}</View>
        <View style={styles.row}>{gap}{key('B', Btn.B)}{gap}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  side: { gap: 6 },
  center: { gap: 8, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  key: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDown: { backgroundColor: 'rgba(255,255,255,0.45)' },
  small: { width: 64, height: 36, borderRadius: 10 },
  gap: { width: 56, height: 56 },
  label: { color: '#fff', fontWeight: '700' },
});
