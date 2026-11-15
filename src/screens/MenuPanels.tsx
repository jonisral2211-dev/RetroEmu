import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Libretro } from 'react-native-libretro';
import type { ImageColor, ImagePrefs, ImageShader } from '../input/imagePrefs';
import { theme } from '../theme';
import { Slider } from '../ui/Slider';

// Paneles del menú de pausa: ranuras visuales, rebobinado, trucos y ajuste fino de imagen

// ---- 5 ranuras de guardado con captura ------------------------------------------------------
type SlotInfo = { exists: boolean; time: number; png: string };

function readSlot(slot: number): SlotInfo {
  const [exists = '0', time = '0', png = ''] = Libretro.stateInfo(slot).split('|');
  return { exists: exists === '1', time: Number(time) || 0, png };
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SaveSlots({
  base,
  canLoad,
  onMessage,
  onLoaded,
}: {
  base: number;
  canLoad: boolean;
  onMessage: (text: string) => void;
  onLoaded: () => void;
}) {
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const refresh = useCallback(() => setSlots([0, 1, 2, 3, 4].map((i) => readSlot(base + i))), [base]);
  useEffect(refresh, [refresh]);

  const save = (i: number) => {
    const ok = Libretro.saveState(base + i);
    onMessage(ok ? `Guardado en la ranura ${i + 1}` : 'Error al guardar');
    refresh();
  };
  const choose = (i: number) => {
    const info = slots[i];
    if (!info?.exists) {
      save(i);
      return;
    }
    Alert.alert(`Ranura ${i + 1}`, `Guardada el ${formatDate(info.time)}`, [
      ...(canLoad
        ? [
            {
              text: 'Cargar',
              onPress: () => {
                const ok = Libretro.loadState(base + i);
                onMessage(ok ? `Ranura ${i + 1} cargada` : 'No se pudo cargar');
                if (ok) onLoaded();
              },
            },
          ]
        : []),
      { text: 'Sobrescribir', style: 'destructive' as const, onPress: () => save(i) },
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  };

  return (
    <View style={styles.slots}>
      {slots.map((s, i) => (
        <Pressable key={i} onPress={() => choose(i)} style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
          <View style={styles.shot}>
            {s.png ? (
              <Image source={{ uri: `file://${s.png}?v=${s.time}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <Text style={styles.empty}>{s.exists ? 'Sin captura' : 'Vacía'}</Text>
            )}
            <View style={styles.slotNum}>
              <Text style={styles.slotNumText}>{i + 1}</Text>
            </View>
          </View>
          <Text style={styles.slotDate} numberOfLines={1}>
            {s.exists ? formatDate(s.time) : 'Toca para guardar'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---- Rebobinado -------------------------------------------------------------------------------
export function RewindPanel({ onMessage, onDone }: { onMessage: (text: string) => void; onDone: () => void }) {
  const [available, setAvailable] = useState(() => Libretro.rewindAvailable());
  useEffect(() => {
    const id = setInterval(() => setAvailable(Libretro.rewindAvailable()), 500);
    return () => clearInterval(id);
  }, []);
  const go = (seconds: number) => {
    const done = Libretro.rewind(seconds);
    if (done > 0) {
      onMessage(`⏪ ${done.toFixed(1)} s atrás`);
      onDone();
    } else {
      onMessage('Todavía no hay nada que rebobinar');
    }
  };
  if (available < 0) {
    return (
      <Text style={styles.note}>
        El rebobinado no está disponible en este juego (su estado es demasiado grande para guardarlo cada medio
        segundo en memoria, o estás jugando en línea).
      </Text>
    );
  }
  return (
    <View>
      <View style={styles.row}>
        {[2, 5, 10].map((s) => (
          <Pressable key={s} onPress={() => go(s)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
            <Text style={styles.chipText}>⏪ {s} s</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        Disponibles {available.toFixed(1)} s (hasta 12 s). Con mando: mantén SELECT + L para rebobinar.
      </Text>
    </View>
  );
}

// ---- Trucos / parches -------------------------------------------------------------------------
type Cheat = { name: string; code: string; on: boolean };
const cheatKey = (rom: string) => `jl.cheats.v1.${rom}`;

/** Activa en el núcleo los trucos guardados para este juego (al empezar la partida). */
export async function applySavedCheats(romPath: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(cheatKey(romPath));
    const list: Cheat[] = raw ? JSON.parse(raw) : [];
    if (!list.some((c) => c.on)) return true;
    return Libretro.setCheats(JSON.stringify(list.filter((c) => c.on).map((c) => c.code)));
  } catch {
    return false;
  }
}

export function CheatsPanel({ romPath }: { romPath: string }) {
  const [list, setList] = useState<Cheat[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(cheatKey(romPath))
      .then((raw) => raw && setList(JSON.parse(raw)))
      .catch(() => {});
  }, [romPath]);
  const commit = (next: Cheat[]) => {
    setList(next);
    AsyncStorage.setItem(cheatKey(romPath), JSON.stringify(next)).catch(() => {});
    setSupported(Libretro.setCheats(JSON.stringify(next.filter((c) => c.on).map((c) => c.code))));
  };
  const add = () => {
    const c = code.trim();
    if (!c) return;
    commit([...list, { name: name.trim() || `Truco ${list.length + 1}`, code: c, on: true }]);
    setName('');
    setCode('');
  };
  return (
    <View>
      {list.map((c, i) => (
        <View key={i} style={styles.cheat}>
          <View style={styles.cheatText}>
            <Text style={styles.cheatName} numberOfLines={1}>
              {c.name}
            </Text>
            <Text style={styles.cheatCode} numberOfLines={1}>
              {c.code}
            </Text>
          </View>
          <Pressable
            onPress={() => commit(list.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
            style={[styles.toggle, c.on && styles.toggleOn]}>
            <Text style={[styles.toggleText, c.on && styles.toggleTextOn]}>{c.on ? 'ON' : 'OFF'}</Text>
          </Pressable>
          <Pressable onPress={() => commit(list.filter((_, j) => j !== i))} hitSlop={8}>
            <Text style={styles.remove}>✕</Text>
          </Pressable>
        </View>
      ))}
      <TextInput value={name} onChangeText={setName} placeholder="Nombre (p. ej. Vidas infinitas)" placeholderTextColor={theme.textDim} style={styles.input} />
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Código (Game Genie, Action Replay, GameShark, CWCheat…)"
        placeholderTextColor={theme.textDim}
        autoCapitalize="characters"
        autoCorrect={false}
        style={styles.input}
      />
      <Pressable onPress={add} style={({ pressed }) => [styles.chip, styles.addChip, pressed && styles.pressed]}>
        <Text style={styles.chipText}>Añadir truco</Text>
      </Pressable>
      <Text style={styles.note}>
        {supported
          ? 'Los trucos se guardan por juego y se activan solos al abrirlo. Varios códigos en una línea: sepáralos con +.'
          : 'Este núcleo no admite trucos por código (retro_cheat_set).'}
      </Text>
    </View>
  );
}

// ---- Ajuste fino de imagen ----------------------------------------------------------------------
const SHADERS: { id: ImageShader; label: string }[] = [
  { id: 'auto', label: 'Nítido HD' },
  { id: 'xbrz', label: 'xBRZ / Vector' },
  { id: 'crt', label: 'TV CRT Trinitron' },
  { id: 'lcd', label: 'LCD portátil' },
];
const COLORS: { id: ImageColor; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'vivid', label: 'Vívido (HDR)' },
  { id: 'cine', label: 'Cine clásico' },
];

export function ImagePanel({
  prefs,
  onChange,
  onRemaster,
  remasterNote,
}: {
  prefs: ImagePrefs;
  onChange: (p: ImagePrefs) => void;
  onRemaster: () => void;
  remasterNote: string;
}) {
  const pill = <T extends string>(items: { id: T; label: string }[], value: T, set: (v: T) => void) => (
    <View style={styles.row}>
      {items.map((o) => (
        <Pressable key={o.id} onPress={() => set(o.id)} style={[styles.chip, o.id === value && styles.chipOn]}>
          <Text style={[styles.chipText, o.id === value && styles.chipTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <View>
      <Pressable onPress={onRemaster} style={({ pressed }) => [styles.remaster, pressed && styles.pressed]}>
        <Text style={styles.remasterText}>✨ Ultra HD Remaster</Text>
      </Pressable>
      <Text style={styles.note}>{remasterNote}</Text>
      <Text style={styles.label}>Shader / Filtro Pro</Text>
      {pill(SHADERS, prefs.shader, (shader) =>
        onChange({ ...prefs, shader, smooth: shader === 'xbrz' && prefs.smooth === 0 ? 0.75 : prefs.smooth }),
      )}
      <Slider
        label="Nitidez HD (CAS)"
        value={prefs.sharpen}
        min={0}
        max={1}
        format={(v) => `${Math.round(v * 100)} %`}
        onChange={(v) => onChange({ ...prefs, sharpen: v })}
      />
      <Slider
        label="Suavizado de píxeles (xBRZ / Vector)"
        value={prefs.smooth}
        min={0}
        max={1}
        format={(v) => (v < 0.01 ? 'Píxel perfecto' : `${Math.round(v * 100)} %`)}
        onChange={(v) => onChange({ ...prefs, smooth: v })}
      />
      <Text style={styles.label}>Color y contraste</Text>
      {pill(COLORS, prefs.color, (color) => onChange({ ...prefs, color }))}
      <Text style={styles.note}>Se guarda para esta consola y se aplica en vivo en el iPhone y en la TV (GPU, sin coste de CPU).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slots: { flexDirection: 'row', gap: 8 },
  slot: { flex: 1 },
  shot: {
    aspectRatio: 4 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0B0C10',
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { color: theme.textDim, fontSize: 10 },
  slotNum: {
    position: 'absolute',
    left: 4,
    top: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 5,
  },
  slotNumText: { color: theme.amber, fontSize: 11, fontWeight: '900' },
  slotDate: { color: theme.textDim, fontSize: 9, marginTop: 3, textAlign: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  chipOn: { borderColor: theme.amber, backgroundColor: theme.amberDim },
  chipText: { color: theme.text, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: theme.amber },
  addChip: { alignSelf: 'flex-start', marginTop: 8 },
  note: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 6 },
  label: { color: theme.titaniumHi, fontSize: 12, fontWeight: '800', marginTop: 12, letterSpacing: 0.4 },
  pressed: { opacity: 0.7 },
  cheat: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  cheatText: { flex: 1 },
  cheatName: { color: theme.text, fontSize: 13, fontWeight: '700' },
  cheatCode: { color: theme.textDim, fontSize: 11, fontFamily: 'Menlo' },
  toggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: theme.border },
  toggleOn: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)' },
  toggleText: { color: theme.textDim, fontWeight: '900', fontSize: 12 },
  toggleTextOn: { color: '#4ADE80' },
  remove: { color: theme.danger, fontSize: 16, fontWeight: '800' },
  input: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    color: theme.text,
    fontSize: 13,
  },
  remaster: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#1E1B4B',
    borderWidth: 1,
    borderColor: '#A78BFA',
  },
  remasterText: { color: '#E9D5FF', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
});
