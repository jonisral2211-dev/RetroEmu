import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Libretro, LibretroView } from 'react-native-libretro';
import { coreForConsole } from '../emulator/cores';
import { layoutFor } from '../input/layouts';
import { getPadDebug, VirtualPad } from '../input/VirtualPad';
import { useGamepadStatus } from '../input/useGamepadStatus';

type Props = { romPath: string; onExit: () => void };

// Ranura única de guardado rápido
const SAVE_SLOT = 0;

export default function PlayerScreen({ romPath, onExit }: Props) {
  // Consola por contenido verificado (nativo), no por extensión
  const core = useMemo(() => coreForConsole(Libretro.consoleOf(romPath)), [romPath]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [genesisSix, setGenesisSix] = useState(false);
  // N64: un solo direccional a la izquierda (stick o cruceta)
  const [dirMode, setDirMode] = useState<'stick' | 'dpad'>('stick');
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  // Con un DualSense conectado el pad táctil se oculta; el usuario puede forzarlo con el botón.
  // Al cambiar la conexión se descarta el override manual.
  const pad = useGamepadStatus();
  const [touchOverride, setTouchOverride] = useState<boolean | null>(null);
  useEffect(() => setTouchOverride(null), [pad.dualSense]);
  const touchVisible = touchOverride ?? !pad.dualSense;

  // Diagnóstico de entrada en pantalla (sin Mac no hay otra forma de ver los logs nativos)
  const [debugOn, setDebugOn] = useState(false);
  const [debugText, setDebugText] = useState<string | null>(null);
  useEffect(() => {
    if (!debugOn) return;
    const id = setInterval(() => setDebugText(`${Libretro.debugState()}\n${getPadDebug()}`), 500);
    return () => clearInterval(id);
  }, [debugOn]);

  useEffect(() => {
    if (!core) {
      setError('Esta ROM no tiene una cabecera válida para ninguna consola soportada');
      return;
    }
    try {
      if (!Libretro.loadCore(core)) {
        throw new Error(Libretro.lastError() || `No se pudo cargar el núcleo "${core}"`);
      }
      if (!Libretro.loadGame(romPath)) {
        throw new Error(Libretro.lastError() || 'No se pudo abrir la ROM');
      }
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

  const layout = layoutFor(core, genesisSix, landscape);
  // Solo se muestra un direccional: el stick o la cruceta, según el modo elegido
  const padLayout =
    core === 'mupen64'
      ? {
          ...layout,
          clusters: layout.clusters.filter((c) => c.id !== (dirMode === 'stick' ? 'dpad' : 'stick')),
        }
      : layout;

  const hud = (
    <View style={[styles.hud, landscape && styles.hudLandscape]}>
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
      <Pressable
        onPress={() => flash(Libretro.saveState(SAVE_SLOT) ? 'Estado guardado' : 'Error al guardar')}
        style={styles.button}>
        <Text style={styles.buttonText}>Guardar</Text>
      </Pressable>
      <Pressable
        onPress={() =>
          flash(Libretro.loadState(SAVE_SLOT) ? 'Estado cargado' : 'Sin estado guardado')
        }
        style={styles.button}>
        <Text style={styles.buttonText}>Cargar</Text>
      </Pressable>
      {core === 'mupen64' ? (
        <Pressable
          onPress={() => setDirMode((m) => (m === 'stick' ? 'dpad' : 'stick'))}
          style={styles.button}>
          <Text style={styles.buttonText}>{dirMode === 'stick' ? 'Stick' : 'D-Pad'}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => setDebugOn((v) => !v)} style={styles.button}>
        <Text style={styles.buttonText}>{debugOn ? 'Ocultar debug' : 'Debug'}</Text>
      </Pressable>
    </View>
  );

  const notices = (
    <>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {debugOn && debugText ? <Text style={styles.debug}>{debugText}</Text> : null}
      {pad.connected && pad.dualSense ? (
        <Text style={styles.notice}>DualSense conectado: {pad.name || 'PS5'}</Text>
      ) : null}
    </>
  );

  // Horizontal, o vertical con el pad oculto: la imagen ocupa toda la pantalla
  if (landscape || !touchVisible) {
    // Horizontal: imagen centrada a altura completa (el nativo letterboxa) y controles
    // translúcidos sobre los extremos de la pantalla
    return (
      <View style={styles.root}>
        <LibretroView style={StyleSheet.absoluteFill} filter={core === 'mupen64'} />
        {/* El pad va antes que el HUD: así los botones de arriba reciben sus propios toques */}
        {touchVisible ? (
          <VirtualPad
            key={padLayout.name + dirMode}
            layout={padLayout}
            style={StyleSheet.absoluteFill}
            opacity={0.45}
          />
        ) : null}
        <View style={styles.overlayTop} pointerEvents="box-none">
          {hud}
          {notices}
        </View>
      </View>
    );
  }

  // Vertical: imagen 4:3 arriba y controles completos abajo
  return (
    <View style={styles.root}>
      {hud}
      {notices}
      <LibretroView style={styles.screenPortrait} filter={core === 'mupen64'} />
      {touchVisible ? <VirtualPad key={padLayout.name + dirMode} layout={padLayout} style={styles.padPortrait} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { color: '#fff', textAlign: 'center', marginBottom: 16 },
  hud: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8 },
  hudLandscape: { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8 },
  overlayTop: { ...StyleSheet.absoluteFillObject, alignItems: 'flex-start' },
  button: { backgroundColor: '#222', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  notice: { color: '#8f8', textAlign: 'center', paddingBottom: 4 },
  debug: { color: '#ff0', fontSize: 11, paddingHorizontal: 8, paddingBottom: 4 },
  screenPortrait: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#000' },
  padPortrait: { flex: 1 },
});
