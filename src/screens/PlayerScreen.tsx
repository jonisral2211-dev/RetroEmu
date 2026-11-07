import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Libretro, LibretroView } from 'react-native-libretro';
import { coreForFile } from '../emulator/cores';
import { layoutFor } from '../input/layouts';
import { VirtualPad } from '../input/VirtualPad';
import { useGamepadStatus } from '../input/useGamepadStatus';

type Props = { romPath: string; onExit: () => void };

const SLOTS = [0, 1, 2];

export default function PlayerScreen({ romPath, onExit }: Props) {
  const core = coreForFile(romPath);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [genesisSix, setGenesisSix] = useState(false);

  // Con un DualSense conectado el pad táctil se oculta; el usuario puede forzarlo con el botón.
  // Al cambiar la conexión se descarta el override manual.
  const pad = useGamepadStatus();
  const [touchOverride, setTouchOverride] = useState<boolean | null>(null);
  useEffect(() => setTouchOverride(null), [pad.dualSense]);
  const touchVisible = touchOverride ?? !pad.dualSense;

  useEffect(() => {
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
  }, [romPath, core]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 1500);
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    Libretro.setPaused(next);
  };

  if (error || !ready || !core) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{error ?? 'Cargando…'}</Text>
        <Pressable onPress={onExit} style={styles.button}>
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const layout = layoutFor(core, genesisSix);

  return (
    <View style={styles.root}>
      <View style={styles.hud}>
        <Pressable onPress={onExit} style={styles.button}>
          <Text style={styles.buttonText}>Salir</Text>
        </Pressable>
        <Pressable onPress={togglePause} style={styles.button}>
          <Text style={styles.buttonText}>{paused ? 'Reanudar' : 'Pausa'}</Text>
        </Pressable>
        {core === 'genesis' ? (
          <Pressable onPress={() => setGenesisSix((v) => !v)} style={styles.button}>
            <Text style={styles.buttonText}>{genesisSix ? '6 btn' : '3 btn'}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setTouchOverride(!touchVisible)} style={styles.button}>
          <Text style={styles.buttonText}>{touchVisible ? 'Ocultar pad' : 'Mostrar pad'}</Text>
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

      {/* key: al cambiar de layout se remonta el pad y se reinician sus gestos */}
      {pad.connected && pad.dualSense ? (
        <Text style={styles.notice}>DualSense conectado: {pad.name || 'PS5'}</Text>
      ) : null}
      {touchVisible ? <VirtualPad key={layout.name} layout={layout} /> : null}
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
