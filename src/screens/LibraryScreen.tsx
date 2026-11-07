import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import { coreForFile, ENABLED_CORES, SYSTEM_NAME } from '../emulator/cores';

type Props = { onPlay: (romPath: string) => void };

export default function LibraryScreen({ onPlay }: Props) {
  const [roms, setRoms] = useState<string[]>([]);
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

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>RetroEmu</Text>
        <Pressable onPress={refresh} style={styles.button}>
          <Text style={styles.buttonText}>Actualizar</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={roms}
        keyExtractor={(path) => path}
        ListEmptyComponent={
          <Text style={styles.hint}>
            No hay ROMs. Copia tus archivos en la app Archivos → En mi iPhone → RetroEmu
            y pulsa Actualizar.
          </Text>
        }
        renderItem={({ item }) => {
          const core = coreForFile(item);
          const enabled = core !== null && ENABLED_CORES.has(core);
          const name = item.split('/').pop() ?? item;
          return (
            <Pressable
              onPress={() => onPlay(item)}
              disabled={!enabled}
              style={[styles.row, !enabled && styles.rowDisabled]}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.rowSub}>
                {core === null
                  ? 'Formato no soportado'
                  : enabled
                    ? SYSTEM_NAME[core]
                    : `${SYSTEM_NAME[core]} · núcleo no incluido en esta build`}
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
  error: { color: '#f66', paddingHorizontal: 16 },
  hint: { color: '#999', padding: 24, textAlign: 'center' },
  row: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#222' },
  rowDisabled: { opacity: 0.4 },
  rowTitle: { color: '#fff', fontSize: 16 },
  rowSub: { color: '#888', marginTop: 4 },
});
