import AsyncStorage from '@react-native-async-storage/async-storage';
import { Libretro } from 'react-native-libretro';
import type { CoreId } from '../emulator/cores';

// RetroAchievements: cuenta (usuario + Web API Key), identificación del juego por su hash RA,
// definiciones de logros (MemAddr) para evaluarlas en el iPhone y progreso del usuario.
//
// Con la Web API Key los logros se detectan y se guardan en este iPhone; la web de
// RetroAchievements solo registra desbloqueos hechos con la contraseña de la cuenta (API de
// emuladores), que esta app no pide.

const ACCOUNT_KEY = 'jl.ra.account.v1';
const GAMES_KEY = 'jl.ra.games.v1';
const UNLOCKS_KEY = 'jl.ra.unlocks.v1';
const API = 'https://retroachievements.org/API';
const CONNECT = 'https://retroachievements.org/dorequest.php';
export const BADGE_URL = (badge: string) => `https://media.retroachievements.org/Badge/${badge}.png`;

export type RaAccount = { user: string; key: string; points?: number; avatar?: string };

export type RaAchievement = {
  id: number;
  title: string;
  description: string;
  points: number;
  badge: string;
  memaddr: string;
  /** Desbloqueado en la cuenta de RetroAchievements (web). */
  earnedOnline: boolean;
  /** Desbloqueado en este iPhone (ms). */
  earnedLocal?: number;
};

export type RaGame = {
  gameId: number;
  title: string;
  console: string;
  icon: string;
  achievements: RaAchievement[];
};

export type RaSummary = { gameId: number; title: string; earned: number; total: number; points: number; maxPoints: number };

// ---- Cuenta ------------------------------------------------------------------------------------
let account: RaAccount | null = null;
let accountLoaded = false;
const accountListeners = new Set<(a: RaAccount | null) => void>();

export async function loadRaAccount(): Promise<RaAccount | null> {
  if (accountLoaded) return account;
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_KEY);
    account = raw ? (JSON.parse(raw) as RaAccount) : null;
  } catch {
    account = null;
  }
  accountLoaded = true;
  return account;
}

export function subscribeRaAccount(fn: (a: RaAccount | null) => void): () => void {
  accountListeners.add(fn);
  loadRaAccount().then((a) => accountListeners.has(fn) && fn(a));
  return () => accountListeners.delete(fn);
}

function q(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function getJSON<T>(url: string, timeoutMs = 12000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error('Usuario o Web API Key incorrectos');
    if (!res.ok) throw new Error(`RetroAchievements respondió ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Comprueba la cuenta con la API y la guarda. Lanza un Error con el motivo si no vale. */
export async function signInRa(user: string, key: string): Promise<RaAccount> {
  const u = user.trim();
  const k = key.trim();
  if (!u || !k) throw new Error('Escribe tu usuario y tu Web API Key');
  type Profile = { User?: string; TotalPoints?: number; UserPic?: string };
  const profile = await getJSON<Profile>(`${API}/API_GetUserProfile.php?${q({ u, y: k })}`);
  if (!profile || !profile.User) throw new Error('No se encontró ese usuario en RetroAchievements');
  account = {
    user: profile.User,
    key: k,
    points: profile.TotalPoints,
    avatar: profile.UserPic ? `https://media.retroachievements.org${profile.UserPic}` : undefined,
  };
  accountLoaded = true;
  await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  accountListeners.forEach((l) => l(account));
  return account;
}

export async function signOutRa(): Promise<void> {
  account = null;
  accountLoaded = true;
  await AsyncStorage.removeItem(ACCOUNT_KEY).catch(() => {});
  accountListeners.forEach((l) => l(null));
}

// ---- Consola de RetroAchievements (ids de rc_consoles.h) --------------------------------------
export function raConsoleFor(core: CoreId | null, romPath: string): number {
  const ext = (romPath.split('.').pop() ?? '').toLowerCase();
  switch (core) {
    case 'mgba':
      return ext === 'gb' ? 4 : ext === 'gbc' ? 6 : 5;
    case 'gambatte':
      return ext === 'gbc' ? 6 : 4;
    case 'fceumm':
      return 7;
    case 'snes9x':
      return 3;
    case 'mupen64':
      return 2;
    case 'melonds':
    case 'desmume':
      return 18;
    case 'pcsx':
    case 'swanstation':
      return 12;
    case 'ppsspp':
      return 41;
    case 'yabause':
      return 39;
    case 'flycast':
      return 40;
    case 'fbneo':
    case 'mame':
      return 27;
    case 'genesis':
      if (ext === 'sms') return 11;
      if (ext === 'gg') return 15;
      if (ext === '32x') return 10;
      if (['cue', 'chd', 'iso', 'bin', 'm3u'].includes(ext)) return 9;
      return 1;
    default:
      return 0;
  }
}

// ---- Caché de juegos (ruta -> hash, id) y desbloqueos locales ------------------------------------
type GameCache = Record<string, { hash: string; gameId: number; summary?: RaSummary }>;
let games: GameCache | null = null;
let unlocks: Record<string, Record<string, number>> | null = null;
const summaryListeners = new Set<() => void>();

async function loadCaches(): Promise<void> {
  if (games && unlocks) return;
  try {
    const [g, u] = await Promise.all([AsyncStorage.getItem(GAMES_KEY), AsyncStorage.getItem(UNLOCKS_KEY)]);
    games = g ? JSON.parse(g) : {};
    unlocks = u ? JSON.parse(u) : {};
  } catch {
    games = {};
    unlocks = {};
  }
}

function persistGames() {
  AsyncStorage.setItem(GAMES_KEY, JSON.stringify(games ?? {})).catch(() => {});
}

/** Guarda un desbloqueo hecho en este iPhone. */
export async function recordUnlock(gameId: number, achievementId: number): Promise<void> {
  await loadCaches();
  const key = String(gameId);
  if (!unlocks![key]) unlocks![key] = {};
  const g = unlocks![key];
  if (!g[achievementId]) g[achievementId] = Date.now();
  AsyncStorage.setItem(UNLOCKS_KEY, JSON.stringify(unlocks)).catch(() => {});
}

/** Identifica el juego: hash RA (nativo) y su id en RetroAchievements. 0 = sin logros. */
export async function identifyGame(romPath: string, consoleId: number): Promise<{ hash: string; gameId: number }> {
  await loadCaches();
  const cached = games![romPath];
  if (cached && cached.gameId > 0) return cached;
  const hash = await Libretro.raHash(romPath, consoleId);
  if (!hash || hash.startsWith('!')) throw new Error(hash ? hash.slice(1) : 'No se pudo calcular el hash');
  type GameIdReply = { Success?: boolean; GameID?: number };
  const reply = await getJSON<GameIdReply>(`${CONNECT}?${q({ r: 'gameid', m: hash })}`);
  const gameId = reply && reply.Success ? Number(reply.GameID) || 0 : 0;
  games![romPath] = { hash, gameId };
  persistGames();
  return { hash, gameId };
}

type ApiAchievement = {
  ID: number | string;
  Title?: string;
  Description?: string;
  Points?: number | string;
  BadgeName?: string;
  MemAddr?: string;
  DateEarned?: string | null;
  DateEarnedHardcore?: string | null;
  Flags?: number | string;
};
type ApiGame = {
  Title?: string;
  ConsoleName?: string;
  ImageIcon?: string;
  Achievements?: Record<string, ApiAchievement> | ApiAchievement[];
};

function listOf(a: ApiGame['Achievements']): ApiAchievement[] {
  if (!a) return [];
  return Array.isArray(a) ? a : Object.values(a);
}

/** Logros del juego con el progreso de la cuenta (web) y los desbloqueos de este iPhone. */
export async function fetchGame(gameId: number, acc: RaAccount): Promise<RaGame> {
  await loadCaches();
  const [progress, extended] = await Promise.all([
    getJSON<ApiGame>(`${API}/API_GetGameInfoAndUserProgress.php?${q({ g: gameId, u: acc.user, y: acc.key })}`),
    getJSON<ApiGame>(`${API}/API_GetGameExtended.php?${q({ i: gameId, y: acc.key })}`).catch(() => ({}) as ApiGame),
  ]);
  const memaddr = new Map<number, string>();
  for (const a of listOf(extended.Achievements)) if (a.MemAddr) memaddr.set(Number(a.ID), a.MemAddr);
  const local = unlocks![String(gameId)] ?? {};
  const achievements: RaAchievement[] = listOf(progress.Achievements)
    // Flags 5 = no oficiales (en pruebas): no cuentan
    .filter((a) => Number(a.Flags ?? 3) !== 5)
    .map((a) => {
      const id = Number(a.ID);
      return {
        id,
        title: a.Title ?? '',
        description: a.Description ?? '',
        points: Number(a.Points) || 0,
        badge: a.BadgeName ?? '',
        memaddr: a.MemAddr ?? memaddr.get(id) ?? '',
        earnedOnline: Boolean(a.DateEarned || a.DateEarnedHardcore),
        earnedLocal: local[id],
      };
    });
  return {
    gameId,
    title: progress.Title ?? '',
    console: progress.ConsoleName ?? '',
    icon: progress.ImageIcon ? `https://media.retroachievements.org${progress.ImageIcon}` : '',
    achievements,
  };
}

export function summarize(game: RaGame): RaSummary {
  const earned = game.achievements.filter((a) => a.earnedOnline || a.earnedLocal);
  return {
    gameId: game.gameId,
    title: game.title,
    earned: earned.length,
    total: game.achievements.length,
    points: earned.reduce((n, a) => n + a.points, 0),
    maxPoints: game.achievements.reduce((n, a) => n + a.points, 0),
  };
}

/** Guarda el resumen para la ficha del juego (se muestra sin red). */
export async function storeSummary(romPath: string, summary: RaSummary): Promise<void> {
  await loadCaches();
  const g = games![romPath];
  if (!g) return;
  g.summary = summary;
  persistGames();
  summaryListeners.forEach((l) => l());
}

export async function cachedSummary(romPath: string): Promise<RaSummary | null> {
  await loadCaches();
  return games![romPath]?.summary ?? null;
}

export function subscribeSummaries(fn: () => void): () => void {
  summaryListeners.add(fn);
  return () => summaryListeners.delete(fn);
}

/**
 * Ficha del juego: resumen de logros (red si hay cuenta; si no, el último guardado).
 * null = sin cuenta o el juego no tiene logros.
 */
export async function summaryForRom(romPath: string, core: CoreId | null): Promise<RaSummary | null> {
  const acc = await loadRaAccount();
  const cached = await cachedSummary(romPath);
  if (!acc) return cached;
  try {
    const consoleId = raConsoleFor(core, romPath);
    if (!consoleId) return null;
    const { gameId } = await identifyGame(romPath, consoleId);
    if (!gameId) return null;
    const summary = summarize(await fetchGame(gameId, acc));
    await storeSummary(romPath, summary);
    return summary;
  } catch {
    return cached;
  }
}
