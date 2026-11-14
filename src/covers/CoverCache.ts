import RNFS from 'react-native-fs';

// Carátulas de https://thumbnails.libretro.com/<Sistema>/Named_Boxarts/<Nombre>.png
// Caché en Documents/covers/<consola>/. Un archivo .miss marca "no hay carátula" para no
// reintentar en cada arranque (se reintenta pasados MISS_TTL_MS).

const COVERS_DIR = `${RNFS.DocumentDirectoryPath}/covers`;
const MISS_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_PARALLEL = 2;

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
};

/** Nombre de archivo según la convención de libretro-thumbnails: &*\/:`<>?\|" -> _ */
export function thumbnailName(romPath: string): string {
  const file = romPath.split('/').pop() ?? romPath;
  const base = file.replace(/\.[^.]+$/, '');
  return base.replace(/[&*/:`<>?\\|"]/g, '_');
}

type Listener = (uri: string | null) => void;

const resolved = new Map<string, string | null>(); // clave -> file:// o null (sin carátula)
const listeners = new Map<string, Set<Listener>>();
const queue: { key: string; console: string; name: string }[] = [];
const queued = new Set<string>();
let running = 0;

const keyOf = (console: string, name: string) => `${console}/${name}`;
const fileOf = (console: string, name: string) => `${COVERS_DIR}/${console}/${name}.png`;

function emit(key: string, uri: string | null) {
  resolved.set(key, uri);
  listeners.get(key)?.forEach((l) => l(uri));
}

async function work(job: { key: string; console: string; name: string }) {
  const file = fileOf(job.console, job.name);
  const miss = `${file}.miss`;
  try {
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
    await RNFS.mkdir(`${COVERS_DIR}/${job.console}`);
    const system = SYSTEM_DIR[job.console];
    const url =
      `https://thumbnails.libretro.com/${encodeURIComponent(system)}/Named_Boxarts/` +
      `${encodeURIComponent(job.name)}.png`;
    const tmp = `${file}.part`;
    const res = await RNFS.downloadFile({ fromUrl: url, toFile: tmp, background: true }).promise;
    if (res.statusCode === 200 && res.bytesWritten > 0) {
      if (await RNFS.exists(file)) await RNFS.unlink(file);
      await RNFS.moveFile(tmp, file);
      if (await RNFS.exists(miss)) await RNFS.unlink(miss);
      emit(job.key, `file://${file}`);
    } else {
      if (await RNFS.exists(tmp)) await RNFS.unlink(tmp);
      if (res.statusCode === 404) await RNFS.writeFile(miss, String(Date.now()), 'utf8');
      emit(job.key, null);
    }
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
  if (!SYSTEM_DIR[console]) {
    cb(null);
    return () => {};
  }
  const name = thumbnailName(romPath);
  const key = keyOf(console, name);
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  if (resolved.has(key)) {
    cb(resolved.get(key) ?? null);
  } else if (!queued.has(key)) {
    queued.add(key);
    queue.push({ key, console, name });
    pump();
  }
  return () => {
    set?.delete(cb);
  };
}
