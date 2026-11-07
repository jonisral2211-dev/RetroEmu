import NativeLibretro from './NativeLibretro';
import LibretroViewNative from './LibretroViewNativeComponent';

/** Control del emulador (TurboModule). */
export const Libretro = NativeLibretro;

/** Superficie de render nativa (Fabric + Metal). */
export const LibretroView = LibretroViewNative;

export type { Spec as LibretroSpec } from './NativeLibretro';
