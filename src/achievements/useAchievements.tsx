import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CoreId } from '../emulator/cores';
import {
  BADGE_URL,
  fetchGame,
  identifyGame,
  loadRaAccount,
  raConsoleFor,
  RaAchievement,
  RaGame,
  recordUnlock,
  storeSummary,
  summarize,
} from './ra';

export type Unlock = { achievement: RaAchievement; earned: number; total: number };

export type AchievementsState = {
  status: 'off' | 'loading' | 'active' | 'none' | 'error';
  message: string;
  game: RaGame | null;
  /** Banner en pantalla (el siguiente de la cola). */
  banner: Unlock | null;
  /** Progreso medido en vivo de un logro ("Reúne 50 monedas: 32/50"). */
  progress: { title: string; value: number; target: number } | null;
};

/**
 * Logros de la partida: identifica el juego, activa las condiciones en nativo (rcheevos) y
 * consulta los desbloqueos. Cada logro nuevo se encola como banner tipo trofeo con sonido.
 */
export function useAchievements(romPath: string, core: CoreId | null, ready: boolean): AchievementsState {
  const [state, setState] = useState<AchievementsState>({
    status: 'off',
    message: '',
    game: null,
    banner: null,
    progress: null,
  });
  const queue = useRef<Unlock[]>([]);
  const gameRef = useRef<RaGame | null>(null);

  useEffect(() => {
    if (!ready || !core) return;
    let alive = true;
    (async () => {
      const acc = await loadRaAccount();
      if (!acc || !alive) return;
      const consoleId = raConsoleFor(core, romPath);
      if (!consoleId) return;
      setState((s) => ({ ...s, status: 'loading', message: 'Buscando logros…' }));
      try {
        const { gameId } = await identifyGame(romPath, consoleId);
        if (!alive) return;
        if (!gameId) {
          setState((s) => ({ ...s, status: 'none', message: 'Este juego no tiene logros en RetroAchievements' }));
          return;
        }
        const game = await fetchGame(gameId, acc);
        if (!alive) return;
        gameRef.current = game;
        storeSummary(romPath, summarize(game));
        const pending = game.achievements.filter((a) => !a.earnedOnline && !a.earnedLocal && a.memaddr);
        Libretro.raActivate(JSON.stringify(pending.map((a) => ({ id: a.id, memaddr: a.memaddr }))), consoleId);
        const s = summarize(game);
        setState((st) => ({
          ...st,
          status: 'active',
          game,
          message: `🏆 ${s.earned}/${s.total} logros · ${pending.length} por conseguir`,
        }));
      } catch (e) {
        if (alive) setState((s) => ({ ...s, status: 'error', message: `Logros: ${(e as Error).message}` }));
      }
    })();
    return () => {
      alive = false;
      Libretro.raReset();
    };
  }, [ready, core, romPath]);

  // Consulta de eventos del hilo de emulación
  useEffect(() => {
    if (state.status !== 'active') return;
    const id = setInterval(() => {
      let events: { id: number; type: string; value: number; target: number }[] = [];
      try {
        events = JSON.parse(Libretro.raPoll());
      } catch {
        return;
      }
      const game = gameRef.current;
      if (!game || events.length === 0) return;
      for (const e of events) {
        const ach = game.achievements.find((a) => a.id === e.id);
        if (!ach) continue;
        if (e.type === 'unlock') {
          ach.earnedLocal = Date.now();
          recordUnlock(game.gameId, ach.id);
          const s = summarize(game);
          queue.current.push({ achievement: ach, earned: s.earned, total: s.total });
          storeSummary(romPath, s);
        } else if (e.type === 'progress' && e.target > 0) {
          setState((st) => ({ ...st, progress: { title: ach.title, value: e.value, target: e.target } }));
        }
      }
      setState((st) => (st.banner || queue.current.length === 0 ? st : { ...st, banner: queue.current.shift() ?? null }));
    }, 400);
    return () => clearInterval(id);
  }, [state.status, romPath]);

  // Cada banner dura 4,5 s; luego pasa el siguiente de la cola
  useEffect(() => {
    if (!state.banner) return;
    try {
      Libretro.uiSound('trophy');
      Libretro.hapticKind('success');
    } catch {
      // nativo antiguo
    }
    const id = setTimeout(() => setState((st) => ({ ...st, banner: queue.current.shift() ?? null })), 4500);
    return () => clearTimeout(id);
  }, [state.banner]);

  // El progreso medido se oculta solo
  useEffect(() => {
    if (!state.progress) return;
    const id = setTimeout(() => setState((st) => ({ ...st, progress: null })), 2500);
    return () => clearTimeout(id);
  }, [state.progress]);

  return state;
}

/** Banner animado estilo trofeo (arriba, centrado). */
export function AchievementBanner({ unlock, landscape }: { unlock: Unlock | null; landscape: boolean }) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<Unlock | null>(unlock);

  useEffect(() => {
    if (unlock) {
      setShown(unlock);
      anim.setValue(0);
      shine.setValue(0);
      Animated.parallel([
        Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 7, tension: 70 }),
        Animated.timing(shine, { toValue: 1, duration: 1300, delay: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      const out = setTimeout(
        () => Animated.timing(anim, { toValue: 0, duration: 320, useNativeDriver: true }).start(),
        4100,
      );
      return () => clearTimeout(out);
    }
    return undefined;
  }, [unlock, anim, shine]);

  if (!shown) return null;
  const a = shown.achievement;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.banner,
        landscape && styles.bannerLandscape,
        { top: insets.top + 8 },
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-90, 0] }) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
          ],
        },
      ]}>
      <View style={styles.badgeWrap}>
        {a.badge ? <Image source={{ uri: BADGE_URL(a.badge) }} style={styles.badge} /> : <Text style={styles.trophy}>🏆</Text>}
      </View>
      <View style={styles.texts}>
        <Text style={styles.kicker}>LOGRO DESBLOQUEADO · {a.points} pts</Text>
        <Text style={styles.title} numberOfLines={1}>
          {a.title}
        </Text>
        <Text style={styles.desc} numberOfLines={1}>
          {a.description}
        </Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${shown.total ? (shown.earned / shown.total) * 100 : 0}%` }]} />
        </View>
      </View>
      <Animated.View
        style={[
          styles.shine,
          { transform: [{ translateX: shine.interpolate({ inputRange: [0, 1], outputRange: [-120, 420] }) }, { rotate: '18deg' }] },
        ]}
      />
    </Animated.View>
  );
}

/** Aviso pequeño de progreso medido ("32/50"). */
export function AchievementProgress({ progress }: { progress: AchievementsState['progress'] }) {
  if (!progress) return null;
  return (
    <View pointerEvents="none" style={styles.progress}>
      <Text style={styles.progressText} numberOfLines={1}>
        🏆 {progress.title} · {progress.value}/{progress.target}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 54,
    alignSelf: 'center',
    width: '92%',
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(14,18,26,0.94)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,200,61,0.75)',
    shadowColor: '#FFC83D',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    overflow: 'hidden',
    zIndex: 50,
  },
  bannerLandscape: { top: 10 },
  badgeWrap: {
    width: 58,
    height: 58,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFC83D',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A2330',
  },
  badge: { width: 54, height: 54 },
  trophy: { fontSize: 30 },
  texts: { flex: 1, gap: 2 },
  kicker: { color: '#FFC83D', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  desc: { color: '#A9B4C2', fontSize: 12 },
  bar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', marginTop: 5, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: '#FFC83D' },
  shine: { position: 'absolute', top: -40, bottom: -40, width: 46, backgroundColor: 'rgba(255,255,255,0.13)' },
  progress: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(14,18,26,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,200,61,0.5)',
    zIndex: 40,
  },
  progressText: { color: '#FFE7A3', fontSize: 12, fontWeight: '700' },
});
