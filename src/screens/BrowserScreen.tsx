import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Bookmark, loadBookmarks, saveBookmarks } from '../downloads/bookmarks';
import {
  clearFinishedDownloads,
  DownloadItem,
  formatBytes,
  getDownloads,
  startDownload,
  subscribeDownloads,
} from '../downloads/DownloadManager';
import { isRomUrl, ROM_EXTENSIONS } from '../downloads/romLinks';
import { theme } from '../theme';

// Navegador neutral: sin páginas ni enlaces preinstalados. Arranca en una página de inicio
// local con los marcadores que guarde el usuario. El texto que no es una dirección se busca.
function toUrl(input: string): string {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

function useDownloads(): DownloadItem[] {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeDownloads(rerender), []);
  return getDownloads();
}

function statusText(item: DownloadItem): string {
  switch (item.state) {
    case 'downloading':
      return item.total
        ? `${Math.round(item.progress * 100)} % · ${formatBytes(item.bytes)} de ${formatBytes(item.total)}`
        : `Descargando… ${formatBytes(item.bytes)}`;
    case 'importing':
      return 'Clasificando en su carpeta…';
    case 'done':
      return `Guardado en ${item.message ?? item.name} · ya está en la biblioteca`;
    case 'error':
      return item.message ?? 'Error desconocido';
  }
}

export default function BrowserScreen() {
  const webRef = useRef<WebView>(null);
  const [target, setTarget] = useState<string | null>(null); // null = página de inicio local
  const [input, setInput] = useState('');
  const [current, setCurrent] = useState<{ url: string; title: string } | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const downloads = useDownloads();

  useEffect(() => {
    loadBookmarks().then(setBookmarks);
  }, []);

  const go = (raw: string) => {
    if (!raw.trim()) return;
    const url = toUrl(raw);
    setInput(url);
    setTarget(url);
  };

  const goHome = () => {
    setTarget(null);
    setCurrent(null);
    setInput('');
    setCanGoBack(false);
    setCanGoForward(false);
  };

  const onNavigation = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
    setCanGoForward(nav.canGoForward);
    setLoading(nav.loading);
    if (nav.url && !nav.url.startsWith('about:')) {
      setInput(nav.url);
      setCurrent({ url: nav.url, title: nav.title || nav.url });
    }
  };

  const isBookmarked = !!current && bookmarks.some((b) => b.url === current.url);
  const toggleBookmark = () => {
    if (!current) return;
    const next = isBookmarked
      ? bookmarks.filter((b) => b.url !== current.url)
      : [{ title: current.title, url: current.url }, ...bookmarks];
    setBookmarks(next);
    saveBookmarks(next);
  };
  const removeBookmark = (b: Bookmark) =>
    Alert.alert('Eliminar marcador', b.title, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          const next = bookmarks.filter((x) => x.url !== b.url);
          setBookmarks(next);
          saveBookmarks(next);
        },
      },
    ]);

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => go(input)}
          selectTextOnFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          style={styles.input}
          placeholder="Escribe una dirección o busca"
          placeholderTextColor={theme.textDim}
        />
        {target ? (
          <NavButton label={isBookmarked ? '★' : '☆'} onPress={toggleBookmark} active={isBookmarked} />
        ) : null}
      </View>
      <View style={styles.navRow}>
        <NavButton label="‹ Atrás" onPress={() => webRef.current?.goBack()} disabled={!target || !canGoBack} />
        <NavButton label="Adelante ›" onPress={() => webRef.current?.goForward()} disabled={!target || !canGoForward} />
        <NavButton
          label={loading ? 'Detener' : 'Recargar'}
          onPress={() => (loading ? webRef.current?.stopLoading() : webRef.current?.reload())}
          disabled={!target}
        />
        <NavButton label="Inicio" onPress={goHome} />
      </View>

      {target ? (
        <WebView
          ref={webRef}
          source={{ uri: target }}
          style={styles.web}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          onNavigationStateChange={onNavigation}
          // Enlaces con extensión de juego: se cancela la navegación y se descarga dentro de la app
          onShouldStartLoadWithRequest={(req) => {
            if (isRomUrl(req.url)) {
              startDownload(req.url);
              return false;
            }
            return true;
          }}
          // iOS: respuestas que el WebView no puede mostrar (descargas sin extensión en la URL,
          // Content-Disposition: attachment). El importador decide si el archivo es compatible.
          onFileDownload={({ nativeEvent }) => {
            if (nativeEvent.downloadUrl) startDownload(nativeEvent.downloadUrl);
          }}
        />
      ) : (
        <ScrollView style={styles.start} contentContainerStyle={styles.startContent}>
          <Text style={styles.startTitle}>Explorar web</Text>
          <Text style={styles.startText}>
            Escribe una dirección o una búsqueda arriba. Los archivos de juego que descargues (
            {ROM_EXTENSIONS.join(' ')}) se guardan solos en su carpeta y aparecen en la biblioteca.
          </Text>
          <Text style={styles.section}>Mis marcadores</Text>
          {bookmarks.length === 0 ? (
            <Text style={styles.startText}>
              Aún no tienes marcadores. Abre una página y pulsa ☆ para guardarla aquí.
            </Text>
          ) : (
            bookmarks.map((b) => (
              <Pressable
                key={b.url}
                onPress={() => go(b.url)}
                onLongPress={() => removeBookmark(b)}
                style={({ pressed }) => [styles.bookmark, pressed && styles.pressed]}>
                <Text style={styles.bookmarkTitle} numberOfLines={1}>
                  {b.title}
                </Text>
                <Text style={styles.bookmarkUrl} numberOfLines={1}>
                  {b.url}
                </Text>
              </Pressable>
            ))
          )}
          {bookmarks.length > 0 ? (
            <Text style={styles.hint}>Mantén pulsado un marcador para eliminarlo.</Text>
          ) : null}
        </ScrollView>
      )}

      {downloads.length > 0 ? (
        <View style={styles.downloads}>
          <View style={styles.downloadsHeader}>
            <Text style={styles.downloadsTitle}>Descargas</Text>
            <Pressable onPress={clearFinishedDownloads}>
              <Text style={styles.clear}>Limpiar</Text>
            </Pressable>
          </View>
          <ScrollView>
            {downloads.map((d) => (
              <View key={d.id} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {d.name}
                </Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width:
                          d.state === 'downloading' && d.progress < 0
                            ? '30%'
                            : `${Math.round(Math.max(0, d.progress) * 100)}%`,
                      },
                      d.state === 'done' && styles.fillDone,
                      d.state === 'error' && styles.fillError,
                    ]}
                  />
                </View>
                <Text style={[styles.status, d.state === 'error' && styles.error]} numberOfLines={2}>
                  {statusText(d)}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function NavButton({
  label,
  onPress,
  disabled,
  active,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.navButton, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={[styles.navText, active && styles.navTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 8 },
  input: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  navRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  navButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  navText: { color: theme.titaniumHi, fontWeight: '600', fontSize: 13 },
  navTextActive: { color: theme.amber },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  web: { flex: 1, backgroundColor: '#fff' },
  start: { flex: 1 },
  startContent: { padding: 20 },
  startTitle: { color: theme.text, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  startText: { color: theme.textDim, lineHeight: 20, marginBottom: 12 },
  section: { color: theme.amber, fontWeight: '700', marginTop: 12, marginBottom: 8, letterSpacing: 0.4 },
  bookmark: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  bookmarkTitle: { color: theme.text, fontWeight: '600' },
  bookmarkUrl: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  hint: { color: theme.textDim, fontSize: 12, marginTop: 4 },
  downloads: {
    maxHeight: 200,
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 12,
  },
  downloadsHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  downloadsTitle: { color: theme.text, fontWeight: '700' },
  clear: { color: theme.amber, fontWeight: '600' },
  row: { marginBottom: 10 },
  name: { color: theme.text },
  track: { height: 6, backgroundColor: theme.border, borderRadius: 3, marginVertical: 5, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: theme.amber },
  fillDone: { backgroundColor: '#4ade80' },
  fillError: { backgroundColor: theme.danger },
  status: { color: theme.textDim, fontSize: 12 },
  error: { color: theme.danger },
});
