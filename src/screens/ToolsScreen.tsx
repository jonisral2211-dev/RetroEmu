import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import { theme } from '../theme';

// ---- Subir por Wi-Fi ---------------------------------------------------------------------------
type WifiStatus = {
  running: boolean;
  files: number;
  bytes: number;
  current: string;
  progress: number;
  last: string;
  error: string;
};

const fmtBytes = (b: number) =>
  b > 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

export function WifiUploadScreen({ onClose, onReceived }: { onClose: () => void; onReceived: () => void }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<WifiStatus | null>(null);
  const seen = useRef(0);
  const received = useRef(onReceived);
  received.current = onReceived;
  useEffect(() => {
    setUrl(Libretro.wifiStart());
    const id = setInterval(() => {
      try {
        const st = JSON.parse(Libretro.wifiStatus()) as WifiStatus;
        setStatus(st);
        // Cada archivo nuevo: la biblioteca se actualiza (organizador + carátulas)
        if (st.files !== seen.current) {
          seen.current = st.files;
          received.current();
        }
      } catch {
        // estado ilegible
      }
    }, 700);
    return () => {
      clearInterval(id);
      Libretro.wifiStop();
    };
  }, []);
  const qr = useMemo(() => (url ? Libretro.qrCode(url) : ''), [url]);
  const noWifi = !url || /0\.0\.0\.0|127\.0\.0\.1/.test(url);

  return (
    <View style={styles.root}>
      <Header title="Subir por Wi-Fi" kicker="BIBLIOTECA" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body}>
        {noWifi ? (
          <Text style={styles.warn}>Conecta el iPhone a una red Wi-Fi para recibir juegos desde el ordenador.</Text>
        ) : (
          <>
            <Text style={styles.lead}>En el PC, Mac o móvil (misma Wi-Fi), abre en el navegador:</Text>
            <Pressable onPress={() => Libretro.copyToClipboard(url)} style={styles.urlBox}>
              <Text style={styles.url} selectable>
                {url}
              </Text>
              <Text style={styles.copy}>Tocar para copiar</Text>
            </Pressable>
            {qr ? <Image source={{ uri: `file://${qr}` }} style={styles.qr} resizeMode="contain" /> : null}
            <Text style={styles.note}>
              Arrastra los juegos a la página (.zip, .7z, .iso, .chd, .cue/.bin, .gdi, .wad, BIOS…). Cada archivo se
              guarda en el iPhone, se ordena en la carpeta de su consola y busca su carátula. Las BIOS conocidas
              (scph5501.bin, bios_CD_U.bin, dc_boot.bin…) van directas a system/. Deja esta pantalla abierta mientras
              suben.
            </Text>
          </>
        )}
        {status?.current ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              Recibiendo {status.current}
            </Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(status.progress * 100)}%` }]} />
            </View>
          </View>
        ) : null}
        {status && status.files > 0 ? (
          <Text style={styles.ok}>
            ✓ {status.files} archivo{status.files === 1 ? '' : 's'} recibido{status.files === 1 ? '' : 's'} ({fmtBytes(status.bytes)})
            {status.last ? ` · último: ${status.last}` : ''}
          </Text>
        ) : null}
        {status?.error ? <Text style={styles.warn}>{status.error}</Text> : null}
      </ScrollView>
    </View>
  );
}

// ---- Ajustes: respaldo de partidas y estado de BIOS ----------------------------------------------
type Bios = { console: string; file: string; found: boolean; md5ok: boolean | null; required: boolean; note: string };

export function SettingsScreen({ onClose, onWifi }: { onClose: () => void; onWifi: () => void }) {
  const [bios, setBios] = useState<Bios[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // MD5 de varios MB: deja pintar primero
    const id = setTimeout(() => {
      try {
        setBios(JSON.parse(Libretro.biosStatus()));
      } catch {
        setBios([]);
      }
    }, 80);
    return () => clearTimeout(id);
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, Bios[]>();
    (bios ?? []).forEach((b) => map.set(b.console, [...(map.get(b.console) ?? []), b]));
    return [...map.entries()];
  }, [bios]);

  const exportBackup = () => {
    setBusy(true);
    Libretro.exportBackup()
      .then((path) => Alert.alert('Respaldo creado', `Guardado en ${path.slice(path.indexOf('Backups/'))}. Elige "Guardar en Archivos" → iCloud Drive para tenerlo a salvo.`))
      .catch((e) => Alert.alert('Respaldo', String(e?.message ?? e)))
      .finally(() => setBusy(false));
  };
  const restore = () => {
    Libretro.restoreBackup()
      .then((n) => {
        if (n > 0) Alert.alert('Respaldo restaurado', `${n} archivos de partidas recuperados.`);
      })
      .catch((e) => Alert.alert('No se pudo restaurar', String(e?.message ?? e)));
  };

  return (
    <View style={styles.root}>
      <Header title="Ajustes" kicker="JL EMULATOR" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>TRANSFERIR JUEGOS</Text>
        <Pressable onPress={onWifi} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionText}>📶 Subir por Wi-Fi desde el PC / Mac</Text>
        </Pressable>

        <Text style={styles.section}>RESPALDO DE PARTIDAS</Text>
        <Text style={styles.note}>
          Las partidas (.srm, memory cards) y las ranuras (.state) viven en Documents/saves y Documents/states (visibles en
          Archivos → En mi iPhone → JL Emulator). Una app instalada con Sideloadly no puede usar el contenedor de iCloud
          de la app, así que el respaldo es un .zip que guardas tú en iCloud Drive con Compartir → Guardar en Archivos.
        </Text>
        <View style={styles.rowGap}>
          <Pressable onPress={exportBackup} disabled={busy} style={({ pressed }) => [styles.action, styles.flex, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={theme.amber} /> : <Text style={styles.actionText}>Exportar respaldo (.zip)</Text>}
          </Pressable>
          <Pressable onPress={restore} style={({ pressed }) => [styles.action, styles.flex, pressed && styles.pressed]}>
            <Text style={styles.actionText}>Restaurar respaldo</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>ESTADO DE CONSOLAS Y BIOS</Text>
        {bios === null ? <ActivityIndicator color={theme.amber} /> : null}
        {groups.map(([name, files]) => {
          const good = files.filter((f) => f.found && f.md5ok !== false);
          const bad = files.filter((f) => f.found && f.md5ok === false);
          const required = files.some((f) => f.required);
          const ready = good.length > 0 || !required;
          const light = good.length ? '#22c55e' : bad.length ? '#f59e0b' : required ? '#ef4444' : '#22c55e';
          return (
            <View key={name} style={styles.biosCard}>
              <View style={styles.biosHead}>
                <View style={[styles.light, { backgroundColor: light, shadowColor: light }]} />
                <Text style={styles.biosName}>{name}</Text>
                <Text style={[styles.biosState, { color: light }]}>
                  {good.length ? 'Lista (BIOS verificada)' : bad.length ? 'BIOS no reconocida' : ready ? 'Lista (BIOS HLE)' : 'Falta la BIOS'}
                </Text>
              </View>
              {files.map((f) => (
                <Text key={f.file} style={styles.biosFile}>
                  {f.found ? (f.md5ok === false ? '⚠' : '✓') : '·'} system/{f.file}
                  {f.found && f.md5ok === false ? ' (MD5 distinto: versión no compatible o dañada)' : ''}
                </Text>
              ))}
              {files[0].note ? <Text style={styles.note}>{files[0].note}</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Header({ title, kicker, onClose }: { title: string; kicker: string; onClose: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.flex}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
        <Text style={styles.closeText}>Cerrar</Text>
      </Pressable>
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
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  lead: { color: theme.text, fontSize: 15 },
  urlBox: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.amber, backgroundColor: theme.amberDim, alignItems: 'center' },
  url: { color: theme.amber, fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  copy: { color: theme.textDim, fontSize: 11, marginTop: 4 },
  qr: { width: 220, height: 220, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 12 },
  note: { color: theme.textDim, fontSize: 12, lineHeight: 18 },
  warn: { color: theme.amber, fontSize: 14, fontWeight: '700' },
  ok: { color: '#4ADE80', fontSize: 14, fontWeight: '700' },
  card: { padding: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  cardTitle: { color: theme.text, fontWeight: '700' },
  bar: { height: 6, borderRadius: 3, backgroundColor: '#23262e', marginTop: 8, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: theme.amber },
  section: { color: theme.amber, fontSize: 12, fontWeight: '800', letterSpacing: 2, marginTop: 14 },
  action: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
  },
  actionText: { color: theme.text, fontWeight: '800', fontSize: 14 },
  pressed: { opacity: 0.7 },
  rowGap: { flexDirection: 'row', gap: 10 },
  biosCard: { padding: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, gap: 4 },
  biosHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  light: { width: 12, height: 12, borderRadius: 6, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  biosName: { flex: 1, color: theme.text, fontWeight: '800', fontSize: 14 },
  biosState: { fontSize: 12, fontWeight: '800' },
  biosFile: { color: theme.titaniumHi, fontSize: 12, fontFamily: 'Menlo' },
});
