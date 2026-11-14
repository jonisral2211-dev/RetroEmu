import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import {
  applyPadMapping,
  DEFAULT_PAD_MAPPING,
  FUNCTIONS,
  functionLabel,
  loadPadMapping,
  PadMappingPrefs,
  PHYSICAL,
  savePadMapping,
} from '../input/padMapping';
import type { GamepadStatus } from '../input/useGamepadStatus';
import { theme } from '../theme';
import { Slider } from '../ui/Slider';

// Mapeo y prueba de botones del mando / palanca Bluetooth (Jugador 1): cada control físico se
// ilumina al pulsarlo y se le puede asignar otra función tocando su fila.
export default function ControllerScreen({
  pad,
  stickToDpad,
  onClose,
}: {
  pad: GamepadStatus;
  stickToDpad: boolean;
  onClose: () => void;
}) {
  const [prefs, setPrefs] = useState<PadMappingPrefs>(DEFAULT_PAD_MAPPING);
  const [live, setLive] = useState({ buttons: 0, lx: 0, ly: 0 });

  useEffect(() => {
    loadPadMapping().then(setPrefs);
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const st = JSON.parse(Libretro.gamepadInput());
        setLive((prev) =>
          prev.buttons === st.buttons && prev.lx === st.lx && prev.ly === st.ly
            ? prev
            : { buttons: st.buttons ?? 0, lx: st.lx ?? 0, ly: st.ly ?? 0 },
        );
      } catch {
        // sin mando
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  const update = (next: PadMappingPrefs) => {
    setPrefs(next);
    savePadMapping(next);
    applyPadMapping(next, stickToDpad);
  };
  const cycle = (index: number) => {
    const current = prefs.mapping[index];
    const pos = FUNCTIONS.findIndex((f) => f.id === current);
    const nextId = FUNCTIONS[(pos + 1) % FUNCTIONS.length].id;
    const mapping = [...prefs.mapping];
    mapping[index] = nextId;
    update({ ...prefs, mapping });
  };

  const R = 46;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>MANDO / PALANCA BLUETOOTH</Text>
          <Text style={styles.title}>Mapeo y prueba de botones</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
          <Text style={styles.closeText}>Listo</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.status, pad.connected && styles.statusOn]}>
          {pad.connected ? `Conectado: ${pad.name || pad.kind || 'mando'}` : 'Ningún mando detectado'}
        </Text>
        <Text style={styles.note}>
          Pulsa cada botón del mando: su fila se ilumina. Toca una fila para cambiar su función (se guarda para
          todos los juegos). Botones de acción arcade: B=1, A=2, Y=3, X=4, L=5, R=6.
        </Text>

        <View style={styles.stickRow}>
          <View style={[styles.stickBase, { width: R * 2, height: R * 2, borderRadius: R }]}>
            <View
              style={[
                styles.stickDot,
                { left: R - 9 + live.lx * (R - 9), top: R - 9 + live.ly * (R - 9) },
              ]}
            />
          </View>
          <View style={styles.stickInfo}>
            <Text style={styles.stickText}>
              Stick izquierdo: x {live.lx.toFixed(2)} · y {live.ly.toFixed(2)}
            </Text>
            <Slider
              label="Zona muerta de los sticks"
              value={prefs.deadzone}
              min={0.02}
              max={0.5}
              format={(v) => `${Math.round(v * 100)} %`}
              onChange={(v) => update({ ...prefs, deadzone: v })}
            />
          </View>
        </View>

        {PHYSICAL.map((p, i) => {
          const pressed = ((live.buttons >> i) & 1) === 1;
          return (
            <Pressable key={p.id} onPress={() => cycle(i)} style={[styles.row, pressed && styles.rowPressed]}>
              <Text style={[styles.phys, pressed && styles.physPressed]}>{p.label}</Text>
              <Text style={styles.func}>{functionLabel(prefs.mapping[i])} ›</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => update(DEFAULT_PAD_MAPPING)} style={styles.reset}>
          <Text style={styles.resetText}>Restablecer mapeo original</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  headerText: { flex: 1 },
  kicker: { color: theme.amber, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  close: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: theme.amber },
  closeText: { color: theme.bg, fontWeight: '800' },
  body: { padding: 16, gap: 8, paddingBottom: 32 },
  status: { color: theme.titaniumHi, fontSize: 15, fontWeight: '700' },
  statusOn: { color: '#4ADE80' },
  note: { color: theme.textDim, fontSize: 12, lineHeight: 17 },
  stickRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginVertical: 8 },
  stickBase: { borderWidth: 2, borderColor: theme.amber, backgroundColor: theme.surface },
  stickDot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: theme.amber },
  stickInfo: { flex: 1 },
  stickText: { color: theme.titaniumHi, fontSize: 12, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  rowPressed: { borderColor: theme.amber, backgroundColor: theme.amberDim },
  phys: { color: theme.text, fontSize: 14, fontWeight: '600', flex: 1 },
  physPressed: { color: theme.amber, fontWeight: '900' },
  func: { color: theme.amber, fontSize: 13, fontWeight: '700' },
  reset: { alignSelf: 'center', marginTop: 10, padding: 10 },
  resetText: { color: theme.danger, fontWeight: '700' },
});
