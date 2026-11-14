import { useEffect, useState } from 'react';
import { NativeEventEmitter } from 'react-native';
import { Libretro } from 'react-native-libretro';

export type GamepadStatus = {
  connected: boolean;
  dualSense: boolean;
  name: string;
  /** PS5, PS4, Xbox o Mando (otros MFi/Bluetooth). */
  kind?: string;
  /** El mando tiene motores de vibración. */
  rumble?: boolean;
  /** Mandos conectados (máx. 2): [0] = Jugador 1, [1] = Jugador 2. */
  count?: number;
  players?: { name: string; kind: string; rumble: boolean }[];
};

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
