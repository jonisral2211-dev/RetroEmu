import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import {
  Console,
  CONSOLE_LABEL,
  coreForConsole,
  ENABLED_CORES,
  SYSTEM_NAME,
} from '../emulator/cores';

type Props = { onPlay: (romPath: string) => void };
type Filter = 'all' | Console;
type Entry = { path: string; console: string };

const FILTERS: Filter[] = ['all', 'gba', 'n64', 'sega', 'mame'];

// Ruta relativa a Documents (lo que ve el usuario en la app Archivos)
function relativeToDocuments(path: string): string {
  const i = path.indexOf('/Documents/');
  return i >= 0 ? path.slice(i + '/Documents/'.length) : path.split('/').pop() ?? path;
}

// Alerta descriptiva en vez de intentar cargar la ROM en blanco
function explainUnavailable(entry: Entry) {
  const name = entry.path.split('/').pop() ?? entry.path;
  const core = coreForConsole(entry.console);
  let message: string;
  if (core === null) {
    message = `"${name}" no tiene una cabecera válida para ninguna consola soportada (GBA, N64 o Mega Drive). Revisa que el archivo esté completo.`;
  } else if (!ENABLED_CORES.has(core)) {
    message = `El núcleo de ${SYSTEM_NAME[core]} no está incluido en esta compilación de RetroEmu.`;
  } else {
    message = `No se puede abrir "${name}".`;
  }
  Alert.alert('No se puede abrir este juego', message);
}

export default function LibraryScreen({ onPlay }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);

  // Nativo verifica cada ROM por contenido; aquí solo se agrupan por consola
  const refresh = useCallback(() => {
    try {
      const list = Libretro.listRoms();
      setEntries(list.map((path) => ({ path, console: Libretro.consoleOf(path) })));
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
    entries.forEach((e) => {
      if (e.console in c) c[e.console as Console] += 1;
    });
    return c;
  }, [entries]);

  const visible = useMemo(
    () =>
      entries
        .filter((e) => filter === 'all' || e.console === filter)
        .sort((a, b) => relativeToDocuments(a.path).localeCompare(relativeToDocuments(b.path))),
    [entries, filter],
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
          const label =
            f === 'all' ? `Todos (${entries.length})` : `${CONSOLE_LABEL[f]} (${counts[f]})`;
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
        keyExtractor={(e) => e.path}
        ListEmptyComponent={
          <Text style={styles.hint}>
            No hay juegos verificados en esta categoría. Copia tus ROMs en la app Archivos →
            En mi iPhone → RetroEmu (en la raíz o en gba, n64, sega, mame) o en un .zip, y pulsa
            Actualizar.
          </Text>
        }
        renderItem={({ item }) => {
          const core = coreForConsole(item.console);
          const enabled = core !== null && ENABLED_CORES.has(core);
          const name = item.path.split('/').pop() ?? item.path;
          const subtitle = core
            ? enabled
              ? `${SYSTEM_NAME[core]} · ${relativeToDocuments(item.path)}`
              : `${SYSTEM_NAME[core]} · núcleo no incluido en esta build`
            : 'Sin consola verificada';
          return (
            <Pressable
              onPress={() => (enabled ? onPlay(item.path) : explainUnavailable(item))}
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
