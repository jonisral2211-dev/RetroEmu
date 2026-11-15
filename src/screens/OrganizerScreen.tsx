import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import { theme } from '../theme';

type Move = { path: string; name: string; from: string; to: string; label: string; unsupported: boolean };

// Organizador: busca juegos fuera de su carpeta (raíz de Documents, Descargas, carpeta de otra
// consola) inspeccionando extensión, contenido del .zip y cabecera, y los mueve todos de una vez.
export default function OrganizerScreen({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Deja pintar el indicador antes del escaneo (síncrono en nativo)
    const id = setTimeout(() => {
      try {
        setMoves(JSON.parse(Libretro.scanFiles()) as Move[]);
      } catch {
        setMoves([]);
      }
    }, 50);
    return () => clearTimeout(id);
  }, []);

  const apply = () => {
    if (!moves?.length) return;
    setBusy(true);
    setTimeout(() => {
      let result = { moved: 0, failed: 0 };
      try {
        result = JSON.parse(Libretro.organizeFiles(JSON.stringify(moves.map((m) => ({ path: m.path, to: m.to })))));
      } catch {
        // sin resultado
      }
      setBusy(false);
      onDone();
      Alert.alert(
        'Archivos organizados',
        `${result.moved} movido${result.moved === 1 ? '' : 's'} a su carpeta.` +
          (result.failed ? ` ${result.failed} no se pudieron mover (ya existía uno igual en el destino).` : ''),
        [{ text: 'Listo', onPress: onClose }],
      );
    }, 30);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>BIBLIOTECA</Text>
          <Text style={styles.title}>Organizar archivos</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
          <Text style={styles.closeText}>Cerrar</Text>
        </Pressable>
      </View>
      {moves === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.amber} />
          <Text style={styles.note}>Revisando Documents, Descargas y las carpetas de cada consola…</Text>
        </View>
      ) : moves.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.ok}>✓ Todo está en su carpeta</Text>
          <Text style={styles.note}>No hay juegos sueltos ni en la carpeta de otra consola.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.summary}>
            {moves.length} archivo{moves.length === 1 ? '' : 's'} fuera de su sitio. Se detectan por extensión, por lo
            que hay dentro del .zip y por la cabecera del archivo (Mega Drive, PS1, PSP, Saturn…).
          </Text>
          <FlatList
            data={moves}
            keyExtractor={(m) => m.path}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={[styles.dest, item.unsupported && styles.destDim]}>
                  {item.from} → {item.to === '.inbox' ? item.label : `Mover a ${item.label}`}
                </Text>
              </View>
            )}
          />
          <Pressable onPress={apply} disabled={busy} style={({ pressed }) => [styles.go, (pressed || busy) && styles.pressed]}>
            {busy ? <ActivityIndicator color={theme.bg} /> : <Text style={styles.goText}>Mover y organizar todos</Text>}
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  headerText: { flex: 1 },
  kicker: { color: theme.amber, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  close: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: theme.amber },
  closeText: { color: theme.amber, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  ok: { color: '#4ADE80', fontSize: 18, fontWeight: '800' },
  note: { color: theme.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  summary: { color: theme.titaniumHi, fontSize: 13, lineHeight: 19, padding: 16, paddingBottom: 6 },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  row: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 4,
  },
  name: { color: theme.text, fontSize: 14, fontWeight: '600' },
  dest: { color: theme.amber, fontSize: 13, fontWeight: '700' },
  destDim: { color: theme.textDim },
  go: {
    margin: 16,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: theme.amber,
  },
  pressed: { opacity: 0.7 },
  goText: { color: theme.bg, fontSize: 16, fontWeight: '900' },
});
