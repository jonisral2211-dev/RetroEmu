import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Libretro } from 'react-native-libretro';
import { subscribeCover } from '../covers/CoverCache';
import { onRomImported } from '../downloads/DownloadManager';
import {
  ARCADE_CORES,
  Console,
  CONSOLE_LABEL,
  CoreId,
  coreForConsole,
  isArcadeConsole,
  ENABLED_CORES,
  FOLDER_GUIDE,
  isMisplacedZip,
  misplacedZipMessage,
  SYSTEM_NAME,
} from '../emulator/cores';
import { theme } from '../theme';
import { ConsoleIcon } from '../ui/ConsoleIcon';

type Props = { onPlay: (romPath: string, core?: CoreId) => void };
type Filter = 'all' | Console;
type Entry = { path: string; console: string };

const FILTERS: Filter[] = ['all', 'gba', 'nds', 'n64', 'sega', 'saturn', 'ps1', 'psp', 'mame', 'fbneo'];

// Núcleo elegido por juego arcade (FBNeo o MAME 2003-Plus), recordado en el dispositivo
const ARCADE_CHOICE_KEY = 'jl.arcadecore.v1';
let arcadeChoices: Record<string, CoreId> | null = null;

async function getArcadeChoices(): Promise<Record<string, CoreId>> {
  if (arcadeChoices) return arcadeChoices;
  try {
    const raw = await AsyncStorage.getItem(ARCADE_CHOICE_KEY);
    arcadeChoices = raw ? JSON.parse(raw) : {};
  } catch {
    arcadeChoices = {};
  }
  return arcadeChoices!;
}

function rememberArcadeChoice(path: string, core: CoreId) {
  arcadeChoices = { ...(arcadeChoices ?? {}), [path]: core };
  AsyncStorage.setItem(ARCADE_CHOICE_KEY, JSON.stringify(arcadeChoices)).catch(() => {});
}

// Pregunta con qué núcleo abrir un romset arcade. El de su carpeta va primero (recomendado).
function chooseArcadeCore(entry: Entry, onPlay: Props['onPlay']) {
  const preferred = coreForConsole(entry.console);
  const order = [...ARCADE_CORES].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  Alert.alert(
    'Abrir juego arcade',
    'Elige el núcleo. FBNeo suele tener mejor rendimiento y sonido; MAME 2003-Plus es la alternativa ' +
      'si un romset no arranca. Se recordará para este juego (mantén pulsado para cambiarlo).',
    [
      ...order.map((core) => ({
        text: core === 'fbneo' ? 'FinalBurn Neo' : 'MAME 2003-Plus',
        onPress: () => {
          rememberArcadeChoice(entry.path, core);
          onPlay(entry.path, core);
        },
      })),
      { text: 'Cancelar', style: 'cancel' as const },
    ],
  );
}
const GAP = 12;
const SIDE = 16;

// Ruta relativa a Documents (lo que ve el usuario en la app Archivos)
function relativeToDocuments(path: string): string {
  const i = path.indexOf('/Documents/');
  return i >= 0 ? path.slice(i + '/Documents/'.length) : path.split('/').pop() ?? path;
}

// Título legible: sin extensión ni etiquetas entre paréntesis/corchetes
function displayTitle(path: string): string {
  const file = path.split('/').pop() ?? path;
  const base = file.replace(/\.[^.]+$/, '');
  const clean = base.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
  return clean || base;
}

// Alerta descriptiva en vez de intentar cargar la ROM en blanco
function explainUnavailable(entry: Entry) {
  const name = entry.path.split('/').pop() ?? entry.path;
  const core = coreForConsole(entry.console);
  if (core === null && isMisplacedZip(entry.path)) {
    Alert.alert('Carpeta incorrecta', misplacedZipMessage(entry.path));
    return;
  }
  if (entry.console === 'psp') {
    Alert.alert(
      'PSP aún no disponible',
      `"${name}" está en psp/ y aparecerá aquí, pero esta versión todavía no incluye núcleo de PSP: ` +
        'PPSSPP no se publica para iOS en el buildbot de libretro y necesita aceleración gráfica ' +
        '(OpenGL/Vulkan) que JL Emulator aún no ofrece.',
    );
    return;
  }
  let message: string;
  if (core === null) {
    message = `"${name}" no tiene una cabecera válida para ninguna consola soportada. Revisa que el archivo esté completo.`;
  } else if (!ENABLED_CORES.has(core)) {
    message = `El núcleo de ${SYSTEM_NAME[core]} no está incluido en esta compilación.`;
  } else {
    message = `No se puede abrir "${name}".`;
  }
  Alert.alert('No se puede abrir este juego', message);
}

export default function LibraryScreen({ onPlay }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 5 : width >= 700 ? 4 : width >= 500 ? 3 : 2;
  const cardW = (width - SIDE * 2 - GAP * (columns - 1)) / columns;

  // El nativo organiza la raíz de Documents, verifica cada ROM por contenido y deduplica
  const refresh = useCallback(() => {
    try {
      const list = Libretro.listRoms();
      setEntries(list.map((path) => ({ path, console: Libretro.consoleOf(path) })));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Una descarga terminada se añade a la biblioteca sin reiniciar la app
  useEffect(() => onRomImported(() => refresh()), [refresh]);

  const counts = useMemo(() => {
    const c: Record<Console, number> = {
      gba: 0,
      n64: 0,
      sega: 0,
      mame: 0,
      fbneo: 0,
      ps1: 0,
      psp: 0,
      nds: 0,
      saturn: 0,
    };
    entries.forEach((e) => {
      if (e.console in c) c[e.console as Console] += 1;
    });
    return c;
  }, [entries]);

  const visible = useMemo(
    () =>
      entries
        .filter((e) => filter === 'all' || e.console === filter)
        .sort((a, b) => displayTitle(a.path).localeCompare(displayTitle(b.path))),
    [entries, filter],
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>JL</Text>
          </View>
          <View>
            <Text style={styles.title}>JL Emulator</Text>
            <Text style={styles.subtitle}>{entries.length} juegos</Text>
          </View>
        </View>
        <Pressable onPress={refresh} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
          <Text style={styles.refreshText}>Actualizar</Text>
        </Pressable>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => {
            const active = filter === f;
            const label = f === 'all' ? 'Todos' : CONSOLE_LABEL[f];
            const count = f === 'all' ? entries.length : counts[f];
            const color = active ? theme.bg : theme.titaniumHi;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.chip, active && styles.chipActive]}>
                <ConsoleIcon kind={f} size={16} color={color} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                <Text style={[styles.chipCount, active && styles.chipTextActive]}>{count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        key={columns} // numColumns no puede cambiar en caliente
        data={visible}
        numColumns={columns}
        keyExtractor={(e) => e.path}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
        ListEmptyComponent={
          <Text style={styles.hint}>
            No hay juegos en esta categoría. Copia tus ROMs con la app Archivos → En mi iPhone → JL
            Emulator. Se organizan solas al pulsar Actualizar:{'\n\n'}
            {FOLDER_GUIDE}
            {'\n\n'}Para Neo-Geo deja también neogeo.zip en arcade/, fbneo/ o system/.
          </Text>
        }
        renderItem={({ item }) => <GameCard entry={item} width={cardW} onPlay={onPlay} />}
      />
    </View>
  );
}

const GameCard = memo(function GameCard({
  entry,
  width,
  onPlay,
}: {
  entry: Entry;
  width: number;
  onPlay: Props['onPlay'];
}) {
  const [cover, setCover] = useState<string | null>(null);
  const core = coreForConsole(entry.console);
  const enabled = core !== null && ENABLED_CORES.has(core);
  const misplaced = core === null && isMisplacedZip(entry.path);

  useEffect(() => subscribeCover(entry.path, entry.console, setCover), [entry.path, entry.console]);

  const open = async () => {
    if (!enabled) {
      explainUnavailable(entry);
      return;
    }
    if (isArcadeConsole(entry.console)) {
      const saved = (await getArcadeChoices())[entry.path];
      if (saved) onPlay(entry.path, saved);
      else chooseArcadeCore(entry, onPlay);
      return;
    }
    onPlay(entry.path);
  };

  const artH = width * 1.3;
  return (
    <Pressable
      onPress={open}
      onLongPress={() => (enabled && isArcadeConsole(entry.console) ? chooseArcadeCore(entry, onPlay) : undefined)}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed, !enabled && styles.cardDisabled]}>
      <View style={[styles.art, { height: artH }]}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#23262E" />
              <Stop offset="0.55" stopColor="#15171D" />
              <Stop offset="1" stopColor="#0B0C0F" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
        </Svg>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <View style={styles.monogram}>
            <Text style={[styles.monogramText, { fontSize: width * 0.26 }]}>JL</Text>
            <View style={styles.monogramRule} />
          </View>
        )}
        {entry.console in CONSOLE_LABEL ? (
          <View style={styles.badge}>
            <ConsoleIcon kind={entry.console as Console} size={12} color={theme.amber} />
            <Text style={styles.badgeText}>{CONSOLE_LABEL[entry.console as Console]}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {displayTitle(entry.path)}
      </Text>
      <Text style={[styles.cardSub, misplaced && styles.warn]} numberOfLines={1}>
        {misplaced
          ? '⚠ Mover a arcade/ · toca para ver'
          : core
            ? enabled
              ? relativeToDocuments(entry.path)
              : 'Núcleo no incluido'
            : entry.console === 'psp'
              ? 'PSP · núcleo aún no disponible'
              : 'Sin consola verificada'}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SIDE,
    paddingTop: 12,
    paddingBottom: 14,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.amber,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.amberDim,
  },
  logoText: { color: theme.amber, fontWeight: '800', fontSize: 15, letterSpacing: 1 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700', letterSpacing: 0.4 },
  subtitle: { color: theme.textDim, fontSize: 12, marginTop: 1, letterSpacing: 0.3 },
  refresh: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  refreshText: { color: theme.titaniumHi, fontWeight: '600', fontSize: 13 },
  pressed: { opacity: 0.7 },
  filters: { gap: 8, paddingHorizontal: SIDE, paddingBottom: 14 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  chipActive: { backgroundColor: theme.amber, borderColor: theme.amber },
  chipText: { color: theme.titaniumHi, fontSize: 13, fontWeight: '600' },
  chipCount: { color: theme.textDim, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: theme.bg },
  error: { color: theme.danger, paddingHorizontal: SIDE, paddingBottom: 8 },
  hint: { color: theme.textDim, padding: 24, textAlign: 'center', lineHeight: 20 },
  grid: { paddingHorizontal: SIDE, paddingBottom: 24, gap: GAP + 6 },
  card: {},
  cardDisabled: { opacity: 0.45 },
  art: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  monogram: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  monogramText: { color: theme.amber, fontWeight: '200', letterSpacing: 4, opacity: 0.9 },
  monogramRule: { width: 28, height: 1, backgroundColor: theme.titanium, opacity: 0.5, marginTop: 6 },
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(13,14,18,0.82)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeText: { color: theme.titaniumHi, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  cardTitle: { color: theme.text, fontSize: 13, fontWeight: '600', marginTop: 8, lineHeight: 17 },
  cardSub: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  warn: { color: theme.amber },
});
