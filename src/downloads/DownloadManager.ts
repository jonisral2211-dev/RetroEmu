import RNFS from 'react-native-fs';
import { Libretro } from 'react-native-libretro';
import { hasRomExtension } from './romLinks';

// Gestor de descargas del navegador. Estado en memoria del módulo: sobrevive al cambio de pestaña.
// Cada archivo se descarga a una carpeta temporal propia y luego lo importa el nativo, que lo
// clasifica en su carpeta de Documents (zip de consola -> extrae; zip arcade -> arcade/;
// ROM suelta / .cue / .chd -> gba/, n64/, sega/ o ps1/).

export type DownloadState = 'downloading' | 'importing' | 'done' | 'error';

export type DownloadItem = {
  id: string;
  name: string;
  url: string;
  progress: number; // 0..1 (-1 = tamaño desconocido)
  bytes: number;
  total: number;
  state: DownloadState;
  message?: string;
};

let items: DownloadItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const importedListeners = new Set<(path: string) => void>();

function emit() {
  listeners.forEach((l) => l());
}

function update(id: string, patch: Partial<DownloadItem>) {
  items = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  emit();
}

export function getDownloads(): DownloadItem[] {
  return items;
}

/** Quita de la lista las descargas terminadas o fallidas. */
export function clearFinishedDownloads(): void {
  items = items.filter((i) => i.state === 'downloading' || i.state === 'importing');
  emit();
}

export function subscribeDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Se llama cuando una ROM queda importada en su carpeta de consola (la biblioteca debe refrescarse). */
export function onRomImported(listener: (path: string) => void): () => void {
  importedListeners.add(listener);
  return () => {
    importedListeners.delete(listener);
  };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._ ()[\]'&,!+-]/g, '_').replace(/^\.+/, '') || 'descarga';
}

/** Nombre de archivo seguro a partir de la URL. */
export function nameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0];
  return sanitize(decodeSafe(path.split('/').pop() || 'descarga'));
}

/** Nombre que propone el servidor en Content-Disposition (filename* o filename). */
function nameFromHeaders(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-disposition');
  const value = key ? headers[key] : '';
  if (!value) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(value);
  if (star) return sanitize(decodeSafe(star[1].trim().replace(/^"|"$/g, '')));
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(value);
  return plain ? sanitize(plain[1].trim()) : null;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function startDownload(url: string, suggestedName?: string): void {
  const id = String(++seq);
  let name = suggestedName ? sanitize(suggestedName) : nameFromUrl(url);
  const dir = `${RNFS.TemporaryDirectoryPath}/jl-dl-${Date.now()}-${id}`;
  const tmp = `${dir}/download.part`;
  items = [{ id, name, url, progress: 0, bytes: 0, total: 0, state: 'downloading' }, ...items];
  emit();

  RNFS.mkdir(dir)
    .then(
      () =>
        RNFS.downloadFile({
          fromUrl: url,
          toFile: tmp,
          background: true,
          progressInterval: 250,
          begin: (r) => {
            // El nombre real suele venir en la cabecera (enlaces sin extensión en la URL)
            const fromHeader = nameFromHeaders(r.headers as Record<string, string>);
            if (fromHeader && (hasRomExtension(fromHeader) || !hasRomExtension(name))) name = fromHeader;
            update(id, { name, total: r.contentLength > 0 ? r.contentLength : 0 });
          },
          progress: (r) => {
            const total = r.contentLength > 0 ? r.contentLength : 0;
            update(id, {
              bytes: r.bytesWritten,
              total,
              progress: total ? r.bytesWritten / total : -1,
            });
          },
        }).promise,
    )
    .then(async (res) => {
      if (res.statusCode < 200 || res.statusCode > 299) {
        throw new Error(`El servidor respondió ${res.statusCode}`);
      }
      // Nombre final: el importador conserva el nombre de archivo en su carpeta de consola
      const named = `${dir}/${name}`;
      await RNFS.moveFile(tmp, named);
      update(id, { state: 'importing', progress: 1 });
      const dest = Libretro.importRom(named);
      if (!dest) {
        throw new Error(Libretro.lastError() || 'No se pudo importar el archivo');
      }
      update(id, { state: 'done', message: dest.split('/Documents/')[1] ?? dest });
      importedListeners.forEach((l) => l(dest));
    })
    .catch((e) => {
      update(id, { state: 'error', message: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      RNFS.unlink(dir).catch(() => {});
    });
}
