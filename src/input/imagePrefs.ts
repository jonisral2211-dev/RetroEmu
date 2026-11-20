import AsyncStorage from '@react-native-async-storage/async-storage';

// Ajustes de imagen por consola (se aplican en vivo en la GPU, iPhone y TV):
//  - shader: 'auto' = filtro de "Calidad de imagen" (Nítido / Suavizado); 'xbrz' = suavizado de
//    bordes de sprites; 'crt' = TV Trinitron; 'lcd' = rejilla de pantalla portátil
//  - smooth: suavizado de píxeles 0 (píxel perfecto) .. 1 (vectorial suave)
//  - sharpen: nitidez HD adaptativa (tipo CAS) 0..1
//  - color: Normal, Vívido (HDR simulado) o Cine clásico
export type ImageShader = 'auto' | 'xbrz' | 'crt' | 'lcd';
export type ImageColor = 'normal' | 'vivid' | 'cine';
export type ImagePrefs = { shader: ImageShader; smooth: number; sharpen: number; color: ImageColor };

const KEY = (console: string) => `jl.image.${console || 'otros'}.v1`;

/** Valores de fábrica: rejilla LCD en Game Boy / Color, el resto como hasta ahora. */
export function defaultImagePrefs(console: string): ImagePrefs {
  if (console === 'gb' || console === 'gbc') return { shader: 'lcd', smooth: 0, sharpen: 0, color: 'normal' };
  return { shader: 'auto', smooth: 0, sharpen: 0, color: 'normal' };
}

export async function loadImagePrefs(console: string): Promise<ImagePrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY(console));
    if (raw) return { ...defaultImagePrefs(console), ...(JSON.parse(raw) as Partial<ImagePrefs>) };
  } catch {
    // sin ajustes guardados
  }
  return defaultImagePrefs(console);
}

export function saveImagePrefs(console: string, prefs: ImagePrefs): void {
  AsyncStorage.setItem(KEY(console), JSON.stringify(prefs)).catch(() => {});
}

/** Ajustes "✨ Ultra HD Remaster" para consolas 2D / arcade: suavizado de bordes + nitidez + color. */
export const REMASTER_2D: ImagePrefs = { shader: 'xbrz', smooth: 0.85, sharpen: 0.55, color: 'vivid' };
/** Complemento de imagen para el Remaster 3D (la resolución la sube el núcleo). */
export const REMASTER_3D: ImagePrefs = { shader: 'auto', smooth: 0, sharpen: 0.35, color: 'vivid' };

/** Parámetros nativos: [shader, suavizado, nitidez, color]. */
export function nativeImageArgs(p: ImagePrefs): [number, number, number, number] {
  // 5 = 2D píxel perfecto + suavizado aunque el filtro sea "Suavizado ligero"
  const shader = p.shader === 'crt' ? 3 : p.shader === 'lcd' ? 4 : p.shader === 'xbrz' ? 5 : 0;
  const color = p.color === 'vivid' ? 1 : p.color === 'cine' ? 2 : 0;
  return [shader, p.smooth, p.sharpen, color];
}

// Perfil por juego: si el título tiene ajustes guardados, mandan sobre los de la consola
const GAME_KEY = (romPath: string) => `jl.gameimage.v1:${romPath}`;

export async function loadGameImagePrefs(romPath: string): Promise<ImagePrefs | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY(romPath));
    return raw ? (JSON.parse(raw) as ImagePrefs) : null;
  } catch {
    return null;
  }
}

export function saveGameImagePrefs(romPath: string, prefs: ImagePrefs): void {
  AsyncStorage.setItem(GAME_KEY(romPath), JSON.stringify(prefs)).catch(() => {});
}
