import AsyncStorage from '@react-native-async-storage/async-storage';

// Servidor de salas (JL Relay) para jugar a distancia sin abrir puertos: "host:puerto".
// El servidor está en relay/ del repositorio (Docker).
const KEY = 'jl.relay.v1';
// Servidor JL Relay en Oracle Cloud (IP fija). El usuario puede cambiarlo en Jugar en línea.
export const DEFAULT_RELAY = '193.122.221.98:55436';
/** Puerto HTTP de la página del mando web (/play) en el mismo servidor. */
export const WEBPAD_HTTP_PORT = 8080;
export const RELAY_PORT = 55436;

export async function loadRelay(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY)) || DEFAULT_RELAY;
  } catch {
    return DEFAULT_RELAY;
  }
}

export function saveRelay(value: string): void {
  AsyncStorage.setItem(KEY, value.trim()).catch(() => {});
}

export function parseRelay(value: string): { host: string; port: number } | null {
  const v = value.trim();
  if (!v) return null;
  const i = v.lastIndexOf(':');
  if (i > 0 && /^\d+$/.test(v.slice(i + 1))) return { host: v.slice(0, i), port: Number(v.slice(i + 1)) };
  return { host: v, port: RELAY_PORT };
}

/** Código de sala del relay: 6 caracteres sin 0/O/1/I. */
export function isRoomCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/i.test(value.trim());
}
