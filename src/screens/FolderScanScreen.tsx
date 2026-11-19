import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  analyzeFolder,
  CONSOLE_NAMES,
  folderInfo,
  FolderInfo,
  importedCount,
  importFolder,
  importSummary,
  linkFolder,
  loadSyncPrefs,
  saveSyncPrefs,
  ScanItem,
  ScanResult,
  scanStatus,
  SyncPrefs,
  unlinkFolder,
} from '../library/folderSync';
import { theme } from '../theme';

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Escáner y auto-clasificador de la carpeta vinculada (Descargas, iCloud Drive, En mi iPhone…)
export default function FolderScanScreen({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [info, setInfo] = useState<FolderInfo>(() => folderInfo());
  const [prefs, setPrefs] = useState<SyncPrefs>({ autoSync: true, move: false });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState<'scan' | 'import' | null>(null);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    loadSyncPrefs().then(setPrefs);
  }, []);
  const updatePrefs = (p: SyncPrefs) => {
    setPrefs(p);
    saveSyncPrefs(p);
  };

  // Progreso en vivo del nativo (archivo actual y contador)
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      const st = scanStatus();
      if (st.busy && st.total) setProgress(`${st.phase === 'import' ? 'Copiando' : 'Analizando'} ${st.done}/${st.total} · ${st.current ?? ''}`);
      else if (st.busy) setProgress('Leyendo la carpeta…');
    }, 300);
    return () => clearInterval(id);
  }, [busy]);

  const runScan = useCallback(() => {
    setBusy('scan');
    setProgress('Leyendo la carpeta…');
    analyzeFolder()
      .then((r) => {
        if (!r.ok) Alert.alert('No se pudo escanear', r.error ?? 'Error desconocido');
        setScan(r.ok ? r : null);
      })
      .catch((e) => Alert.alert('No se pudo escanear', String(e?.message ?? e)))
      .finally(() => {
        setBusy(null);
        setInfo(folderInfo());
      });
  }, []);

  // Al abrir con carpeta ya vinculada: análisis directo
  useEffect(() => {
    if (folderInfo().linked) runScan();
  }, [runScan]);

  const link = () => {
    linkFolder()
      .then((name) => {
        if (!name) return;
        setInfo(folderInfo());
        runScan();
      })
      .catch((e) => Alert.alert('No se pudo vincular la carpeta', String(e?.message ?? e)));
  };

  const unlink = () => {
    Alert.alert('Desvincular carpeta', `JL Emulator dejará de escanear "${info.name}". Los juegos ya importados se quedan.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desvincular',
        style: 'destructive',
        onPress: () => {
          unlinkFolder();
          setInfo(folderInfo());
          setScan(null);
        },
      },
    ]);
  };

  const runImport = () => {
    setBusy('import');
    importFolder(prefs.move)
      .then((r) => {
        if (!r.ok) {
          Alert.alert('No se pudo importar', r.error ?? 'Error desconocido');
          return;
        }
        if (importedCount(r) > 0) onImported();
        Alert.alert(
          'Importación terminada',
          importSummary(r) + (r.errors.length ? `\n\n${r.errors.slice(0, 6).join('\n')}` : ''),
        );
      })
      .catch((e) => Alert.alert('No se pudo importar', String(e?.message ?? e)))
      .finally(() => {
        setBusy(null);
        runScan();
      });
  };

  const fresh = useMemo(() => (scan?.items ?? []).filter((i) => !i.already && i.kind !== 'unknown'), [scan]);
  const sorted = useMemo(() => {
    const order = (i: ScanItem) => (i.already ? 3 : i.kind === 'unknown' ? 2 : i.kind === 'bios' ? 1 : 0);
    return [...(scan?.items ?? [])].sort((a, b) => order(a) - order(b) || a.console.localeCompare(b.console) || a.name.localeCompare(b.name));
  }, [scan]);
  const s = scan?.summary;
  const consoleTiles = Object.entries(s?.games ?? {}).sort((a, b) => b[1] - a[1]);

  const header = (
    <View style={styles.body}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{info.linked ? `📁 ${info.name}` : 'Ninguna carpeta vinculada'}</Text>
        <Text style={styles.note}>
          {info.linked
            ? info.available
              ? 'JL Emulator tiene permiso permanente para leer esta carpeta. Cada archivo se identifica por su cabecera y su código de juego (SLUS, ULUS, NUS…), también dentro de .zip y .7z sin descomprimirlos.'
              : 'La carpeta no está disponible ahora (¿se movió, se borró o iCloud está sin conexión?). Vuelve a vincularla.'
            : 'Elige una carpeta del iPhone una sola vez (por ejemplo Descargas en iCloud Drive o En mi iPhone). La app recordará el permiso y la escaneará sola al abrirse o al pulsar Sincronizar.'}
        </Text>
        <View style={styles.rowGap}>
          <Pressable onPress={link} disabled={!!busy} style={({ pressed }) => [styles.primary, styles.flex, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>{info.linked ? 'Cambiar carpeta' : 'Vincular y escanear carpeta (ej. Descargas)'}</Text>
          </Pressable>
          {info.linked ? (
            <Pressable onPress={unlink} disabled={!!busy} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Text style={styles.actionText}>Desvincular</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Sincronizar al abrir la app</Text>
          <Switch value={prefs.autoSync} onValueChange={(v) => updatePrefs({ ...prefs, autoSync: v })} trackColor={{ true: theme.amber }} />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Mover en lugar de copiar (libera espacio en la carpeta)</Text>
          <Switch value={prefs.move} onValueChange={(v) => updatePrefs({ ...prefs, move: v })} trackColor={{ true: theme.amber }} />
        </View>
        <Text style={styles.note}>
          Copiar conserva los originales. Lo ya importado no se vuelve a copiar. Los .zip/.7z de consola se descomprimen solos
          en su carpeta; los romsets arcade se quedan en .zip; las BIOS van a system/.
        </Text>
      </View>

      {busy ? (
        <View style={styles.progress}>
          <ActivityIndicator color={theme.amber} />
          <Text style={styles.progressText} numberOfLines={2}>
            {progress}
          </Text>
        </View>
      ) : null}

      {s ? (
        <>
          <Text style={styles.section}>RESUMEN DE "{scan?.folder}"</Text>
          <View style={styles.tiles}>
            {consoleTiles.map(([c, n]) => (
              <View key={c} style={styles.tile}>
                <Text style={styles.tileNum}>{n}</Text>
                <Text style={styles.tileLabel}>{CONSOLE_NAMES[c] ?? c}</Text>
              </View>
            ))}
            {s.bios ? (
              <View style={[styles.tile, styles.tileBios]}>
                <Text style={styles.tileNum}>{s.bios}</Text>
                <Text style={styles.tileLabel}>BIOS → system/</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.note}>
            {fresh.length} nuevo{fresh.length === 1 ? '' : 's'} · {s.already} ya importado{s.already === 1 ? '' : 's'}
            {s.unknown ? ` · ${s.unknown} no reconocido${s.unknown === 1 ? '' : 's'}` : ''}
            {s.icloud ? ` · ${s.icloud} descargándose de iCloud (vuelve a sincronizar en un rato)` : ''}
          </Text>
          <View style={styles.rowGap}>
            <Pressable
              onPress={runImport}
              disabled={!!busy || !fresh.length}
              style={({ pressed }) => [styles.primary, styles.flex, (!fresh.length || pressed) && styles.pressed]}>
              <Text style={styles.primaryText}>
                {fresh.length ? `${prefs.move ? 'Mover' : 'Importar'} ${fresh.length} elemento${fresh.length === 1 ? '' : 's'}` : 'Nada nuevo que importar'}
              </Text>
            </Pressable>
            <Pressable onPress={runScan} disabled={!!busy} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Text style={styles.actionText}>Volver a escanear</Text>
            </Pressable>
          </View>
          <Text style={styles.section}>ARCHIVOS</Text>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.kicker}>BIBLIOTECA</Text>
          <Text style={styles.title}>Escanear carpeta</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
          <Text style={styles.closeText}>Cerrar</Text>
        </Pressable>
      </View>
      <FlatList
        data={sorted}
        keyExtractor={(i) => i.rel}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.row, (item.already || item.kind === 'unknown') && styles.rowDim]}>
            <View style={styles.rowHead}>
              <Text style={styles.name} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.size}>{formatSize(item.size)}</Text>
            </View>
            <Text style={[styles.dest, item.kind === 'unknown' && styles.destDim]}>
              {item.already ? '✓ Ya importado' : item.kind === 'unknown' ? '✕ No reconocido' : `→ ${item.label}`}
              {item.serial ? `  ·  ${item.serial}` : ''}
            </Text>
            {item.title || item.detail ? (
              <Text style={styles.detail} numberOfLines={2}>
                {[item.title, item.detail].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
        )}
      />
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
  flex: { flex: 1 },
  kicker: { color: theme.amber, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  close: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: theme.amber },
  closeText: { color: theme.amber, fontWeight: '800' },
  body: { gap: 10, paddingBottom: 6 },
  list: { padding: 16, gap: 8, paddingBottom: 40 },
  card: { padding: 14, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, gap: 10 },
  cardTitle: { color: theme.text, fontWeight: '800', fontSize: 16 },
  note: { color: theme.textDim, fontSize: 12, lineHeight: 18 },
  rowGap: { flexDirection: 'row', gap: 10 },
  primary: { paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.amber, alignItems: 'center' },
  primaryText: { color: theme.bg, fontWeight: '900', fontSize: 14, textAlign: 'center' },
  action: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { color: theme.text, fontWeight: '800', fontSize: 13 },
  pressed: { opacity: 0.6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  switchLabel: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: theme.amberDim },
  progressText: { flex: 1, color: theme.titaniumHi, fontSize: 12 },
  section: { color: theme.amber, fontSize: 12, fontWeight: '800', letterSpacing: 2, marginTop: 8 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    minWidth: 92,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.surfaceHi,
    borderWidth: 1,
    borderColor: theme.border,
  },
  tileBios: { borderColor: theme.amber },
  tileNum: { color: theme.amber, fontSize: 22, fontWeight: '900' },
  tileLabel: { color: theme.titaniumHi, fontSize: 12, fontWeight: '700' },
  row: { padding: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, gap: 4 },
  rowDim: { opacity: 0.55 },
  rowHead: { flexDirection: 'row', gap: 8 },
  name: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  size: { color: theme.textDim, fontSize: 12 },
  dest: { color: theme.amber, fontSize: 13, fontWeight: '700' },
  destDim: { color: theme.danger },
  detail: { color: theme.textDim, fontSize: 12 },
});
