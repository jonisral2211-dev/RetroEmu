import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Libretro, LibretroView } from 'react-native-libretro';
import { coreForFile } from '../emulator/cores';
import { VirtualPad } from '../ui/VirtualPad';

type Props = { romPath: string; onExit: () => void };

const SLOTS = [0, 1, 2];

export default function PlayerScreen({ romPath, onExit }: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const core = coreForFile(romPath);
    if (!core) {
      setError('Formato de ROM no soportado');
      return;
    }
    try {
      if (!Libretro.loadCore(core)) throw new Error(`No se pudo cargar el núcleo "${core}"`);
      if (!Libretro.loadGame(romPath)) throw new Error('No se pudo abrir la ROM');
      Libretro.start();
      setReady(true);
    } catch (e) {
      setError(String(e));
    }
    return () => {
      // Para y persiste la SRAM antes de descargar
      Libretro.stop();
      Libretro.unloadGame();
    };
  }, [romPath]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 1500);
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    Libretro.setPaused(next);
  };

  if (error || !ready) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{error ?? 'Cargando…'}</Text>
        <Pressable onPress={onExit} style={styles.button}>
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.hud}>
        <Pressable onPress={onExit} style={styles.button}>
          <Text style={styles.buttonText}>Salir</Text>
        </Pressable>
        <Pressable onPress={togglePause} style={styles.button}>
          <Text style={styles.buttonText}>{paused ? 'Reanudar' : 'Pausa'}</Text>
        </Pressable>
        {SLOTS.map((slot) => (
          <View key={slot} style={styles.slot}>
            <Pressable
              onPress={() =>
                flash(Libretro.saveState(slot) ? `Estado ${slot} guardado` : 'Error al guardar')
              }
              style={styles.button}>
              <Text style={styles.buttonText}>G{slot}</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                flash(Libretro.loadState(slot) ? `Estado ${slot} cargado` : 'Sin estado en esa ranura')
              }
              style={styles.button}>
              <Text style={styles.buttonText}>C{slot}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <LibretroView style={styles.screen} filter={false} />

      <VirtualPad onChange={(mask) => Libretro.setButtons(mask)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { color: '#fff', textAlign: 'center', marginBottom: 16 },
  hud: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8 },
  slot: { flexDirection: 'row', gap: 4 },
  button: { backgroundColor: '#222', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  notice: { color: '#8f8', textAlign: 'center', paddingBottom: 4 },
  screen: { flex: 1, backgroundColor: '#000' },
});
