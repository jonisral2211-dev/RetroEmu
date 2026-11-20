import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Libretro } from 'react-native-libretro';
import { useExperience } from '../../ui/experiencePrefs';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { reloadCover } from '../../covers/CoverCache';
import { patchInfo, pickPatch, removePatch } from '../../mods/patches';
import { gameIdOf, importTextures, removeTextures, setTextures, textureInfo } from '../../mods/textures';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ALL_CONSOLES, Console, isArcadeConsole } from '../../emulator/cores';
import { NavKey, usePadNav } from '../../input/uiNav';
import { useGamepadStatus } from '../../input/useGamepadStatus';
import { subscribeFavorites, toggleFavorite } from '../../library/favorites';
import { folderInfo, importFolder, importSummary, loadSyncPrefs } from '../../library/folderSync';
import { formatPlaytime, subscribePlaytime } from '../../library/playtime';
import { subscribeRecents } from '../../library/recents';
import { Entry, useLibrary } from '../../library/useLibrary';
import { playUi } from '../../ui/uiSounds';
import FolderScanScreen from '../FolderScanScreen';
import {
  chooseArcadeCore,
  chooseMoveTarget,
  confirmDelete,
  displayTitle,
  launchEntry,
  pickCover,
  PlayFn,
} from '../LibraryScreen';
import OrganizerScreen from '../OrganizerScreen';
import { SettingsScreen, WifiUploadScreen } from '../ToolsScreen';
import { GameTile, HeroBanner, PadGlyph, S } from './art';
import GameDetails from './GameDetails';

// Interfaz "Gaming Mode" estilo SteamOS / Big Picture: pestañas, banner del juego enfocado,
// carruseles horizontales, ficha previa con JUGAR y control total con el mando.

const TABS = ['Inicio', 'Biblioteca', 'Por consola', 'Favoritos'] as const;
type Tab = 0 | 1 | 2 | 3;

const CONSOLE_NAME: Record<Console, string> = {
  ps1: 'PlayStation',
  psp: 'PSP',
  n64: 'Nintendo 64',
  nds: 'Nintendo DS',
  snes: 'Super Nintendo',
  gba: 'Game Boy Advance',
  gbc: 'Game Boy Color',
  gb: 'Game Boy',
  nes: 'NES',
  dreamcast: 'Dreamcast',
  n3ds: 'Nintendo 3DS',
  ps2: 'PlayStation 2',
  ports: 'Ports PC',
  saturn: 'Sega Saturn',
  sega: 'Sega Mega Drive',
  fbneo: 'FBNeo Arcade',
  mame: 'MAME Arcade',
};

type Shelf = { key: string; title: string; items: Entry[]; variant: 'wide' | 'box'; grid: boolean };

const SIDE = 16;
const GAP = 14;
const TITLE_H = 34;

function useClock(): string {
  const fmt = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setNow(fmt()), 20000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function SteamLibrary({ onPlay, active }: { onPlay: PlayFn; active: boolean }) {
  // Música ambiental: solo con la biblioteca visible (nunca durante una partida)
  const experience = useExperience();
  useEffect(() => {
    Libretro.ambientVolume(experience.musicVolume);
    Libretro.ambientMusic(active && experience.music);
  }, [active, experience.music, experience.musicVolume]);
  useEffect(() => () => Libretro.ambientMusic(false), []);

  const { entries, error, unpacking, refresh } = useLibrary();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pad = useGamepadStatus();
  const clock = useClock();

  const [recents, setRecents] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [playtime, setPlaytime] = useState<Record<string, number>>({});
  useEffect(() => subscribeRecents(setRecents), []);
  useEffect(() => subscribeFavorites(setFavorites), []);
  useEffect(() => subscribePlaytime(setPlaytime), []);

  const [tab, setTab] = useState<Tab>(0);
  const [zone, setZone] = useState<'tabs' | 'content'>('content');
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const [details, setDetails] = useState<Entry | null>(null);
  const [overlay, setOverlay] = useState<'settings' | 'folder' | 'wifi' | 'organizer' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 4500);
  }, []);

  // ---- Tamaños -----------------------------------------------------------------------------
  const landscape = width > height;
  const heroH = Math.round(Math.min(landscape ? height * 0.42 : height * 0.3, 300));
  const wideW = Math.round(Math.min(340, Math.max(210, width * (landscape ? 0.3 : 0.6))));
  const wideH = Math.round((wideW * 9) / 16);
  const boxW = Math.round(Math.min(150, Math.max(92, width / (landscape ? 7.5 : 3.7))));
  const boxH = Math.round(boxW * 1.4);
  const gridCols = Math.max(2, Math.floor((width - SIDE * 2 + GAP) / (boxW + GAP)));
  const rowH = (s: Shelf) => (s.title ? TITLE_H : 0) + (s.variant === 'wide' ? wideH : boxH + 22) + 22;

  // ---- Estantes de cada pestaña -------------------------------------------------------------
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const shelves: Shelf[] = useMemo(() => {
    const byPath = new Map(entries.map((e) => [e.path, e]));
    const recent = recents.map((p) => byPath.get(p)).filter((e): e is Entry => !!e);
    const favs = favorites.map((p) => byPath.get(p)).filter((e): e is Entry => !!e);
    const az = [...entries].sort((a, b) => displayTitle(a.path).localeCompare(displayTitle(b.path)));
    const grid = (key: string, title: string, list: Entry[]): Shelf[] => {
      const rows: Shelf[] = [];
      for (let i = 0; i < list.length; i += gridCols) {
        rows.push({ key: `${key}${i}`, title: i === 0 ? title : '', items: list.slice(i, i + gridCols), variant: 'box', grid: true });
      }
      return rows;
    };
    if (tab === 0) {
      const out: Shelf[] = [];
      if (recent.length) out.push({ key: 'recent', title: 'Seguir jugando', items: recent, variant: 'wide', grid: false });
      if (favs.length) out.push({ key: 'fav', title: 'Favoritos', items: favs, variant: 'box', grid: false });
      // Una fila por consola con sus juegos (las que tienen más primero)
      const counts = ALL_CONSOLES.map((c) => ({ c, list: az.filter((e) => e.console === c) }))
        .filter((x) => x.list.length)
        .sort((a, b) => b.list.length - a.list.length);
      counts.slice(0, 4).forEach(({ c, list }) =>
        out.push({ key: `h-${c}`, title: CONSOLE_NAME[c], items: list.slice(0, 30), variant: 'box', grid: false }),
      );
      return out;
    }
    if (tab === 1) return grid('lib', `Biblioteca · ${az.length} juegos`, az);
    if (tab === 2) {
      return ALL_CONSOLES.map((c) => ({ c, list: az.filter((e) => e.console === c) }))
        .filter((x) => x.list.length)
        .map(({ c, list }) => ({ key: `c-${c}`, title: `${CONSOLE_NAME[c]} · ${list.length}`, items: list, variant: 'box' as const, grid: false }));
    }
    return grid('favs', `Favoritos · ${favs.length}`, favs);
  }, [entries, recents, favorites, tab, gridCols]);

  // Posición vertical de cada estante (alturas fijas: desplazamiento exacto con el mando)
  const offsets = useMemo(() => {
    const out: number[] = [];
    let y = 0;
    for (const s of shelves) {
      out.push(y);
      y += rowH(s);
    }
    return out;
  }, [shelves, wideH, boxH]); // eslint-disable-line react-hooks/exhaustive-deps

  // El foco nunca apunta fuera de los estantes (al cambiar de pestaña o al borrar un juego)
  const row = Math.min(focus.row, Math.max(0, shelves.length - 1));
  const col = Math.min(focus.col, Math.max(0, (shelves[row]?.items.length ?? 1) - 1));
  const focused: Entry | undefined = shelves[row]?.items[col] ?? shelves[0]?.items[0];

  // ---- Desplazamiento hacia el foco -----------------------------------------------------------
  const listRef = useRef<FlatList<Shelf>>(null);
  const rowRefs = useRef(new Map<string, FlatList<Entry> | null>());
  const colMemory = useRef(new Map<string, number>());
  useEffect(() => {
    if (!shelves.length) return;
    listRef.current?.scrollToOffset({ offset: Math.max(0, (offsets[row] ?? 0) - 8), animated: true });
  }, [row, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = shelves[row];
    if (!s || s.grid) return;
    colMemory.current.set(s.key, col);
    try {
      rowRefs.current.get(s.key)?.scrollToIndex({ index: col, viewPosition: 0.3, animated: true });
    } catch {
      // fila aún sin medir
    }
  }, [row, col]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeTab = (next: number) => {
    const t = ((next + TABS.length) % TABS.length) as Tab;
    if (t === tab) return;
    playUi('tab');
    setTab(t);
    setFocus({ row: 0, col: 0 });
    colMemory.current.clear();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  // ---- Acciones ----------------------------------------------------------------------------
  const openDetails = (e: Entry | undefined) => {
    if (!e) return;
    playUi('select');
    setDetails(e);
  };

  const play = (e: Entry, slot?: number) => {
    setDetails(null);
    launchEntry(e, onPlay, () => refresh(), slot);
  };

  const flipFavorite = (e: Entry | undefined) => {
    if (!e) return;
    playUi('select');
    toggleFavorite(e.path).then((on) => showToast(on ? '★ Añadido a Favoritos' : 'Quitado de Favoritos'));
  };

  // Mods y parches: IPS / BPS / UPS (traducciones, ROM hacks) se aplican al lanzar el juego
  const applyPatch = (e: Entry) =>
    pickPatch(e.path)
      .then((name) => {
        if (name) showToast(`Parche guardado: ${name}. Se aplica al abrir el juego`);
      })
      .catch((err) => showToast(String(err?.message ?? err)));
  const modsMenu = (e: Entry) => {
    const p = patchInfo(e.path);
    // Texturas HD: solo PSP (PPSSPP), por ID de juego
    const gameId = e.console === 'psp' ? gameIdOf(e.path) : '';
    const tex = gameId ? textureInfo(gameId) : null;
    const lines = [
      p.active ? `Parche activo: ${p.name}` : 'Parche: ninguno (.ips, .bps o .ups)',
      tex ? (tex.installed ? `Texturas HD: ${tex.enabled ? 'activas' : 'desactivadas'} (${tex.files} archivos)` : 'Texturas HD: no instaladas') : null,
    ].filter(Boolean);
    const texButtons = gameId
      ? [
          { text: 'Importar texturas HD…', onPress: () => importTex(gameId) },
          ...(tex?.installed
            ? [
                {
                  text: tex.enabled ? 'Desactivar texturas HD' : 'Activar texturas HD',
                  onPress: () => {
                    setTextures(gameId, !tex.enabled);
                    showToast(tex.enabled ? 'Texturas HD desactivadas' : 'Texturas HD activas');
                  },
                },
                {
                  text: 'Quitar texturas HD',
                  style: 'destructive' as const,
                  onPress: () => {
                    removeTextures(gameId);
                    showToast('Texturas HD quitadas');
                  },
                },
              ]
            : []),
        ]
      : [];
    Alert.alert('Mods y parches', lines.join('\n'), [
      { text: p.active ? 'Cambiar parche' : 'Aplicar parche…', onPress: () => applyPatch(e) },
      ...(p.active
        ? [
            {
              text: 'Quitar parche',
              style: 'destructive' as const,
              onPress: () => {
                removePatch(e.path);
                showToast('Parche quitado');
              },
            },
          ]
        : []),
      ...texButtons,
      { text: 'Volver', style: 'cancel' as const },
    ]);
  };
  const importTex = (gameId: string) =>
    importTextures(gameId)
      .then((n) => {
        if (n >= 0) showToast(`Texturas HD instaladas (${n} archivos). Se aplican al abrir el juego`);
      })
      .catch((err) => showToast(String(err?.message ?? err)));
  const gameOptions = (e: Entry | undefined) => {
    if (!e) return;
    Alert.alert(displayTitle(e.path), undefined, [
      { text: 'Mods y parches', onPress: () => modsMenu(e) },
      ...(isArcadeConsole(e.console) ? [{ text: 'Cambiar núcleo (FBNeo / MAME)', onPress: () => chooseArcadeCore(e, onPlay) }] : []),
      { text: 'Cambiar carátula (Fotos)', onPress: () => pickCover(e) },
      { text: 'Recargar carátula', onPress: () => reloadCover(e.path, e.console) },
      { text: 'Mover a otra consola', onPress: () => chooseMoveTarget(e, () => refresh()) },
      {
        text: 'Eliminar juego',
        style: 'destructive' as const,
        onPress: () =>
          confirmDelete(e, () => {
            setDetails(null);
            refresh();
          }),
      },
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  };

  // Sincronizar: importa lo nuevo de la carpeta vinculada (o abre el escáner si no hay ninguna)
  const sync = () => {
    const info = folderInfo();
    if (!info.linked) {
      setOverlay('folder');
      return;
    }
    if (syncing) return;
    setSyncing(true);
    showToast(`Sincronizando "${info.name}"…`);
    loadSyncPrefs()
      .then((p) => importFolder(p.move))
      .then((r) => showToast(r.ok ? importSummary(r) : r.error ?? 'No se pudo sincronizar'))
      .catch((e) => showToast(String(e?.message ?? e)))
      .finally(() => {
        setSyncing(false);
        refresh(true);
      });
  };

  // ---- Mando ---------------------------------------------------------------------------------
  const onKey = (key: NavKey) => {
    if (key === 'prevTab' || key === 'nextTab') {
      changeTab(tab + (key === 'prevTab' ? -1 : 1));
      return;
    }
    if (key === 'menu') {
      playUi('select');
      setOverlay('settings');
      return;
    }
    if (key === 'view') {
      sync();
      return;
    }
    if (zone === 'tabs') {
      if (key === 'left' || key === 'right') changeTab(tab + (key === 'left' ? -1 : 1));
      else if (key === 'down' || key === 'accept') {
        playUi('move');
        setZone('content');
      }
      return;
    }
    const shelf = shelves[row];
    if (!shelf) {
      if (key === 'up') setZone('tabs');
      if (key === 'accept') setOverlay('folder');
      return;
    }
    const move = (r: number, c: number) => {
      if (r !== row || c !== col) playUi('move');
      setFocus({ row: r, col: c });
    };
    switch (key) {
      case 'left':
        move(row, Math.max(0, col - 1));
        break;
      case 'right':
        move(row, Math.min(shelf.items.length - 1, col + 1));
        break;
      case 'up':
      case 'down': {
        const r = key === 'up' ? row - 1 : row + 1;
        if (r < 0) {
          playUi('move');
          setZone('tabs');
          break;
        }
        if (r >= shelves.length) break;
        const target = shelves[r];
        const c = target.grid && shelf.grid ? col : (colMemory.current.get(target.key) ?? 0);
        move(r, Math.min(c, target.items.length - 1));
        break;
      }
      case 'accept':
        openDetails(shelf.items[col]);
        break;
      case 'action':
        flipFavorite(shelf.items[col]);
        break;
      case 'option':
        gameOptions(shelf.items[col]);
        break;
      case 'back':
        playUi('back');
        if (row > 0) setFocus({ row: 0, col: colMemory.current.get(shelves[0].key) ?? 0 });
        else setZone('tabs');
        break;
      default:
        break;
    }
  };
  usePadNav(onKey, active && !details && !overlay);
  // Ajustes, escáner, Wi-Fi y organizador: ○ cierra el panel
  usePadNav((key) => {
    if (key !== 'back') return;
    playUi('back');
    setOverlay(null);
  }, active && !!overlay);

  // ---- Pintado -----------------------------------------------------------------------------
  const heroSub = focused
    ? [CONSOLE_NAME[focused.console as Console] ?? focused.console, playtime[focused.path] ? `⏱ ${formatPlaytime(playtime[focused.path])}` : 'Sin jugar']
        .filter(Boolean)
        .join('  ·  ')
    : '';

  const renderShelf = ({ item: shelf, index: r }: { item: Shelf; index: number }) => {
    const tileW = shelf.variant === 'wide' ? wideW : boxW;
    return (
      <View style={{ height: rowH(shelf) }}>
        {shelf.title ? (
          <Text style={[styles.shelfTitle, r === row && zone === 'content' && styles.shelfTitleOn]}>{shelf.title}</Text>
        ) : null}
        {shelf.grid ? (
          <View style={styles.gridRow}>
            {shelf.items.map((e, c) => (
              <GameTile
                key={e.path}
                entry={e}
                title={displayTitle(e.path)}
                variant="box"
                width={boxW}
                focused={zone === 'content' && r === row && c === col}
                favorite={favSet.has(e.path)}
                onPress={() => {
                  setFocus({ row: r, col: c });
                  openDetails(e);
                }}
              />
            ))}
          </View>
        ) : (
          <FlatList
            ref={(ref) => {
              rowRefs.current.set(shelf.key, ref);
            }}
            horizontal
            data={shelf.items}
            keyExtractor={(e) => e.path}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rowContent}
            getItemLayout={(_d, i) => ({ length: tileW + GAP, offset: SIDE + (tileW + GAP) * i, index: i })}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item: e, index: c }) => (
              <View style={{ marginRight: GAP }}>
                <GameTile
                  entry={e}
                  title={displayTitle(e.path)}
                  variant={shelf.variant}
                  width={tileW}
                  focused={zone === 'content' && r === row && c === col}
                  favorite={favSet.has(e.path)}
                  onPress={() => {
                    setFocus({ row: r, col: c });
                    openDetails(e);
                  }}
                />
              </View>
            )}
          />
        )}
      </View>
    );
  };

  const empty = !shelves.length;

  return (
    <View style={styles.root}>
      {/* Barra superior: pestañas, sincronizar, ajustes y hora */}
      <View style={styles.top}>
        {pad.connected ? <PadGlyph kind="l1" /> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map((t, i) => (
            <Pressable
              key={t}
              onPress={() => {
                setZone('content');
                changeTab(i);
              }}
              style={[styles.tab, tab === i && styles.tabOn, zone === 'tabs' && tab === i && styles.tabFocused]}>
              <Text style={[styles.tabText, tab === i && styles.tabTextOn]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {pad.connected ? <PadGlyph kind="r1" /> : null}
        <Pressable onPress={sync} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Sincronizar carpeta">
          {syncing || unpacking ? (
            <ActivityIndicator color={S.blue} size="small" />
          ) : (
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" stroke={S.text} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          )}
        </Pressable>
        <Pressable onPress={() => setOverlay('settings')} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Ajustes">
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Circle cx="12" cy="12" r="3" stroke={S.text} strokeWidth={1.8} fill="none" />
            <Path
              d="M10.3 2.6h3.4l.5 2.6a7.5 7.5 0 0 1 1.9 1.1l2.5-.9 1.7 2.9-2 1.7a7.6 7.6 0 0 1 0 2.2l2 1.7-1.7 2.9-2.5-.9a7.5 7.5 0 0 1-1.9 1.1l-.5 2.6h-3.4l-.5-2.6a7.5 7.5 0 0 1-1.9-1.1l-2.5.9-1.7-2.9 2-1.7a7.6 7.6 0 0 1 0-2.2l-2-1.7 1.7-2.9 2.5.9a7.5 7.5 0 0 1 1.9-1.1z"
              stroke={S.text}
              strokeWidth={1.6}
              fill="none"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
        <Text style={styles.clock}>{clock}</Text>
      </View>

      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{tab === 3 ? 'Aún no tienes favoritos' : 'Tu biblioteca está vacía'}</Text>
          <Text style={styles.emptyText}>
            {tab === 3
              ? 'Pulsa △ (o ☆ en la ficha del juego) para añadir un juego a Favoritos.'
              : 'Vincula tu carpeta de Descargas o iCloud Drive: JL Emulator reconoce cada juego por su cabecera y lo coloca en su consola.'}
          </Text>
          {tab !== 3 ? (
            <Pressable onPress={() => setOverlay('folder')} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>Vincular y escanear carpeta</Text>
            </Pressable>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : (
        <>
          <HeroBanner
            entry={focused}
            title={focused ? displayTitle(focused.path) : ''}
            subtitle={heroSub}
            width={width}
            height={heroH}
            favorite={!!focused && favSet.has(focused.path)}
          />
          <FlatList
            ref={listRef}
            data={shelves}
            keyExtractor={(s) => s.key}
            renderItem={renderShelf}
            getItemLayout={(_d, i) => ({ length: rowH(shelves[i]), offset: offsets[i] ?? 0, index: i })}
            contentContainerStyle={styles.shelves}
            showsVerticalScrollIndicator={false}
            extraData={`${row}:${col}:${zone}:${favorites.length}`}
          />
        </>
      )}

      {/* Barra de ayudas del mando */}
      {pad.connected ? (
        <View style={styles.hints}>
          <Hint glyph="view" text="Sincronizar" />
          <Hint glyph="menu" text="Ajustes" />
          <View style={styles.flex} />
          <Hint glyph="triangle" text="Favorito" />
          <Hint glyph="square" text="Opciones" />
          <Hint glyph="cross" text="Abrir" />
          <Hint glyph="circle" text="Atrás" />
        </View>
      ) : null}

      {toast ? (
        <View style={[styles.toast, { top: insets.top + 8 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {details ? (
        <GameDetails
          entry={details}
          title={displayTitle(details.path)}
          favorite={favSet.has(details.path)}
          playtime={playtime[details.path]}
          active={active && !overlay}
          onPlay={(slot) => play(details, slot)}
          onToggleFavorite={() => flipFavorite(details)}
          onOptions={() => gameOptions(details)}
          onClose={() => setDetails(null)}
        />
      ) : null}

      {overlay === 'settings' ? (
        <View style={StyleSheet.absoluteFill}>
          <SettingsScreen
            onClose={() => setOverlay(null)}
            onWifi={() => setOverlay('wifi')}
            onFolderScan={() => setOverlay('folder')}
            onOrganize={() => setOverlay('organizer')}
          />
        </View>
      ) : null}
      {overlay === 'folder' ? (
        <View style={StyleSheet.absoluteFill}>
          <FolderScanScreen onClose={() => setOverlay(null)} onImported={() => refresh(true)} />
        </View>
      ) : null}
      {overlay === 'wifi' ? (
        <View style={StyleSheet.absoluteFill}>
          <WifiUploadScreen onClose={() => setOverlay(null)} onReceived={() => refresh()} />
        </View>
      ) : null}
      {overlay === 'organizer' ? (
        <View style={StyleSheet.absoluteFill}>
          <OrganizerScreen onClose={() => setOverlay(null)} onDone={() => refresh(true)} />
        </View>
      ) : null}
    </View>
  );
}

function Hint({ glyph, text }: { glyph: React.ComponentProps<typeof PadGlyph>['kind']; text: string }) {
  return (
    <View style={styles.hint}>
      <PadGlyph kind={glyph} />
      <Text style={styles.hintText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: S.bg },
  flex: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: S.bg2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: S.line,
  },
  tabs: { gap: 4, paddingHorizontal: 2 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  tabOn: { backgroundColor: S.panelHi },
  tabFocused: { borderColor: S.focus },
  tabText: { color: S.dim, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: S.text, fontWeight: '900' },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: S.panel },
  clock: { color: S.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], marginLeft: 2 },
  shelves: { paddingTop: 8, paddingBottom: 24 },
  shelfTitle: { color: S.dim, fontSize: 15, fontWeight: '800', paddingHorizontal: SIDE, height: TITLE_H, paddingTop: 8 },
  shelfTitleOn: { color: S.text },
  rowContent: { paddingHorizontal: SIDE, paddingVertical: 8 },
  gridRow: { flexDirection: 'row', gap: GAP, paddingHorizontal: SIDE, paddingVertical: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  emptyTitle: { color: S.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: S.dim, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 460 },
  emptyBtn: { marginTop: 6, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 6, backgroundColor: S.blue },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  error: { color: S.circle, fontSize: 12 },
  hints: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: S.bg2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: S.line,
  },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { color: S.dim, fontSize: 12, fontWeight: '700' },
  toast: {
    position: 'absolute',
    top: 58,
    alignSelf: 'center',
    maxWidth: '88%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(26,35,48,0.96)',
    borderWidth: 1,
    borderColor: S.blue,
  },
  toastText: { color: S.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
