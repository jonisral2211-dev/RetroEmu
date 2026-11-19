import RNFS from 'react-native-fs';
import { portCoreFor, portTitle } from '../emulator/cores';
import { arcadeTitle } from './arcadeNames';

// Carátulas de https://thumbnails.libretro.com/<Sistema>/Named_Boxarts/<Nombre>.png
// Los nombres oficiales llevan región e idiomas ("Diddy Kong Racing (USA) (En,Fr)"), y los de
// los archivos del usuario no suelen coincidir ("Diddy Kong Racing (U) (M2) (V1.1)"). Por eso se
// descarga una vez el índice del sistema (caché 30 días) y se busca por título limpio, con
// prioridad USA > World > Europe > resto. Caché de imágenes en Documents/covers/<consola>/.
// Un archivo .miss2 marca "sin carátula" para no reintentar en cada arranque (7 días).

const COVERS_DIR = `${RNFS.DocumentDirectoryPath}/covers`;
const MISS_TTL_MS = 7 * 24 * 3600 * 1000;
const INDEX_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_PARALLEL = 2;
const BASE = 'https://thumbnails.libretro.com';

const SYSTEM_DIR: Record<string, string> = {
  gba: 'Nintendo - Game Boy Advance',
  n64: 'Nintendo - Nintendo 64',
  sega: 'Sega - Mega Drive - Genesis',
  ps1: 'Sony - PlayStation',
  mame: 'MAME',
  fbneo: 'FBNeo - Arcade Games',
  psp: 'Sony - PlayStation Portable',
  nds: 'Nintendo - Nintendo DS',
  saturn: 'Sega - Saturn',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  nes: 'Nintendo - Nintendo Entertainment System',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  dreamcast: 'Sega - Dreamcast',
  // Ports: un "sistema" de libretro-thumbnails por motor (ver portThumbConsole)
  'ports-prboom': 'DOOM',
  'ports-tyrquake': 'Quake',
  'ports-vitaquake2': 'Quake II',
  'ports-ecwolf': 'Wolfenstein 3D',
  'ports-nxengine': 'Cave Story',
  'ports-cannonball': 'Cannonball',
  'ports-reminiscence': 'Flashback',
  'ports-scummvm': 'ScummVM',
  'ports-easyrpg': 'RPG Maker',
};

// Un port se busca en el repositorio de su motor y por el nombre de su carpeta si el archivo es
// genérico (pak0.pak, Doukutsu.exe…)
function portThumbConsole(romPath: string): { console: string; name: string } | null {
  const core = portCoreFor(romPath);
  if (!core) return null;
  const title = portTitle(romPath);
  return { console: `ports-${core}`, name: title ? `${title}.png` : (romPath.split('/').pop() ?? romPath) };
}

/** Nombre de archivo según la convención de libretro-thumbnails: &*\/:`<>?\|" -> _ */
export function thumbnailName(romPath: string): string {
  const file = romPath.split('/').pop() ?? romPath;
  const base = file.replace(/\.[^.]+$/, '');
  return base.replace(/[&*/:`<>?\\|"]/g, '_');
}

/**
 * Título limpio para comparar: sin (…) ni […], sin puntuación, espacios ni mayúsculas.
 * "Diddy Kong Racing (U) (M2) (V1.1)" y "Diddy Kong Racing (USA) (En,Fr)" -> "diddykongracing".
 * "Legend of Zelda, The - …" y "The Legend of Zelda - …" también coinciden.
 */
export function titleKey(name: string): string {
  let t = name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  t = t.replace(/^the\s+/, '').replace(/,\s*the(\s*-|$)/, '$1');
  return t.replace(/[^a-z0-9]/g, '');
}

// Preferencia entre varias carátulas del mismo título
function rank(name: string): number {
  let r = 50;
  if (/\(USA/.test(name)) r = 0;
  else if (/\(World/.test(name)) r = 10;
  else if (/\(Europe/.test(name)) r = 20;
  else if (/\(Japan/.test(name)) r = 30;
  if (/\((Beta|Proto|Demo|Sample|Kiosk)/i.test(name)) r += 100;
  if (/\(Rev/i.test(name)) r += 1;
  return r * 1000 + name.length;
}

// Tipo de imagen: carátula (Named_Boxarts) o captura panorámica para los banners (Named_Snaps).
// Las capturas se guardan aparte, en Documents/covers/<consola>/snaps/.
type Art = 'Named_Boxarts' | 'Named_Snaps';
const BOX: Art = 'Named_Boxarts';
const artDir = (console: string, art: Art) => (art === BOX ? `${COVERS_DIR}/${console}` : `${COVERS_DIR}/${console}/snaps`);

// ---- Índice por sistema ---------------------------------------------------------
type Index = Map<string, string[]>; // titleKey -> nombres oficiales (sin .png)
const indexes = new Map<string, Promise<Index | null>>();

function buildIndex(names: string[]): Index {
  const idx: Index = new Map();
  for (const n of names) {
    const k = titleKey(n);
    if (!k) continue;
    const list = idx.get(k);
    if (list) list.push(n);
    else idx.set(k, [n]);
  }
  return idx;
}

async function fetchIndex(console: string, art: Art = BOX): Promise<Index | null> {
  const dir = artDir(console, art);
  const cache = `${dir}/.index.json`;
  try {
    await RNFS.mkdir(dir);
    if (await RNFS.exists(cache)) {
      const st = await RNFS.stat(cache);
      if (Date.now() - new Date(st.mtime).getTime() < INDEX_TTL_MS) {
        return buildIndex(JSON.parse(await RNFS.readFile(cache, 'utf8')));
      }
    }
    const tmp = `${dir}/.index.html`;
    const url = `${BASE}/${encodeURIComponent(SYSTEM_DIR[console])}/${art}/`;
    const res = await RNFS.downloadFile({ fromUrl: url, toFile: tmp }).promise;
    if (res.statusCode !== 200) throw new Error(String(res.statusCode));
    const html = await RNFS.readFile(tmp, 'utf8');
    await RNFS.unlink(tmp).catch(() => {});
    const names: string[] = [];
    const re = /href="([^"?/]+)\.png"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      try {
        names.push(decodeURIComponent(m[1]));
      } catch {
        // nombre mal codificado: se ignora
      }
    }
    if (names.length) await RNFS.writeFile(cache, JSON.stringify(names), 'utf8');
    return buildIndex(names);
  } catch {
    // Sin red: si hay un índice viejo se usa igualmente
    try {
      if (await RNFS.exists(cache)) return buildIndex(JSON.parse(await RNFS.readFile(cache, 'utf8')));
    } catch {
      // índice dañado
    }
    return null;
  }
}

function getIndex(console: string, art: Art = BOX): Promise<Index | null> {
  const k = art === BOX ? console : `${console}:${art}`;
  let p = indexes.get(k);
  if (!p) {
    p = fetchIndex(console, art);
    indexes.set(k, p);
    p.then((idx) => {
      if (!idx) indexes.delete(k); // reintentar en la próxima carátula
    });
  }
  return p;
}

/** Nombres oficiales a probar, del más probable al menos. */
async function candidates(console: string, romName: string, art: Art = BOX): Promise<string[]> {
  const exact = thumbnailName(romName);
  const idx = await getIndex(console, art);
  // Arcade: el nombre corto del romset (kof2002) se traduce a su título (The King of Fighters 2002)
  const full = console === 'mame' || console === 'fbneo' ? arcadeTitle(romName) : null;
  const found = [...(idx?.get(titleKey(romName)) ?? []), ...(full ? idx?.get(titleKey(full)) ?? [] : [])];
  const ordered = [...found].sort((a, b) => rank(a) - rank(b));
  // Sin índice (sin red la primera vez): nombre exacto y las regiones más comunes
  const clean = exact.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const guesses = idx ? [] : [`${clean} (USA)`, `${clean} (World)`, `${clean} (Europe)`];
  return [...new Set([exact, ...ordered, ...guesses])];
}

// ---- Descarga y suscripción -------------------------------------------------------
type Listener = (uri: string | null) => void;

const resolved = new Map<string, string | null>(); // clave -> file:// o null (sin carátula)
const listeners = new Map<string, Set<Listener>>();
type Job = { key: string; console: string; name: string; rom: string; art?: Art };
const queue: Job[] = [];
const queued = new Set<string>();
let running = 0;

const keyOf = (console: string, name: string, art: Art = BOX) =>
  art === BOX ? `${console}/${name}` : `${console}/snaps/${name}`;
const fileOf = (console: string, name: string, art: Art = BOX) => `${artDir(console, art)}/${name}.png`;
// Miniatura elegida por el usuario desde Fotos: tiene prioridad sobre la descargada
const customOf = (console: string, name: string) => `${COVERS_DIR}/${console}/${name}.custom.png`;

function emit(key: string, uri: string | null) {
  resolved.set(key, uri);
  listeners.get(key)?.forEach((l) => l(uri));
}

async function tryDownload(console: string, official: string, file: string, art: Art = BOX): Promise<boolean> {
  const url = `${BASE}/${encodeURIComponent(SYSTEM_DIR[console])}/${art}/${encodeURIComponent(official)}.png`;
  const tmp = `${file}.part`;
  const res = await RNFS.downloadFile({ fromUrl: url, toFile: tmp, background: true }).promise;
  if (res.statusCode === 200 && res.bytesWritten > 0) {
    if (await RNFS.exists(file)) await RNFS.unlink(file);
    await RNFS.moveFile(tmp, file);
    return true;
  }
  if (await RNFS.exists(tmp)) await RNFS.unlink(tmp);
  return false;
}

async function work(job: Job) {
  const art = job.art ?? BOX;
  const file = fileOf(job.console, job.name, art);
  const miss = `${file}.miss3`;
  const custom = customOf(job.console, job.name);
  try {
    if (art === BOX && (await RNFS.exists(custom))) {
      const st = await RNFS.stat(custom);
      emit(job.key, `file://${custom}?v=${new Date(st.mtime).getTime()}`);
      return;
    }
    if (await RNFS.exists(file)) {
      emit(job.key, `file://${file}`);
      return;
    }
    if (await RNFS.exists(miss)) {
      const st = await RNFS.stat(miss);
      if (Date.now() - new Date(st.mtime).getTime() < MISS_TTL_MS) {
        emit(job.key, null);
        return;
      }
    }
    await RNFS.mkdir(artDir(job.console, art));
    for (const official of (await candidates(job.console, job.rom, art)).slice(0, 4)) {
      if (await tryDownload(job.console, official, file, art)) {
        if (await RNFS.exists(miss)) await RNFS.unlink(miss);
        emit(job.key, `file://${file}`);
        return;
      }
    }
    await RNFS.writeFile(miss, String(Date.now()), 'utf8');
    emit(job.key, null);
  } catch {
    // Sin red u otro fallo: tarjeta con monograma; se reintentará en la próxima sesión
    emit(job.key, null);
  }
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!;
    running += 1;
    work(job).finally(() => {
      running -= 1;
      queued.delete(job.key);
      pump();
    });
  }
}

/**
 * Se suscribe a la carátula de una ROM. Llama a `cb` en cuanto se conoce (enseguida si ya
 * está en caché). Devuelve la función para cancelar la suscripción.
 */
export function subscribeCover(romPath: string, console: string, cb: Listener): () => void {
  return subscribeArt(romPath, console, cb, BOX);
}

/**
 * Captura panorámica del juego (Named_Snaps de libretro-thumbnails) para los Hero Banners de la
 * interfaz SteamOS. Misma caché local y misma búsqueda por título que las carátulas.
 */
export function subscribeHero(romPath: string, console: string, cb: Listener): () => void {
  return subscribeArt(romPath, console, cb, 'Named_Snaps');
}

function subscribeArt(romPath: string, console: string, cb: Listener, art: Art): () => void {
  if (console === 'ports') {
    const port = portThumbConsole(romPath);
    if (!port) {
      cb(null);
      return () => {};
    }
    romPath = port.name;
    console = port.console;
  }
  if (!SYSTEM_DIR[console]) {
    cb(null);
    return () => {};
  }
  const rom = romPath.split('/').pop() ?? romPath;
  const name = thumbnailName(romPath);
  const key = keyOf(console, name, art);
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  if (resolved.has(key)) {
    cb(resolved.get(key) ?? null);
  } else if (!queued.has(key)) {
    queued.add(key);
    queue.push({ key, console, name, rom, art });
    pump();
  }
  return () => {
    set?.delete(cb);
  };
}

/** Olvida la carátula en memoria (p. ej. al borrar el juego). */
export function forgetCover(romPath: string, console: string): void {
  resolved.delete(keyOf(console, thumbnailName(romPath)));
}

/** Ruta donde se guarda la miniatura personalizada de una ROM (Documents/covers/<consola>/). */
export function customCoverPath(romPath: string, console: string): string {
  if (console === 'ports') {
    const port = portThumbConsole(romPath);
    if (port) return customOf(port.console, thumbnailName(port.name));
  }
  return customOf(console, thumbnailName(romPath));
}

function requeue(romPath: string, console: string) {
  if (console === 'ports') {
    const port = portThumbConsole(romPath);
    if (port) {
      romPath = port.name;
      console = port.console;
    }
  }
  const rom = romPath.split('/').pop() ?? romPath;
  const name = thumbnailName(romPath);
  const key = keyOf(console, name);
  resolved.delete(key);
  if (!queued.has(key) && listeners.get(key)?.size) {
    queued.add(key);
    queue.push({ key, console, name, rom });
    pump();
  }
}

/** Tras guardar una miniatura desde Fotos: se muestra al momento en todas las tarjetas. */
export function customCoverChanged(romPath: string, console: string): void {
  requeue(romPath, console);
}

/**
 * Recargar carátula: borra la personalizada, la descargada y la marca "sin carátula", y la
 * vuelve a buscar en thumbnails.libretro.com (el índice del sistema también se renueva).
 */
export async function reloadCover(romPath: string, console: string): Promise<void> {
  if (console === 'ports') {
    const port = portThumbConsole(romPath);
    if (port) {
      await reloadCover(port.name, port.console);
      return;
    }
  }
  const name = thumbnailName(romPath);
  for (const f of [customOf(console, name), fileOf(console, name), `${fileOf(console, name)}.miss3`]) {
    try {
      if (await RNFS.exists(f)) await RNFS.unlink(f);
    } catch {
      // sigue con el resto
    }
  }
  if (SYSTEM_DIR[console]) {
    const index = `${COVERS_DIR}/${console}/.index.json`;
    try {
      if (await RNFS.exists(index)) await RNFS.unlink(index);
    } catch {
      // índice en uso: se renovará en 30 días
    }
    indexes.delete(console);
  }
  requeue(romPath, console);
}
