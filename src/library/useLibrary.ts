import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Libretro } from 'react-native-libretro';
import { onRomImported } from '../downloads/DownloadManager';

export type Entry = { path: string; console: string };
type UnpackResult = { name: string; ok: boolean; files: number; error: string };

/**
 * Biblioteca: el nativo organiza la raíz de Documents, verifica cada ROM por contenido y
 * deduplica; los .zip/.7z en carpetas de consola o descargas grandes se descomprimen en segundo
 * plano y la lista se actualiza al terminar. Un comprimido que falla no se reintenta solo (sí al
 * pulsar Actualizar). La comparten la vista clásica y la interfaz SteamOS.
 */
export function useLibrary() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unpacking, setUnpacking] = useState<string[] | null>(null);
  const unpackBusy = useRef(false);
  const unpackFailed = useRef(new Set<string>());

  const listNow = useCallback(() => {
    try {
      const list = Libretro.listRoms();
      setEntries(list.map((path) => ({ path, console: Libretro.consoleOf(path) })));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

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
            Alert.alert('No se pudo descomprimir', failed.map((f) => `• ${f.name}: ${f.error}`).join('\n'));
          }
        })
        .catch((e) => Alert.alert('Error al descomprimir', String(e)))
        .finally(() => {
          unpackBusy.current = false;
          setUnpacking(null);
          // Lo descomprimido (p. ej. de .inbox) puede necesitar repartirse: segunda pasada
          listNow();
        });
    },
    [listNow],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Una descarga, subida por Wi-Fi o sincronización terminada se añade sin reiniciar la app
  useEffect(() => onRomImported(() => refresh()), [refresh]);

  return { entries, error, unpacking, refresh, listNow };
}
