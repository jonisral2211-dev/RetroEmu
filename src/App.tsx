import React, { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { theme } from './theme';
import BrowserScreen from './screens/BrowserScreen';
import GuideScreen from './screens/GuideScreen';
import LibraryScreen from './screens/LibraryScreen';
import type { CoreId } from './emulator/cores';
import { loadGfxPreset } from './emulator/graphics';
import { addRecent } from './library/recents';
import PlayerScreen from './screens/PlayerScreen';

type Tab = 'library' | 'web' | 'guide';

export default function App() {
  // Juego en curso: ruta y, en arcade, el núcleo elegido (FBNeo o MAME)
  const [game, setGame] = useState<{ path: string; core?: CoreId; run?: number } | null>(null);
  // Calidad gráfica guardada: se lee al arrancar (el reproductor la consulta al abrir un juego)
  useEffect(() => {
    loadGfxPreset();
  }, []);
  const romPath = game?.path ?? null;
  const [tab, setTab] = useState<Tab>('library');

  const play = (path: string, core?: CoreId) => {
    addRecent(path);
    setGame({ path, core });
  };

  // Ambas pantallas quedan montadas (la sesión del navegador y la biblioteca se conservan);
  // la inactiva se oculta. Al jugar se oculta todo el contenedor y aparece el reproductor.
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
        {game ? (
          <PlayerScreen
            key={`${game.path}:${game.core ?? ''}:${game.run ?? 0}`}
            romPath={game.path}
            coreOverride={game.core}
            onExit={() => setGame(null)}
            onRetryWithCore={(core) => setGame({ path: game.path, core })}
            onRestart={() => setGame({ path: game.path, run: (game.run ?? 0) + 1 })}
          />
        ) : null}
        <View style={[styles.root, romPath ? styles.hidden : null]}>
          <View style={styles.root}>
            <View style={[styles.pane, tab !== 'library' && styles.hidden]}>
              <LibraryScreen onPlay={play} />
            </View>
            <View style={[styles.pane, tab !== 'web' && styles.hidden]}>
              <BrowserScreen />
            </View>
            {tab === 'guide' ? (
              <View style={styles.pane}>
                <GuideScreen />
              </View>
            ) : null}
          </View>
          <View style={styles.tabBar}>
            <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
              <Defs>
                <LinearGradient id="tb" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#15171D" />
                  <Stop offset="1" stopColor="#0A0B0E" />
                </LinearGradient>
                <LinearGradient id="tbLine" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={theme.amber} stopOpacity="0" />
                  <Stop offset="0.5" stopColor={theme.amber} stopOpacity="0.55" />
                  <Stop offset="1" stopColor={theme.amber} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#tb)" />
              <Rect x="0" y="0" width="100%" height="1" fill="url(#tbLine)" />
            </Svg>
            <TabButton label="Biblioteca" icon="library" active={tab === 'library'} onPress={() => setTab('library')} />
            <TabButton label="Explorar web" icon="web" active={tab === 'web'} onPress={() => setTab('web')} />
            <TabButton label="Guía" icon="guide" active={tab === 'guide'} onPress={() => setTab('guide')} />
          </View>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function TabIcon({ kind, color }: { kind: 'library' | 'web' | 'guide'; color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      {kind === 'library' ? (
        <>
          <Rect x="3" y="3" width="8" height="8" rx="2" stroke={color} strokeWidth={1.8} fill="none" />
          <Rect x="13" y="3" width="8" height="8" rx="2" stroke={color} strokeWidth={1.8} fill="none" />
          <Rect x="3" y="13" width="8" height="8" rx="2" stroke={color} strokeWidth={1.8} fill="none" />
          <Path d="M15.5 14.5 L19.5 17 L15.5 19.5 Z" fill={color} />
        </>
      ) : kind === 'guide' ? (
        <>
          <Path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" stroke={color} strokeWidth={1.8} fill="none" />
          <Path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" stroke={color} strokeWidth={1.8} fill="none" />
          <Path d="M6.5 8h2.5M6.5 11h2.5M15 8h2.5M15 11h2.5" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
        </>
      ) : (
        <>
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.8} fill="none" />
          <Path
            d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"
            stroke={color}
            strokeWidth={1.6}
            fill="none"
          />
        </>
      )}
    </Svg>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: 'library' | 'web' | 'guide';
  active: boolean;
  onPress: () => void;
}) {
  const color = active ? theme.amber : theme.textDim;
  return (
    <Pressable onPress={onPress} style={styles.tab}>
      {/* Acento dorado brillante sobre la pestaña activa */}
      <View style={[styles.tabAccent, active && styles.tabAccentOn]} />
      <View style={active ? styles.iconGlow : undefined}>
        <TabIcon kind={icon} color={color} />
      </View>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  tabBar: { flexDirection: 'row', backgroundColor: theme.bg, paddingBottom: 2 },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 8, gap: 3 },
  tabAccent: { position: 'absolute', top: 0, width: 44, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  tabAccentOn: {
    backgroundColor: theme.amber,
    shadowColor: theme.amber,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  iconGlow: {
    shadowColor: theme.amber,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  tabText: { color: theme.textDim, fontWeight: '600', fontSize: 11, letterSpacing: 0.4 },
  tabTextActive: { color: theme.amber, fontWeight: '800' },
});
