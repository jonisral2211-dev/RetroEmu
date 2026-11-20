import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import { theme } from '../theme';

// Multimedia: banda sonora local (mp3, flac, m4a…) que sigue sonando al navegar o jugar.
type Track = { name: string; size: number };
type MediaState = { playing: boolean; name: string; position: number; duration: number };

const EMPTY: MediaState = { playing: false, name: '', position: 0, duration: 0 };

function readTracks(): Track[] {
  try {
    return JSON.parse(Libretro.mediaList()) as Track[];
  } catch {
    return [];
  }
}

function readState(): MediaState {
  try {
    return { ...EMPTY, ...(JSON.parse(Libretro.mediaState()) as Partial<MediaState>) };
  } catch {
    return EMPTY;
  }
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export default function MediaScreen() {
  const [tracks, setTracks] = useState<Track[]>(() => readTracks());
  const [state, setState] = useState<MediaState>(() => readState());
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => setTracks(readTracks()), []);

  const playAt = useCallback(
    (index: number) => {
      if (tracks.length === 0) return;
      const i = ((index % tracks.length) + tracks.length) % tracks.length;
      if (!Libretro.mediaPlay(tracks[i].name)) setNotice('No se pudo reproducir esa pista');
      setState(readState());
    },
    [tracks],
  );

  // Estado de la reproducción cada medio segundo; al terminar una pista pasa a la siguiente
  useEffect(() => {
    const id = setInterval(() => {
      const s = readState();
      setState(s);
      const finished = s.name !== '' && !s.playing && s.duration > 0 && s.position >= s.duration - 0.5;
      if (finished) {
        const idx = tracks.findIndex((t) => t.name === s.name);
        if (idx >= 0 && tracks.length > 0) playAt(idx + 1);
      }
    }, 500);
    return () => clearInterval(id);
  }, [tracks, playAt]);

  const importTracks = () => {
    Libretro.mediaImport()
      .then((n) => {
        if (n < 0) return;
        setNotice(n === 0 ? 'No había pistas compatibles (.mp3, .flac, .m4a, .wav)' : `Añadidas ${n} pistas`);
        refresh();
      })
      .catch((e) => setNotice(String(e?.message ?? e)));
  };

  const removeTrack = (t: Track) => {
    Alert.alert('Quitar pista', `¿Quitar "${t.name}" de la biblioteca musical?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: () => {
          Libretro.mediaRemove(t.name);
          refresh();
          setState(readState());
        },
      },
    ]);
  };

  const current = tracks.findIndex((t) => t.name === state.name);
  const hasCurrent = state.name !== '' && current >= 0;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Multimedia</Text>
      <Text style={styles.sub}>Música local en segundo plano · {tracks.length} pistas</Text>

      <Pressable onPress={importTracks} style={styles.primary}>
        <Text style={styles.primaryText}>Importar música…</Text>
      </Pressable>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {hasCurrent ? (
        <View style={styles.player}>
          <Text style={styles.nowLabel}>Reproduciendo</Text>
          <Text style={styles.nowName} numberOfLines={1}>
            {state.name}
          </Text>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${state.duration ? (state.position / state.duration) * 100 : 0}%` }]} />
          </View>
          <Text style={styles.time}>
            {fmtTime(state.position)} / {fmtTime(state.duration)}
          </Text>
          <View style={styles.controls}>
            <Pressable style={styles.ctrl} onPress={() => playAt(current - 1)}>
              <Text style={styles.ctrlText}>⏮</Text>
            </Pressable>
            <Pressable
              style={[styles.ctrl, styles.ctrlMain]}
              onPress={() => {
                if (state.playing) Libretro.mediaPause();
                else Libretro.mediaResume();
                setState(readState());
              }}>
              <Text style={[styles.ctrlText, styles.ctrlMainText]}>{state.playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable style={styles.ctrl} onPress={() => playAt(current + 1)}>
              <Text style={styles.ctrlText}>⏭</Text>
            </Pressable>
            <Pressable
              style={styles.ctrl}
              onPress={() => {
                Libretro.mediaStop();
                setState(readState());
              }}>
              <Text style={styles.ctrlText}>■</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.section}>Pistas</Text>
      {tracks.length === 0 ? (
        <Text style={styles.empty}>Aún no hay música. Importa archivos .mp3, .flac o .m4a desde Archivos o iCloud Drive.</Text>
      ) : (
        tracks.map((t, i) => {
          const playingThis = t.name === state.name && state.playing;
          return (
            <Pressable
              key={t.name}
              onPress={() => playAt(i)}
              onLongPress={() => removeTrack(t)}
              style={[styles.row, t.name === state.name && styles.rowActive]}>
              <Text style={[styles.rowIcon, playingThis && styles.rowIconOn]}>{playingThis ? '♪' : '·'}</Text>
              <Text style={styles.rowName} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={styles.rowSize}>{(t.size / (1024 * 1024)).toFixed(1)} MB</Text>
            </Pressable>
          );
        })
      )}
      {tracks.length > 0 ? <Text style={styles.hint}>Mantén pulsada una pista para quitarla.</Text> : null}

      <Text style={styles.section}>Clips de partida</Text>
      <Text style={styles.empty}>Los clips grabados desde el menú rápido aparecerán aquí cuando esté activo el grabador.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  title: { color: theme.text, fontSize: 26, fontWeight: '800' },
  sub: { color: theme.textDim, fontSize: 13 },
  primary: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: theme.amberDim,
    borderWidth: 1,
    borderColor: theme.amber,
  },
  primaryText: { color: theme.amber, fontWeight: '800', fontSize: 15 },
  notice: { color: theme.amber, fontSize: 13 },
  player: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 8,
  },
  nowLabel: { color: theme.titanium, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  nowName: { color: theme.text, fontSize: 16, fontWeight: '700' },
  bar: { height: 4, borderRadius: 2, backgroundColor: theme.border, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: theme.amber },
  time: { color: theme.textDim, fontSize: 12 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 4 },
  ctrl: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceHi,
  },
  ctrlMain: { backgroundColor: theme.amber },
  ctrlText: { color: theme.text, fontSize: 18 },
  ctrlMainText: { color: theme.bg },
  section: { color: theme.amber, fontSize: 13, fontWeight: '800', marginTop: 10, textTransform: 'uppercase' },
  empty: { color: theme.textDim, fontSize: 14, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: theme.surface,
  },
  rowActive: { borderWidth: 1, borderColor: theme.amber },
  rowIcon: { color: theme.titanium, width: 16, textAlign: 'center' },
  rowIconOn: { color: theme.amber },
  rowName: { flex: 1, color: theme.text, fontSize: 15 },
  rowSize: { color: theme.textDim, fontSize: 12 },
  hint: { color: theme.textDim, fontSize: 12 },
});
