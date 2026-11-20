import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import RNFS from 'react-native-fs';
import { Libretro } from 'react-native-libretro';
import { coreForConsole, CoreId, isArcadeConsole, SYSTEM_NAME } from '../../emulator/cores';
import { manualSlotBase, slotsFor } from '../../emulator/slots';
import { NavKey, usePadNav } from '../../input/uiNav';
import { formatPlaytime } from '../../library/playtime';
import type { Entry } from '../../library/useLibrary';
import { playUi } from '../../ui/uiSounds';
import { getArcadeChoices } from '../LibraryScreen';
import { GeneratedArt, PadGlyph, S, useArt } from './art';
import { RaSummary, subscribeSummaries, summaryForRom } from '../../achievements/ra';
import { useExperience } from '../../ui/experiencePrefs';
import { useTilt } from '../../ui/useTilt';

type Slot = { index: number; exists: boolean; time: number; png: string | null };

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Ranuras manuales (las 5 del menú de pausa) y auto-guardado, leídas de Documents/states/
async function readSlots(path: string, core: CoreId | null): Promise<{ slots: Slot[]; auto: Slot }> {
  const file = path.split('/').pop() ?? path;
  const base = file.includes('.') ? file.slice(0, file.lastIndexOf('.')) : file;
  const dir = `${RNFS.DocumentDirectoryPath}/states`;
  const read = async (n: number, index: number): Promise<Slot> => {
    const state = `${dir}/${base}.state${n}`;
    try {
      if (!(await RNFS.exists(state))) return { index, exists: false, time: 0, png: null };
      const st = await RNFS.stat(state);
      const time = new Date(st.mtime).getTime();
      const png = (await RNFS.exists(`${state}.png`)) ? `file://${state}.png?v=${time}` : null;
      return { index, exists: true, time, png };
    } catch {
      return { index, exists: false, time: 0, png: null };
    }
  };
  const first = manualSlotBase(core);
  const slots = await Promise.all([0, 1, 2, 3, 4].map((i) => read(first + i, i)));
  return { slots, auto: await read(slotsFor(core).auto, -1) };
}

type Props = {
  entry: Entry;
  title: string;
  favorite: boolean;
  playtime: number | undefined;
  active: boolean;
  onPlay: (slot?: number) => void;
  onToggleFavorite: () => void;
  onOptions: () => void;
  onClose: () => void;
};

// Ficha previa del juego: banner, datos de cabecera (serial), JUGAR y las 5 ranuras
export default function GameDetails({ entry, title, favorite, playtime, active, onPlay, onToggleFavorite, onOptions, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const { box, hero } = useArt(entry, true);
  const [core, setCore] = useState<CoreId | null>(() => coreForConsole(entry.console, entry.path));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [auto, setAuto] = useState<Slot | null>(null);
  const [info, setInfo] = useState<{ serial: string; title: string }>({ serial: '', title: '' });
  // Foco: 0 JUGAR, 1 Favorito, 2 Opciones, 3..7 ranuras 1-5
  const [focus, setFocus] = useState(0);
  // Paralaje 3D con el giroscopio (banner y carátula) mientras la ficha está visible
  const experience = useExperience();
  const tilt = useTilt(experience.parallax && active);
  // Progreso de logros (RetroAchievements)
  const [ra, setRa] = useState<RaSummary | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => summaryForRom(entry.path, core).then((r) => alive && setRa(r));
    load();
    const unsub = subscribeSummaries(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [entry.path, core]);

  useEffect(() => {
    if (!isArcadeConsole(entry.console)) return;
    getArcadeChoices().then((c) => c[entry.path] && setCore(c[entry.path]));
  }, [entry]);
  useEffect(() => {
    let alive = true;
    readSlots(entry.path, core).then((r) => {
      if (!alive) return;
      setSlots(r.slots);
      setAuto(r.auto);
    });
    return () => {
      alive = false;
    };
  }, [entry.path, core]);
  useEffect(() => {
    // Lectura de cabecera (unos KB): después de pintar
    const id = setTimeout(() => {
      try {
        const r = JSON.parse(Libretro.romInfo(entry.path)) as { serial?: string; title?: string };
        setInfo({ serial: r.serial ?? '', title: r.title ?? '' });
      } catch {
        // nativo sin romInfo
      }
    }, 60);
    return () => clearTimeout(id);
  }, [entry.path]);

  const activate = (i: number) => {
    if (i === 0) {
      playUi('select');
      onPlay();
    } else if (i === 1) {
      playUi('select');
      onToggleFavorite();
    } else if (i === 2) {
      onOptions();
    } else {
      const slot = slots[i - 3];
      if (!slot?.exists) {
        playUi('back');
        return;
      }
      playUi('select');
      onPlay(slot.index);
    }
  };

  usePadNav((key: NavKey) => {
    const move = (next: number) => {
      if (next !== focus) playUi('move');
      setFocus(next);
    };
    if (key === 'back') {
      playUi('back');
      onClose();
    } else if (key === 'accept') activate(focus);
    else if (key === 'action') activate(1);
    else if (key === 'option') onOptions();
    else if (key === 'left') move(focus <= 2 ? Math.max(0, focus - 1) : Math.max(3, focus - 1));
    else if (key === 'right') move(focus <= 2 ? Math.min(2, focus + 1) : Math.min(7, focus + 1));
    else if (key === 'down' && focus <= 2) move(3 + Math.min(4, focus * 2));
    else if (key === 'up' && focus >= 3) move(Math.min(2, Math.floor((focus - 3) / 2)));
  }, active);

  const landscape = width > height;
  const bannerH = Math.round(Math.min(height * (landscape ? 0.5 : 0.36), 340));
  const slotW = Math.min(150, (width - 32 - 4 * 10) / 5);
  const lastPlayed = auto?.exists ? `Última partida: ${formatDate(auto.time)}` : 'Sin partida guardada: empieza desde el principio';
  const meta = useMemo(
    () =>
      [
        core ? SYSTEM_NAME[core] : null,
        info.serial || null,
        playtime ? `⏱ ${formatPlaytime(playtime)}` : null,
      ].filter(Boolean) as string[],
    [core, info.serial, playtime],
  );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <View style={{ height: bannerH, overflow: 'hidden' }}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                transform: [
                  { translateX: tilt.x.interpolate({ inputRange: [-1, 1], outputRange: [-16, 16] }) },
                  { translateY: tilt.y.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) },
                  { scale: 1.1 },
                ],
              },
            ]}>
            {hero ? (
              <Image source={{ uri: hero }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : box ? (
              <Image source={{ uri: box }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={22} />
            ) : (
              <GeneratedArt entry={entry} title="" width={width} height={bannerH} />
            )}
          </Animated.View>
          <Svg style={StyleSheet.absoluteFill} width={width} height={bannerH} pointerEvents="none">
            <Defs>
              <LinearGradient id="detFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={S.bg} stopOpacity="0.1" />
                <Stop offset="1" stopColor={S.bg} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={width} height={bannerH} fill="url(#detFade)" />
          </Svg>
          <Pressable onPress={onClose} hitSlop={12} style={styles.backBtn}>
            <Text style={styles.backText}>‹ Volver</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.head}>
            <Animated.View
              style={[
                styles.boxWrap,
                {
                  transform: [
                    { perspective: 600 },
                    { rotateY: tilt.x.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] }) },
                    { rotateX: tilt.y.interpolate({ inputRange: [-1, 1], outputRange: ['9deg', '-9deg'] }) },
                    { translateX: tilt.x.interpolate({ inputRange: [-1, 1], outputRange: [4, -4] }) },
                  ],
                },
              ]}>
              <View style={styles.boxArt}>
              {box ? (
                <Image source={{ uri: box }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={{ width: 96, height: 134, borderRadius: 12, overflow: 'hidden' }}>
                  <GeneratedArt entry={entry} title={title} width={96} height={134} />
                </View>
              )}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.glare,
                  {
                    opacity: tilt.x.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.28, 0.08, 0.28] }),
                    transform: [
                      { translateX: tilt.x.interpolate({ inputRange: [-1, 1], outputRange: [-70, 70] }) },
                      { rotate: '20deg' },
                    ],
                  },
                ]}
              />
              </View>
            </Animated.View>
            <View style={styles.headText}>
              <Text style={styles.title} numberOfLines={3}>
                {title}
              </Text>
              {info.title && info.title.toLowerCase() !== title.toLowerCase() ? (
                <Text style={styles.internal} numberOfLines={1}>
                  Cabecera: {info.title}
                </Text>
              ) : null}
              <Text style={styles.meta} numberOfLines={2}>
                {meta.join('  ·  ')}
              </Text>
              {ra && ra.total > 0 ? (
                <View style={styles.ra}>
                  <Text style={styles.raText}>
                    🏆 {ra.earned}/{ra.total} logros · {ra.points}/{ra.maxPoints} pts
                  </Text>
                  <View style={styles.raBar}>
                    <View style={[styles.raFill, { width: `${Math.round((ra.earned / ra.total) * 100)}%` }]} />
                  </View>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable onPress={() => activate(0)} style={[styles.play, focus === 0 && styles.focused]}>
              <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
                <Defs>
                  <LinearGradient id="playG" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={S.green1} />
                    <Stop offset="1" stopColor={S.green2} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" rx="6" fill="url(#playG)" />
              </Svg>
              <Text style={styles.playText}>▶  JUGAR</Text>
            </Pressable>
            <Pressable onPress={() => activate(1)} style={[styles.secondary, focus === 1 && styles.focused]}>
              <Text style={[styles.secondaryText, favorite && { color: S.gold }]}>{favorite ? '★ Favorito' : '☆ Favorito'}</Text>
            </Pressable>
            <Pressable onPress={() => activate(2)} style={[styles.secondary, focus === 2 && styles.focused]}>
              <Text style={styles.secondaryText}>⋯ Opciones</Text>
            </Pressable>
          </View>
          <Text style={styles.note}>{lastPlayed}</Text>

          <Text style={styles.section}>RANURAS DE GUARDADO</Text>
          <View style={styles.slots}>
            {slots.map((s, i) => (
              <Pressable key={i} onPress={() => activate(3 + i)} style={{ width: slotW }}>
                <View style={[styles.slot, { width: slotW, height: slotW * 0.75 }, focus === 3 + i && styles.focused, !s.exists && styles.slotEmpty]}>
                  {s.png ? <Image source={{ uri: s.png }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                  <View style={styles.slotNum}>
                    <Text style={styles.slotNumText}>{i + 1}</Text>
                  </View>
                  {!s.exists ? <Text style={styles.slotEmptyText}>Vacía</Text> : null}
                </View>
                <Text style={styles.slotDate} numberOfLines={1}>
                  {s.exists ? formatDate(s.time) : '—'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>
            JUGAR reanuda donde lo dejaste. Elige una ranura para empezar desde ese guardado (se guardan desde el menú de pausa).
          </Text>
        </View>
      </ScrollView>

      <View style={styles.hints}>
        <View style={styles.hint}>
          <PadGlyph kind="cross" />
          <Text style={styles.hintText}>Elegir</Text>
        </View>
        <View style={styles.hint}>
          <PadGlyph kind="triangle" />
          <Text style={styles.hintText}>Favorito</Text>
        </View>
        <View style={styles.hint}>
          <PadGlyph kind="square" />
          <Text style={styles.hintText}>Opciones</Text>
        </View>
        <View style={styles.hint}>
          <PadGlyph kind="circle" />
          <Text style={styles.hintText}>Volver</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glare: { position: 'absolute', top: -40, bottom: -40, width: 40, left: 28, backgroundColor: '#FFFFFF' },
  ra: { marginTop: 6, gap: 4 },
  raText: { color: S.gold, fontSize: 12, fontWeight: '800' },
  raBar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', maxWidth: 260 },
  raFill: { height: 5, borderRadius: 3, backgroundColor: S.gold },
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: S.bg },
  scroll: { paddingBottom: 24 },
  backBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(10,14,20,0.7)',
  },
  backText: { color: S.text, fontWeight: '800', fontSize: 14 },
  body: { paddingHorizontal: 16, marginTop: -40, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  boxWrap: {
    width: 96,
    height: 134,
    borderRadius: 12,
    backgroundColor: S.panel,
    shadowColor: '#000',
    shadowOpacity: 0.7,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  // Recorte de la carátula: hijo sin transformar (en iOS el overflow no recorta dentro de un padre 3D)
  boxArt: { flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: S.panel },
  headText: { flex: 1, gap: 4 },
  title: { color: S.text, fontSize: 24, fontWeight: '900' },
  internal: { color: S.faint, fontSize: 12, fontWeight: '700' },
  meta: { color: S.dim, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  play: { flex: 1.6, height: 50, borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  playText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 1.5 },
  secondary: {
    flex: 1,
    height: 50,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: S.panelHi,
  },
  secondaryText: { color: S.text, fontSize: 14, fontWeight: '800' },
  focused: {
    borderWidth: 2,
    borderColor: S.focus,
    shadowColor: S.blue,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  note: { color: S.faint, fontSize: 12, lineHeight: 17 },
  section: { color: S.dim, fontSize: 12, fontWeight: '900', letterSpacing: 1.5, marginTop: 8 },
  slots: { flexDirection: 'row', gap: 10 },
  slot: { borderRadius: 6, overflow: 'hidden', backgroundColor: S.panel, alignItems: 'center', justifyContent: 'center' },
  slotEmpty: { opacity: 0.55 },
  slotEmptyText: { color: S.faint, fontSize: 11, fontWeight: '700' },
  slotNum: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(10,14,20,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNumText: { color: S.text, fontSize: 11, fontWeight: '900' },
  slotDate: { color: S.dim, fontSize: 10, marginTop: 4, textAlign: 'center' },
  hints: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: S.bg2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: S.line,
  },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { color: S.dim, fontSize: 12, fontWeight: '700' },
});
