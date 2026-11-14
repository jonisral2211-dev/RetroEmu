import React, { useState } from 'react';
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { theme } from './theme';
import BrowserScreen from './screens/BrowserScreen';
import LibraryScreen from './screens/LibraryScreen';
import PlayerScreen from './screens/PlayerScreen';

type Tab = 'library' | 'web';

export default function App() {
  const [romPath, setRomPath] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('library');

  // Ambas pantallas quedan montadas (la sesión del navegador y la biblioteca se conservan);
  // la inactiva se oculta. Al jugar se oculta todo el contenedor y aparece el reproductor.
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
        {romPath ? <PlayerScreen romPath={romPath} onExit={() => setRomPath(null)} /> : null}
        <View style={[styles.root, romPath ? styles.hidden : null]}>
          <View style={styles.root}>
            <View style={[styles.pane, tab !== 'library' && styles.hidden]}>
              <LibraryScreen onPlay={setRomPath} />
            </View>
            <View style={[styles.pane, tab !== 'web' && styles.hidden]}>
              <BrowserScreen />
            </View>
          </View>
          <View style={styles.tabBar}>
            <TabButton label="Biblioteca" active={tab === 'library'} onPress={() => setTab('library')} />
            <TabButton label="Explorar web" active={tab === 'web'} onPress={() => setTab('web')} />
          </View>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tab}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { color: theme.textDim, fontWeight: '600', letterSpacing: 0.3 },
  tabTextActive: { color: theme.amber },
});
