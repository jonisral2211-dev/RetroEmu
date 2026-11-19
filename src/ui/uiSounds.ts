import AsyncStorage from '@react-native-async-storage/async-storage';
import { Libretro } from 'react-native-libretro';

// Sonidos sutiles de la interfaz (sonidos del sistema de iOS: respetan el interruptor de silencio)
export type UiSound = 'move' | 'select' | 'back' | 'tab';

const KEY = 'jl.uisounds.v1';
let enabled = true;
let lastMove = 0;

AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v === '0') enabled = false;
  })
  .catch(() => {});

export function uiSoundsEnabled(): boolean {
  return enabled;
}

export function setUiSoundsEnabled(on: boolean): void {
  enabled = on;
  AsyncStorage.setItem(KEY, on ? '1' : '0').catch(() => {});
}

export function playUi(kind: UiSound): void {
  if (!enabled) return;
  // El desplazamiento rápido con el stick no debe sonar como una ráfaga
  if (kind === 'move') {
    const now = Date.now();
    if (now - lastMove < 70) return;
    lastMove = now;
  }
  try {
    Libretro.uiSound(kind);
  } catch {
    // nativo sin sonidos de interfaz
  }
}
