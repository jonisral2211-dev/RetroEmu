import RNFS from 'react-native-fs';
import { Libretro } from 'react-native-libretro';

// Gestor de descargas de ROMs. Estado en memoria del módulo: sobrevive al cambio de pestaña.
// Cada archivo se descarga a una carpeta temporal y luego lo importa el nativo
// (zip -> extracción a su consola, ROM suelta -> movida a su carpeta de consola).

export type DownloadState = 'downloading' | 'importing' | 'done' | 'error';

export type DownloadItem = {
  id: string;
  name: string;
  url: string;
  progress: number; // 0..1
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

/** Nombre de archivo seguro a partir de la URL. */
export function nameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0];
  const last = decodeSafe(path.split('/').pop() || 'descarga');
  return last.replace(/[^A-Za-z0-9._ ()[\]-]/g, '_');
}

export function startDownload(url: string): void {
  const id = String(++seq);
  const name = nameFromUrl(url);
  const tmp = `${RNFS.TemporaryDirectoryPath}/rnl-${id}-${name}`;
  items = [{ id, name, url, progress: 0, state: 'downloading' }, ...items];
  emit();

  RNFS.downloadFile({
    fromUrl: url,
    toFile: tmp,
    progressDivider: 2, // notifica cada 2 %
    progress: (r) => {
      if (r.contentLength > 0) update(id, { progress: r.bytesWritten / r.contentLength });
    },
  })
    .promise.then((res) => {
      if (res.statusCode < 200 || res.statusCode > 299) {
        throw new Error(`El servidor respondió ${res.statusCode}`);
      }
      update(id, { state: 'importing', progress: 1 });
      const dest = Libretro.importRom(tmp);
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
      RNFS.unlink(tmp).catch(() => {});
    });
}
