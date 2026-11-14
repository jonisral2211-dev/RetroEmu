import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Libretro } from 'react-native-libretro';
import RNFS from 'react-native-fs';
import { arcadeTitle } from '../covers/arcadeNames';
import { forgetCover, subscribeCover } from '../covers/CoverCache';
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
  MOVE_TARGETS,
  SYSTEM_NAME,
} from '../emulator/cores';
import { removeRecent, subscribeRecents } from '../library/recents';
import { theme } from '../theme';
import { ART_GLOW, ArtKind, ConsoleArt } from '../ui/ConsoleArt';
import { ConsoleIcon } from '../ui/ConsoleIcon';
import { JLBadge } from '../ui/JLBadge';

type Props = { onPlay: (romPath: string, core?: CoreId) => void };
type Entry = { path: string; console: string };

// Tarjetas de la sección CONSOLAS (orden y nombre completo)
const CONSOLE_CARDS: { id: Console; name: string }[] = [
  { id: 'ps1', name: 'PlayStation' },
  { id: 'psp', name: 'PSP' },
  { id: 'n64', name: 'Nintendo 64' },
  { id: 'nds', name: 'Nintendo DS' },
  { id: 'gba', name: 'Game Boy Advance' },
  { id: 'saturn', name: 'Sega Saturn' },
  { id: 'sega', name: 'Mega Drive' },
  { id: 'fbneo', name: 'FBNeo Arcade' },
  { id: 'mame', name: 'MAME Arcade' },
];

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
  const arcade = /\.zip$/i.test(path) ? arcadeTitle(path) : null;
  if (arcade) return arcade;
  const file = path.split('/').pop() ?? path;
  const base = file.replace(/\.[^.]+$/, '');
  const clean = base.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
  return clean || base;
}

// Por debajo de este tamaño un juego está incompleto o dañado (descarga cortada, zip vacío).
// Las hojas .cue/.m3u son texto y siempre pesan poco: no cuentan.
const MIN_GAME_BYTES = 20 * 1024;
const isSheet = (path: string) => /\.(cue|m3u)$/i.test(path);

function formatKb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

// Archivos de un juego: un .cue arrastra sus pistas (líneas FILE) de la misma carpeta
async function gameFiles(path: string): Promise<string[]> {
  const files = [path];
  if (/\.cue$/i.test(path)) {
    try {
      const dir = path.slice(0, path.lastIndexOf('/'));
      const text = await RNFS.readFile(path, 'utf8');
      const re = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/gim;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) files.push(`${dir}/${m[1] ?? m[2]}`);
    } catch {
      // .cue ilegible: solo la hoja
    }
  }
  return files;
}

async function deleteGame(path: string): Promise<void> {
  for (const t of await gameFiles(path)) {
    if (await RNFS.exists(t)) await RNFS.unlink(t);
  }
}

// Mueve el juego (y sus pistas) a Documents/<folder>/, sin sobrescribir nada
async function moveGame(path: string, folder: string): Promise<string> {
  const destDir = `${RNFS.DocumentDirectoryPath}/${folder}`;
  await RNFS.mkdir(destDir);
  const files = await gameFiles(path);
  for (const f of files) {
    const dest = `${destDir}/${f.split('/').pop()}`;
    if (await RNFS.exists(dest)) throw new Error(`Ya existe ${folder}/${f.split('/').pop()}`);
  }
  for (const f of files) {
    if (await RNFS.exists(f)) await RNFS.moveFile(f, `${destDir}/${f.split('/').pop()}`);
  }
  return `${destDir}/${path.split('/').pop()}`;
}

function confirmDelete(entry: Entry, onRemoved: () => void) {
  const name = entry.path.split('/').pop() ?? entry.path;
  const extra = /\.cue$/i.test(entry.path) ? ' y sus pistas .bin' : '';
  Alert.alert('Eliminar juego', `Se borrará "${name}"${extra} del iPhone. No se puede deshacer.`, [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Eliminar',
      style: 'destructive',
      onPress: () =>
        deleteGame(entry.path)
          .then(() => {
            forgetCover(entry.path, entry.console);
            removeRecent(entry.path);
            onRemoved();
          })
          .catch((e) => Alert.alert('No se pudo eliminar', String(e))),
    },
  ]);
}

function chooseMoveTarget(entry: Entry, onMoved: () => void) {
  const current = relativeToDocuments(entry.path).split('/')[0];
  Alert.alert(
    'Mover a otra consola',
    `"${entry.path.split('/').pop()}" está en ${current}/. Elige su carpeta correcta:`,
    [
      ...MOVE_TARGETS.filter((t) => t.folder !== current).map((t) => ({
        text: `${t.label} (${t.folder}/)`,
        onPress: () =>
          moveGame(entry.path, t.folder)
            .then(() => {
              forgetCover(entry.path, entry.console);
              removeRecent(entry.path);
              onMoved();
            })
            .catch((e) => Alert.alert('No se pudo mover', String(e))),
      })),
      { text: 'Cancelar', style: 'cancel' as const },
    ],
  );
}

// Alerta descriptiva en vez de intentar cargar la ROM en blanco
function explainUnavailable(entry: Entry) {
  const name = entry.path.split('/').pop() ?? entry.path;
  const core = coreForConsole(entry.console);
  if (core === null && isMisplacedZip(entry.path)) {
    Alert.alert('Carpeta incorrecta', misplacedZipMessage(entry.path));
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

type UnpackResult = { name: string; ok: boolean; files: number; error: string };

export default function LibraryScreen({ onPlay }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  // Consola abierta (vista dedicada) o null = pantalla principal (consolas + recientes)
  const [view, setView] = useState<Console | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [unpacking, setUnpacking] = useState<string[] | null>(null);
  const unpackBusy = useRef(false);
  const unpackFailed = useRef(new Set<string>());
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 5 : width >= 700 ? 4 : width >= 560 ? 3 : 2;
  const cardW = (width - SIDE * 2 - GAP * (columns - 1)) / columns;
  const consoleCols = width >= 900 ? 5 : width >= 600 ? 3 : 2;
  const consoleW = (width - SIDE * 2 - GAP * (consoleCols - 1)) / consoleCols;

  // El nativo organiza la raíz de Documents, verifica cada ROM por contenido y deduplica
  const listNow = useCallback(() => {
    try {
      const list = Libretro.listRoms();
      setEntries(list.map((path) => ({ path, console: Libretro.consoleOf(path) })));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // .zip/.7z en carpetas de consola o descargas grandes: se descomprimen en segundo plano y
  // la biblioteca se actualiza al terminar. Un comprimido que falla no se reintenta solo
  // (sí al pulsar Actualizar).
  const refresh = useCallback(
    (manual = false) => {
      listNow();
      if (unpackBusy.current) return;
      if (manual) unpackFailed.current.clear();
      let pending: string[] = [];
      try {
        pending = Libretro.pendingArchives().filter((p) => !unpackFailed.current.has(p));
      } catch {
        return;
      }
      if (!pending.length) return;
      unpackBusy.current = true;
      setUnpacking(pending);
      Libretro.unpackArchives()
        .then((json) => {
          const results = JSON.parse(json) as UnpackResult[];
          const failed = results.filter((r) => !r.ok);
          pending.forEach((p) => {
            if (failed.some((f) => p.endsWith(`/${f.name}`))) unpackFailed.current.add(p);
          });
          if (failed.length) {
            Alert.alert(
              'No se pudo descomprimir',
              failed.map((f) => `• ${f.name}: ${f.error}`).join('\n'),
            );
          }
        })
        .catch((e) => Alert.alert('Error al descomprimir', String(e)))
        .finally(() => {
          unpackBusy.current = false;
          setUnpacking(null);
          listNow();
        });
    },
    [listNow],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Una descarga terminada se añade a la biblioteca sin reiniciar la app
  useEffect(() => onRomImported(() => refresh()), [refresh]);
  useEffect(() => subscribeRecents(setRecents), []);

  const counts = useMemo(() => {
    const c: Record<Console, number> = { gba: 0, n64: 0, sega: 0, mame: 0, fbneo: 0, ps1: 0, psp: 0, nds: 0, saturn: 0 };
    entries.forEach((e) => {
      if (e.console in c) c[e.console as Console] += 1;
    });
    return c;
  }, [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => e.console === view)
      .filter((e) => !q || displayTitle(e.path).toLowerCase().includes(q) || e.path.toLowerCase().includes(q))
      .sort((a, b) => displayTitle(a.path).localeCompare(displayTitle(b.path)));
  }, [entries, view, query]);

  const openConsole = (c: Console) => {
    setQuery('');
    setView(c);
  };

  const recentEntries = useMemo(() => {
    const byPath = new Map(entries.map((e) => [e.path, e]));
    return recents.map((p) => byPath.get(p)).filter((e): e is Entry => !!e);
  }, [entries, recents]);

  const consolesWithGames = CONSOLE_CARDS.filter((c) => counts[c.id] > 0).length;

  const header = (
    <View>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.badgeGlow}>
            <JLBadge size={50} />
          </View>
          <View>
            <Text style={styles.title}>
              JL <Text style={styles.titleLight}>EMULATOR</Text>
            </Text>
            <Text style={styles.subtitle}>
              {entries.length} juegos · {consolesWithGames} consolas
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => refresh(true)}
          hitSlop={8}
          style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Path
              d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
              stroke={theme.amber}
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      </View>

      {unpacking ? (
        <View style={styles.unpackBanner}>
          <ActivityIndicator color={theme.amber} />
          <Text style={styles.unpackText} numberOfLines={2}>
            Descomprimiendo {unpacking.map((p) => p.split('/').pop()).join(', ')}… El juego aparecerá al terminar.
          </Text>
        </View>
      ) : null}

      <SectionTitle title="Consolas" />
      <View style={styles.consoleGrid}>
        {CONSOLE_CARDS.map((c) => (
          <ConsoleCard
            key={c.id}
            id={c.id}
            name={c.name}
            count={counts[c.id]}
            width={consoleW}
            selected={false}
            onPress={() => openConsole(c.id)}
          />
        ))}
      </View>

      <SectionTitle title="Juegos recientes" />
      {recentEntries.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
          {recentEntries.map((e) => (
            <GameCard key={e.path} entry={e} width={112} compact onPlay={onPlay} onRemoved={() => refresh()} />
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.recentEmpty}>Los juegos que abras aparecerán aquí.</Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  if (!view) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.home}>{header}</ScrollView>
      </View>
    );
  }

  // Vista de una consola: Volver, cabecera, buscador y cuadrícula solo con sus juegos
  const card = CONSOLE_CARDS.find((c) => c.id === view);
  const consoleHeader = (
    <View>
      <View style={styles.viewTop}>
        <Pressable onPress={() => setView(null)} hitSlop={10} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>
        <Pressable
          onPress={() => refresh(true)}
          hitSlop={8}
          style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Path
              d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
              stroke={theme.amber}
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      </View>
      <View style={styles.viewHero}>
        <ConsoleArt kind={view as ArtKind} width={132} height={91} />
        <View style={styles.viewHeroText}>
          <Text style={styles.viewTitle}>{card?.name ?? CONSOLE_LABEL[view]}</Text>
          <Text style={styles.viewCount}>
            {counts[view] === 1 ? '1 juego' : `${counts[view]} juegos`} · {view === 'mame' ? 'arcade' : view}/
          </Text>
        </View>
      </View>
      {unpacking ? (
        <View style={styles.unpackBanner}>
          <ActivityIndicator color={theme.amber} />
          <Text style={styles.unpackText} numberOfLines={2}>
            Descomprimiendo {unpacking.map((p) => p.split('/').pop()).join(', ')}…
          </Text>
        </View>
      ) : null}
      <View style={styles.search}>
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Circle cx="11" cy="11" r="7" stroke={theme.textDim} strokeWidth={2} fill="none" />
          <Path d="M20 20l-4-4" stroke={theme.textDim} strokeWidth={2} strokeLinecap="round" />
        </Svg>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Buscar en ${card?.name ?? 'esta consola'}`}
          placeholderTextColor={theme.textDim}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={styles.searchInput}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        key={columns} // numColumns no puede cambiar en caliente
        data={visible}
        numColumns={columns}
        keyExtractor={(e) => e.path}
        ListHeaderComponent={consoleHeader}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.grid}
        columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
        ListEmptyComponent={
          <Text style={styles.hint}>
            {query ? `Ningún juego coincide con "${query}".\n\n` : ''}No hay juegos en esta consola. Copia tus ROMs con la app Archivos → En mi iPhone → JL
            Emulator. Se organizan solas al pulsar Actualizar (los .zip y .7z se descomprimen solos):{'\n\n'}
            {FOLDER_GUIDE}
            {'\n\n'}Para Neo-Geo deja también neogeo.zip en arcade/, fbneo/ o system/.
          </Text>
        }
        renderItem={({ item }) => <GameCard entry={item} width={cardW} onPlay={onPlay} onRemoved={() => refresh()} />}
      />
    </View>
  );
}

function SectionTitle({
  title,
  detail,
  action,
  onAction,
}: {
  title: string;
  detail?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
      <View style={styles.sectionRule} />
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const ConsoleCard = memo(function ConsoleCard({
  id,
  name,
  count,
  width,
  selected,
  onPress,
}: {
  id: Console;
  name: string;
  count: number;
  width: number;
  selected: boolean;
  onPress: () => void;
}) {
  const glow = ART_GLOW[id as ArtKind];
  const artH = width * 0.62;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.consoleCard,
        { width },
        selected && { borderColor: theme.amber, shadowColor: theme.amber, shadowOpacity: 0.55 },
        pressed && styles.pressed,
      ]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="cc" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1B1E25" />
            <Stop offset="0.6" stopColor="#111318" />
            <Stop offset="1" stopColor="#0A0B0E" />
          </LinearGradient>
          <LinearGradient id="ccLine" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={glow} stopOpacity="0" />
            <Stop offset="0.5" stopColor={glow} stopOpacity="0.9" />
            <Stop offset="1" stopColor={glow} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#cc)" />
        <Rect x="0" y="0" width="100%" height="2" fill="url(#ccLine)" />
      </Svg>
      <View style={{ height: artH, alignItems: 'center', justifyContent: 'center' }}>
        <ConsoleArt kind={id as ArtKind} width={width - 8} height={artH} />
      </View>
      <View style={styles.consoleInfo}>
        <Text style={styles.consoleName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.consoleCount, count === 0 && styles.consoleCountEmpty]}>
          {count === 1 ? '1 juego' : `${count} juegos`}
        </Text>
      </View>
    </Pressable>
  );
});

const GameCard = memo(function GameCard({
  entry,
  width,
  compact,
  onPlay,
  onRemoved,
}: {
  entry: Entry;
  width: number;
  compact?: boolean;
  onPlay: Props['onPlay'];
  onRemoved: () => void;
}) {
  const [cover, setCover] = useState<string | null>(null);
  // Tamaño en disco: < 20 KB = archivo incompleto (insignia roja)
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    RNFS.stat(entry.path)
      .then((st) => alive && setSize(Number(st.size)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entry.path]);
  const broken = size !== null && size < MIN_GAME_BYTES && !isSheet(entry.path);
  const core = coreForConsole(entry.console);
  const enabled = core !== null && ENABLED_CORES.has(core);
  const misplaced = core === null && isMisplacedZip(entry.path);

  useEffect(() => subscribeCover(entry.path, entry.console, setCover), [entry.path, entry.console]);

  // Mantener pulsado: eliminar, mover a otra consola y (arcade) cambiar núcleo
  const showMenu = () => {
    Alert.alert(displayTitle(entry.path), `${relativeToDocuments(entry.path)}${size !== null ? ` · ${formatKb(size)}` : ''}`, [
      ...(enabled && isArcadeConsole(entry.console)
        ? [{ text: 'Cambiar núcleo (FBNeo / MAME)', onPress: () => chooseArcadeCore(entry, onPlay) }]
        : []),
      { text: 'Mover a otra consola', onPress: () => chooseMoveTarget(entry, onRemoved) },
      { text: 'Eliminar juego', style: 'destructive' as const, onPress: () => confirmDelete(entry, onRemoved) },
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  };

  const open = async () => {
    if (broken && size !== null) {
      Alert.alert(
        'Archivo incompleto',
        `"${entry.path.split('/').pop()}" pesa solo ${formatKb(size)}: está dañado o la descarga se cortó. ` +
          'Lo normal es eliminarlo y volver a descargarlo.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Eliminar', style: 'destructive', onPress: () => confirmDelete(entry, onRemoved) },
        ],
      );
      return;
    }
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

  const artH = width * 1.36;
  return (
    <Pressable
      onPress={open}
      onLongPress={showMenu}
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
          <>
            {/* Fondo: la misma carátula desenfocada; encima, completa y sin recortes */}
            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={16} />
            <View style={styles.coverDim} />
            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          </>
        ) : (
          <View style={styles.monogram}>
            <JLBadge size={width * 0.42} />
            <Text style={styles.monogramTitle} numberOfLines={3}>
              {displayTitle(entry.path)}
            </Text>
          </View>
        )}
        {/* Brillo superior tipo vitrina */}
        <View style={styles.sheen} pointerEvents="none" />
        {broken ? (
          <View style={styles.brokenBadge}>
            <Text style={styles.brokenText}>Archivo incompleto</Text>
          </View>
        ) : null}
        {entry.console in CONSOLE_LABEL ? (
          <View style={styles.badge}>
            <ConsoleIcon kind={entry.console as Console} size={12} color={theme.amber} />
            <Text style={styles.badgeText}>{CONSOLE_LABEL[entry.console as Console]}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.cardTitle, compact && styles.cardTitleCompact]} numberOfLines={compact ? 1 : 2}>
        {displayTitle(entry.path)}
      </Text>
      {compact ? null : (
        <Text style={[styles.cardSub, misplaced && styles.warn]} numberOfLines={1}>
          {misplaced
            ? '⚠ Mover a arcade/ · toca para ver'
            : core
              ? enabled
                ? relativeToDocuments(entry.path)
                : 'Núcleo no incluido'
              : 'Sin consola verificada'}
        </Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeGlow: {
    borderRadius: 14,
    shadowColor: '#38BDF8',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  title: { color: theme.amber, fontSize: 23, fontWeight: '900', letterSpacing: 2.5 },
  titleLight: { color: theme.text, fontWeight: '300', letterSpacing: 3 },
  subtitle: { color: theme.textDim, fontSize: 12, marginTop: 2, letterSpacing: 0.4 },
  refresh: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  unpackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.amber,
    backgroundColor: theme.amberDim,
  },
  unpackText: { flex: 1, color: theme.text, fontSize: 13 },
  section: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 12 },
  sectionTitle: { color: theme.amber, fontSize: 12, fontWeight: '800', letterSpacing: 2.2 },
  sectionDetail: { color: theme.textDim, fontSize: 12, fontWeight: '600' },
  sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
  sectionAction: { color: theme.titaniumHi, fontSize: 12, fontWeight: '700' },
  consoleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  consoleCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  consoleInfo: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 2 },
  consoleName: { color: theme.text, fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  consoleCount: { color: theme.amber, fontSize: 12, fontWeight: '700', marginTop: 2 },
  consoleCountEmpty: { color: theme.textDim, fontWeight: '500' },
  recentRow: { gap: 12, paddingRight: SIDE },
  recentEmpty: { color: theme.textDim, fontSize: 13, paddingVertical: 8 },
  home: { paddingHorizontal: SIDE, paddingBottom: 28 },
  viewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 },
  back: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.amber,
    backgroundColor: theme.amberDim,
  },
  backText: { color: theme.amber, fontWeight: '800', fontSize: 14 },
  viewHero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  viewHeroText: { flex: 1 },
  viewTitle: { color: theme.text, fontSize: 24, fontWeight: '800', letterSpacing: 0.4 },
  viewCount: { color: theme.amber, fontSize: 13, fontWeight: '700', marginTop: 3 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    marginBottom: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  searchInput: { flex: 1, color: theme.text, fontSize: 15, paddingVertical: 10 },
  error: { color: theme.danger, paddingBottom: 8 },
  hint: { color: theme.textDim, padding: 24, textAlign: 'center', lineHeight: 20 },
  grid: { paddingHorizontal: SIDE, paddingBottom: 24, gap: GAP + 6 },
  card: {},
  cardDisabled: { opacity: 0.45 },
  art: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(212,175,55,0.35)',
    backgroundColor: theme.surface,
  },
  coverDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,12,0.45)' },
  sheen: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '38%',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  monogram: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 10 },
  monogramTitle: { color: theme.titaniumHi, fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 8 },
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
  brokenBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    left: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(200,40,40,0.92)',
    borderRadius: 8,
    paddingVertical: 4,
  },
  brokenText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  cardTitle: { color: theme.text, fontSize: 13, fontWeight: '600', marginTop: 8, lineHeight: 17 },
  cardTitleCompact: { fontSize: 12, marginTop: 6 },
  cardSub: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  warn: { color: theme.amber },
});
