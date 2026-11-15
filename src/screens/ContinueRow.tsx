import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import RNFS from 'react-native-fs';
import { subscribeCover } from '../covers/CoverCache';
import { CONSOLE_LABEL, Console } from '../emulator/cores';
import { formatPlaytime } from '../library/playtime';
import { theme } from '../theme';
import { ART_GLOW, ArtKind } from '../ui/ConsoleArt';
import { ConsoleIcon } from '../ui/ConsoleIcon';

// "Seguir jugando": los últimos 6 juegos con la captura de su guardado automático (al salir del
// juego se guarda el estado y su miniatura), tiempo jugado y fondo difuminado del juego enfocado.

type Entry = { path: string; console: string };

/** Captura del último guardado automático (ranura 99, o 98/97 con FBNeo, DeSmuME, SwanStation). */
async function autoShot(path: string): Promise<string | null> {
  const file = path.split('/').pop() ?? path;
  const base = file.includes('.') ? file.slice(0, file.lastIndexOf('.')) : file;
  for (const slot of [99, 98, 97]) {
    const png = `${RNFS.DocumentDirectoryPath}/states/${base}.state${slot}.png`;
    try {
      if (await RNFS.exists(png)) {
        const st = await RNFS.stat(png);
        return `file://${png}?v=${new Date(st.mtime).getTime()}`;
      }
    } catch {
      // siguiente ranura
    }
  }
  return null;
}

function useGameImage(entry: Entry | undefined): { shot: string | null; cover: string | null } {
  const [shot, setShot] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    autoShot(entry.path).then((s) => alive && setShot(s));
    const unsub = subscribeCover(entry.path, entry.console, (c) => alive && setCover(c));
    return () => {
      alive = false;
      unsub();
    };
  }, [entry]);
  return { shot, cover };
}

/** Fondo difuminado (40 px) con los colores de la carátula o captura del juego enfocado. */
export function DynamicBackdrop({ entry }: { entry: Entry | undefined }) {
  const { shot, cover } = useGameImage(entry);
  const uri = cover ?? shot;
  const glow = entry && entry.console in ART_GLOW ? ART_GLOW[entry.console as ArtKind] : theme.amber;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={40} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: glow, opacity: 0.08 }]} />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
    </View>
  );
}

function ContinueCard({
  entry,
  title,
  playtime,
  onPlay,
  onFocus,
}: {
  entry: Entry;
  title: string;
  playtime: number | undefined;
  onPlay: () => void;
  onFocus: () => void;
}) {
  const { shot, cover } = useGameImage(entry);
  const known = entry.console in CONSOLE_LABEL;
  return (
    <Pressable onPressIn={onFocus} onPress={onPlay} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.shot}>
        {shot || cover ? (
          <Image source={{ uri: (shot ?? cover)! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
        <View style={styles.shade} />
        <View style={styles.resume}>
          <Text style={styles.resumeText}>▶ Reanudar</Text>
        </View>
        {known ? (
          <View style={styles.badge}>
            <ConsoleIcon kind={entry.console as Console} size={11} color={theme.amber} />
            <Text style={styles.badgeText}>{CONSOLE_LABEL[entry.console as Console]}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.time}>⏱ {formatPlaytime(playtime)}</Text>
    </Pressable>
  );
}

export function ContinueRow({
  entries,
  titleOf,
  playtime,
  onPlay,
  onFocus,
}: {
  entries: Entry[];
  titleOf: (path: string) => string;
  playtime: Record<string, number>;
  onPlay: (e: Entry) => void;
  onFocus: (e: Entry) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {entries.slice(0, 6).map((e) => (
        <ContinueCard
          key={e.path}
          entry={e}
          title={titleOf(e.path)}
          playtime={playtime[e.path]}
          onPlay={() => onPlay(e)}
          onFocus={() => onFocus(e)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(8,9,12,0.78)' },
  row: { gap: 12, paddingRight: 16 },
  card: { width: 176 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  shot: {
    height: 112,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
  },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  resume: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(212,175,55,0.92)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  resumeText: { color: '#0B0C10', fontSize: 11, fontWeight: '900' },
  badge: {
    position: 'absolute',
    left: 8,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(13,14,18,0.82)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeText: { color: theme.titaniumHi, fontSize: 10, fontWeight: '700' },
  title: { color: theme.text, fontSize: 13, fontWeight: '700', marginTop: 7 },
  time: { color: theme.textDim, fontSize: 11, marginTop: 2 },
});
