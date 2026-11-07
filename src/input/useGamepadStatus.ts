import { useEffect, useState } from 'react';
import { NativeEventEmitter } from 'react-native';
import { Libretro } from 'react-native-libretro';

export type GamepadStatus = { connected: boolean; dualSense: boolean; name: string };

const NONE: GamepadStatus = { connected: false, dualSense: false, name: '' };

// Estado del mando físico emitido por nativo (GameController.framework).
export function useGamepadStatus(): GamepadStatus {
  const [status, setStatus] = useState<GamepadStatus>(NONE);

  useEffect(() => {
    // Estado síncrono al montar (el evento inicial llega al suscribirse)
    const dual = Libretro.hasDualSense();
    setStatus((prev) => ({ ...prev, dualSense: dual, connected: dual || prev.connected }));

    const emitter = new NativeEventEmitter(Libretro as never);
    const sub = emitter.addListener('gamepadStatus', (s: GamepadStatus) => setStatus(s));
    return () => sub.remove();
  }, []);

  return status;
}
