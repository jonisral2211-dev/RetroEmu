import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import {
  Console,
  coreForFile,
  CONSOLE_LABEL,
  consoleForPath,
  ENABLED_CORES,
  SYSTEM_NAME,
} from '../emulator/cores';

type Props = { onPlay: (romPath: string) => void };
type Filter = 'all' | Console;

const FILTERS: Filter[] = ['all', 'gba', 'n64', 'sega', 'mame'];

// Ruta relativa a Documents (lo que ve el usuario en la app Archivos)
function relativeToDocuments(path: string): string {
  const i = path.indexOf('/Documents/');
  return i >= 0 ? path.slice(i + '/Documents/'.length) : path.split('/').pop() ?? path;
}

export default function LibraryScreen({ onPlay }: Props) {
  const [roms, setRoms] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    try {
      setRoms(Libretro.listRoms());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const c: Record<Console, number> = { gba: 0, n64: 0, sega: 0, mame: 0 };
    roms.forEach((p) => (c[consoleForPath(p)] += 1));
    return c;
  }, [roms]);

  const visible = useMemo(
    () =>
      roms
        .filter((p) => filter === 'all' || consoleForPath(p) === filter)
        .sort((a, b) => relativeToDocuments(a).localeCompare(relativeToDocuments(b))),
    [roms, filter],
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>RetroEmu</Text>
        <Pressable onPress={refresh} style={styles.button}>
          <Text style={styles.buttonText}>Actualizar</Text>
        </Pressable>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const label = f === 'all' ? `Todos (${roms.length})` : `${CONSOLE_LABEL[f]} (${counts[f]})`;
          const active = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={visible}
        keyExtractor={(path) => path}
        ListEmptyComponent={
          <Text style={styles.hint}>
            No hay juegos en esta categoría. Copia tus ROMs en la carpeta de su consola (gba, n64,
            sega, mame) desde Archivos → En mi iPhone → RetroEmu, o déjalas en la raíz. Los .zip
            se descomprimen solos. Luego pulsa Actualizar.
          </Text>
        }
        renderItem={({ item }) => {
          const core = coreForFile(item);
          const enabled = core !== null && ENABLED_CORES.has(core);
          const name = item.split('/').pop() ?? item;
          const subtitle =
            core === null
              ? `${CONSOLE_LABEL[consoleForPath(item)]} · sin núcleo para este formato`
              : enabled
                ? `${SYSTEM_NAME[core]} · ${relativeToDocuments(item)}`
                : `${SYSTEM_NAME[core]} · núcleo no incluido en esta build`;
          return (
            <Pressable
              onPress={() => onPlay(item)}
              disabled={!enabled}
              style={[styles.row, !enabled && styles.rowDisabled]}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {subtitle}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  button: { backgroundColor: '#222', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { backgroundColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  chipActive: { backgroundColor: '#fff' },
  chipText: { color: '#ccc', fontSize: 13 },
  chipTextActive: { color: '#000', fontWeight: '700' },
  error: { color: '#f66', paddingHorizontal: 16 },
  hint: { color: '#999', padding: 24, textAlign: 'center' },
  row: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#222' },
  rowDisabled: { opacity: 0.4 },
  rowTitle: { color: '#fff', fontSize: 16 },
  rowSub: { color: '#888', marginTop: 4 },
});
