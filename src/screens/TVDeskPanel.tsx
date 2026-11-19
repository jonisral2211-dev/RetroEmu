import React, { useCallback, useEffect, useState } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Libretro, LibretroView } from 'react-native-libretro';
import { theme } from '../theme';

// Modo "Consola de sobremesa": con el juego en la TV y un mando conectado, el iPhone es un panel
// táctil de control rápido (ranuras con captura, discos, trucos, avance rápido y, en Nintendo DS,
// la pantalla táctil inferior dedicada).

type Slot = { exists: boolean; time: number; png: string };
type Disks = { count: number; index: number; labels: string[] };

function readSlot(slot: number): Slot {
  const [exists = '0', time = '0', png = ''] = Libretro.stateInfo(slot).split('|');
  return { exists: exists === '1', time: Number(time) || 0, png };
}

function readDisks(): Disks {
  try {
    return JSON.parse(Libretro.diskInfo()) as Disks;
  } catch {
    return { count: 0, index: 0, labels: [] };
  }
}

const SPEEDS = [1, 2, 4];

export default function TVDeskPanel({
  title,
  slotBase,
  canLoad,
  players,
  nds,
  dsAspect,
  cheatsPanel,
  onMessage,
  onSaved,
  onOpenMenu,
  onSwapPlayers,
  onShowTouch,
}: {
  title: string;
  /** Primera ranura manual del juego (10 + save*10). */
  slotBase: number;
  canLoad: boolean;
  players: string;
  nds: boolean;
  /** Relación de aspecto del frame completo de la DS (las dos pantallas). */
  dsAspect: number;
  cheatsPanel: React.ReactNode;
  onMessage: (text: string) => void;
  onSaved: () => void;
  onOpenMenu: () => void;
  onSwapPlayers?: () => void;
  onShowTouch: () => void;
}) {
  const [slots, setSlots] = useState<Slot[]>(() => [0, 1, 2, 3, 4].map((i) => readSlot(slotBase + i)));
  const [disks, setDisks] = useState<Disks>(readDisks);
  const [speed, setSpeed] = useState(() => Libretro.fastForward());
  const [cheatsOpen, setCheatsOpen] = useState(false);
  const refreshSlots = useCallback(() => setSlots([0, 1, 2, 3, 4].map((i) => readSlot(slotBase + i))), [slotBase]);

  useEffect(() => {
    const id = setInterval(() => setDisks(readDisks()), 2000);
    return () => clearInterval(id);
  }, []);
  // Al salir del panel se vuelve a velocidad normal
  useEffect(() => () => Libretro.setFastForward(1), []);

  const save = (i: number) => {
    const ok = Libretro.saveState(slotBase + i);
    onMessage(ok ? `Guardado en la ranura ${i + 1}` : 'Error al guardar');
    if (ok) {
      Libretro.hapticKind('success');
      onSaved();
    }
    setTimeout(refreshSlots, 400);
  };
  const load = (i: number) => {
    if (!canLoad) return onMessage('No se puede cargar durante una partida en línea');
    const ok = Libretro.loadState(slotBase + i);
    onMessage(ok ? `Ranura ${i + 1} cargada` : 'No se pudo cargar');
  };
  const chooseSpeed = (s: number) => {
    Libretro.setFastForward(s);
    setSpeed(s);
    Libretro.hapticKind('dpad');
  };
  const chooseDisk = (i: number) => {
    const ok = Libretro.diskSet(i);
    onMessage(ok ? `Disco cambiado: ${disks.labels[i] ?? `Disco ${i + 1}`}` : 'El juego no permitió cambiar el disco');
    setDisks(readDisks());
  };

  // ---- Pantalla táctil de la DS ------------------------------------------------------------
  const [touch, setTouch] = useState({ w: 0, h: 0 });
  const onTouchLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setTouch({ w: width, h: height });
  };
  // Imagen de la pantalla inferior (media imagen: el doble de ancha que el frame completo)
  const half = dsAspect * 2;
  const rect =
    touch.w / Math.max(1, touch.h) > half
      ? { w: touch.h * half, h: touch.h, x: (touch.w - touch.h * half) / 2, y: 0 }
      : { w: touch.w, h: touch.w / half, x: 0, y: (touch.h - touch.w / half) / 2 };
  type T = { locationX: number; locationY: number };
  const sendTouch = (t: T | undefined) => {
    if (!t || rect.w <= 0) return Libretro.setPointer(0, 0, false);
    const u = (t.locationX - rect.x) / rect.w;
    const v = (t.locationY - rect.y) / rect.h;
    if (u < 0 || u > 1 || v < 0 || v > 1) return Libretro.setPointer(0, 0, false);
    // La mitad de abajo del frame de la DS ocupa y en [0, 1]
    Libretro.setPointer(u * 2 - 1, v, true);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.kicker}>CONSOLA DE SOBREMESA</Text>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.players}>{players}</Text>

        {nds ? (
          <View style={styles.dsBox}>
            <Text style={styles.section}>PANTALLA TÁCTIL (DS)</Text>
            <View
              style={styles.dsTouch}
              onLayout={onTouchLayout}
              onTouchStart={(e) => sendTouch(e.nativeEvent.touches[0] as T)}
              onTouchMove={(e) => sendTouch(e.nativeEvent.touches[0] as T)}
              onTouchEnd={() => Libretro.setPointer(0, 0, false)}
              onTouchCancel={() => Libretro.setPointer(0, 0, false)}>
              <LibretroView style={StyleSheet.absoluteFill} region={2} filter={false} stretch={false} />
            </View>
            <Text style={styles.hint}>La pantalla de arriba se ve en la TV; toca aquí la de abajo.</Text>
          </View>
        ) : null}

        <Text style={styles.section}>RANURAS DE GUARDADO</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slots}>
          {slots.map((s, i) => (
            <View key={i} style={styles.slot}>
              <View style={styles.shot}>
                {s.exists && s.png ? (
                  <Image source={{ uri: `file://${s.png}?t=${s.time}` }} style={styles.shotImg} resizeMode="cover" />
                ) : (
                  <Text style={styles.empty}>{s.exists ? 'Sin captura' : 'Vacía'}</Text>
                )}
                <Text style={styles.slotNum}>{i + 1}</Text>
              </View>
              <Text style={styles.slotTime}>
                {s.exists ? new Date(s.time).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
              </Text>
              <View style={styles.slotActions}>
                <Pressable onPress={() => save(i)} style={[styles.small, styles.smallSave]}>
                  <Text style={styles.smallText}>Guardar</Text>
                </Pressable>
                <Pressable onPress={() => load(i)} disabled={!s.exists} style={[styles.small, !s.exists && styles.disabled]}>
                  <Text style={styles.smallText}>Cargar</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>

        <Text style={styles.section}>CÁMARA RÁPIDA</Text>
        <View style={styles.row}>
          {SPEEDS.map((s) => (
            <Pressable key={s} onPress={() => chooseSpeed(s)} style={[styles.chip, speed === s && styles.chipOn]}>
              <Text style={[styles.chipText, speed === s && styles.chipTextOn]}>{s === 1 ? 'Normal' : `${s}x ⏩`}</Text>
            </Pressable>
          ))}
        </View>

        {disks.count > 1 ? (
          <>
            <Text style={styles.section}>CAMBIO DE DISCO</Text>
            <View style={styles.row}>
              {disks.labels.map((label, i) => (
                <Pressable key={i} onPress={() => chooseDisk(i)} style={[styles.chip, disks.index === i && styles.chipOn]}>
                  <Text style={[styles.chipText, disks.index === i && styles.chipTextOn]} numberOfLines={1}>
                    💿 {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.section}>MÁS</Text>
        <View style={styles.row}>
          <Pressable onPress={() => setCheatsOpen((v) => !v)} style={[styles.chip, cheatsOpen && styles.chipOn]}>
            <Text style={[styles.chipText, cheatsOpen && styles.chipTextOn]}>🧪 Trucos</Text>
          </Pressable>
          <Pressable onPress={onOpenMenu} style={styles.chip}>
            <Text style={styles.chipText}>⚙️ Configuración</Text>
          </Pressable>
          {onSwapPlayers ? (
            <Pressable onPress={onSwapPlayers} style={styles.chip}>
              <Text style={styles.chipText}>⇄ J1/J2</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onShowTouch} style={styles.chip}>
            <Text style={styles.chipText}>🎮 Controles táctiles</Text>
          </Pressable>
        </View>
        {cheatsOpen ? <View style={styles.cheats}>{cheatsPanel}</View> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 18, paddingTop: 54, gap: 10, paddingBottom: 40 },
  kicker: { color: theme.amber, fontSize: 12, fontWeight: '900', letterSpacing: 3, textAlign: 'center' },
  title: { color: theme.text, fontSize: 21, fontWeight: '800', textAlign: 'center' },
  players: { color: '#4ADE80', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  section: { color: theme.textDim, fontSize: 11, fontWeight: '900', letterSpacing: 1.6, marginTop: 10 },
  hint: { color: theme.textDim, fontSize: 11, textAlign: 'center' },
  dsBox: { gap: 6 },
  dsTouch: {
    width: '100%',
    aspectRatio: 4 / 3,
    maxHeight: 320,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(56,189,248,0.6)',
    backgroundColor: '#000',
  },
  slots: { gap: 10, paddingVertical: 4 },
  slot: { width: 150, gap: 6 },
  shot: {
    width: 150,
    height: 100,
    borderRadius: 12,
    backgroundColor: theme.surfaceHi,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shotImg: { ...StyleSheet.absoluteFillObject },
  empty: { color: theme.textDim, fontSize: 12 },
  slotNum: {
    position: 'absolute',
    top: 6,
    left: 8,
    color: '#fff',
    fontWeight: '900',
    fontSize: 14,
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  slotTime: { color: theme.textDim, fontSize: 11 },
  slotActions: { flexDirection: 'row', gap: 6 },
  small: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 9,
    alignItems: 'center',
    backgroundColor: theme.surfaceHi,
    borderWidth: 1,
    borderColor: theme.border,
  },
  smallSave: { borderColor: theme.amber },
  smallText: { color: theme.text, fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.surfaceHi,
    borderWidth: 1,
    borderColor: theme.border,
    maxWidth: '100%',
  },
  chipOn: { backgroundColor: theme.amberDim, borderColor: theme.amber },
  chipText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: theme.amber },
  cheats: { marginTop: 6, padding: 10, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
});
