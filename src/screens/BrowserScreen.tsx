import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import {
  DownloadItem,
  getDownloads,
  startDownload,
  subscribeDownloads,
} from '../downloads/DownloadManager';
import { isRomUrl, QUICK_LINKS } from '../downloads/romLinks';

const HOME = QUICK_LINKS[0]?.url ?? 'https://duckduckgo.com/';

// Normaliza lo que escribe el usuario: añade https:// o convierte en búsqueda
function toUrl(input: string): string {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(text)) return `https://${text}`;
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
      return `Descargando ${Math.round(item.progress * 100)} %`;
    case 'importing':
      return 'Clasificando e importando…';
    case 'done':
      return `Listo: ${item.message ?? item.name}`;
    case 'error':
      return `Error: ${item.message ?? 'desconocido'}`;
  }
}

export default function BrowserScreen() {
  const webRef = useRef<WebView>(null);
  const [target, setTarget] = useState(HOME); // lo que carga el WebView (solo cambia al navegar desde la barra)
  const [input, setInput] = useState(HOME);   // texto de la barra de direcciones
  const [canGoBack, setCanGoBack] = useState(false);
  const downloads = useDownloads();

  const go = (raw: string) => {
    const url = toUrl(raw);
    setInput(url);
    setTarget(url);
  };

  const onNavigation = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
    if (nav.url && !nav.url.startsWith('about:')) setInput(nav.url);
  };

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => go(input)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          style={styles.input}
          placeholder="Dirección o búsqueda"
          placeholderTextColor="#666"
        />
        <Pressable onPress={() => go(input)} style={styles.button}>
          <Text style={styles.buttonText}>Ir</Text>
        </Pressable>
        <Pressable
          onPress={() => webRef.current?.goBack()}
          disabled={!canGoBack}
          style={[styles.button, !canGoBack && styles.disabled]}>
          <Text style={styles.buttonText}>←</Text>
        </Pressable>
      </View>

      <ScrollView horizontal style={styles.quick} contentContainerStyle={styles.quickContent}>
        {QUICK_LINKS.map((link) => (
          <Pressable key={link.url} onPress={() => go(link.url)} style={styles.chip}>
            <Text style={styles.chipText}>{link.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <WebView
        ref={webRef}
        source={{ uri: target }}
        style={styles.web}
        setSupportMultipleWindows={false}
        onNavigationStateChange={onNavigation}
        // Enlaces a ROM: se cancela la navegación y se descarga directamente a la biblioteca
        onShouldStartLoadWithRequest={(req) => {
          if (isRomUrl(req.url)) {
            startDownload(req.url);
            return false;
          }
          return true;
        }}
      />

      {downloads.length > 0 ? (
        <View style={styles.downloads}>
          <Text style={styles.downloadsTitle}>Descargas</Text>
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
                      { width: `${Math.round(d.progress * 100)}%` },
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  button: { backgroundColor: '#222', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8 },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600' },
  quick: { flexGrow: 0, paddingHorizontal: 8, paddingBottom: 6 },
  quickContent: { gap: 6 },
  chip: { backgroundColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  chipText: { color: '#ccc', fontSize: 13 },
  web: { flex: 1, backgroundColor: '#fff' },
  downloads: { maxHeight: 180, backgroundColor: '#0d0d0d', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#333', padding: 10 },
  downloadsTitle: { color: '#fff', fontWeight: '700', marginBottom: 6 },
  row: { marginBottom: 10 },
  name: { color: '#eee' },
  track: { height: 6, backgroundColor: '#222', borderRadius: 3, marginVertical: 4, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: '#4ade80' },
  fillError: { backgroundColor: '#f66' },
  status: { color: '#999', fontSize: 12 },
  error: { color: '#f66' },
});
