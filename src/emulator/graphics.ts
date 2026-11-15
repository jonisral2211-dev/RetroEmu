import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoreId } from './cores';

// Calidad gráfica (resolución interna 3D). Estándar = render por software de siempre (probado,
// máxima batería). HD y Ultra activan el render por GPU (OpenGL ES) en los núcleos que lo admiten
// y suben su resolución interna; Ultra añade PGXP, panorámico 16:9 y filtrado anisotrópico.
export type GfxPreset = 'std' | 'hd' | 'ultra';

const KEY = 'jl.gfx.v1';
let current: GfxPreset = 'std';
let loaded = false;

export async function loadGfxPreset(): Promise<GfxPreset> {
  if (loaded) return current;
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === 'std' || v === 'hd' || v === 'ultra') current = v;
  } catch {
    // sin preferencia guardada
  }
  loaded = true;
  return current;
}

export function getGfxPreset(): GfxPreset {
  return current;
}

export function saveGfxPreset(p: GfxPreset): void {
  current = p;
  AsyncStorage.setItem(KEY, p).catch(() => {});
}

/** Núcleos cuyo aspecto cambia con la calidad gráfica. */
export const GFX_CORES: ReadonlySet<CoreId> = new Set<CoreId>(['ppsspp', 'pcsx', 'swanstation', 'mupen64', 'flycast']);

/** PS1: SwanStation (GPU, reescalado y PGXP) en HD/Ultra; PCSX ReARMed (rápido) en Estándar. */
export function ps1CoreFor(p: GfxPreset): CoreId {
  return p === 'std' ? 'pcsx' : 'swanstation';
}

/**
 * Opciones del núcleo para cada calidad. Estándar fija explícitamente los valores por software
 * (las opciones del usuario se conservan entre juegos y tienen prioridad sobre las forzadas).
 */
export function gfxOptions(core: CoreId, p: GfxPreset): [string, string][] {
  const hd = p !== 'std';
  const ultra = p === 'ultra';
  switch (core) {
    case 'ppsspp':
      return hd
        ? [
            ['ppsspp_software_rendering', 'disabled'],
            ['ppsspp_backend', 'opengl'],
            ['ppsspp_internal_resolution', ultra ? '1920x1088' : '960x544'],
            ['ppsspp_texture_replacement', 'enabled'],
            ['ppsspp_texture_anisotropic_filtering', ultra ? '8x' : '4x'],
          ]
        : [
            ['ppsspp_software_rendering', 'enabled'],
            ['ppsspp_internal_resolution', '480x272'],
            ['ppsspp_texture_replacement', 'disabled'],
          ];
    case 'swanstation':
      return [
        ['swanstation_GPU_Renderer', 'Auto'],
        ['swanstation_GPU_ResolutionScale', ultra ? '4' : '3'],
        ['swanstation_GPU_PGXPEnable', ultra ? 'true' : 'false'],
        ['swanstation_GPU_PGXPCulling', ultra ? 'true' : 'false'],
        ['swanstation_GPU_WidescreenHack', ultra ? 'true' : 'false'],
        ['swanstation_Display_AspectRatio', ultra ? '16:9' : 'Auto'],
        ['swanstation_GPU_TrueColor', 'true'],
      ];
    case 'pcsx':
      // Respaldo de SwanStation (sin BIOS real): su mejora 2x por NEON
      return hd ? [['pcsx_rearmed_neon_enhancement_enable', 'enabled']] : [];
    case 'mupen64':
      return hd
        ? [
            ['mupen64plus-rdp-plugin', 'gliden64'],
            ['mupen64plus-43screensize', ultra ? '1920x1440' : '1280x960'],
            ['mupen64plus-169screensize', ultra ? '1920x1080' : '1280x720'],
            ['mupen64plus-aspect', ultra ? '16:9 adjusted' : '4:3'],
            ['mupen64plus-txHiresEnable', 'True'],
            ['mupen64plus-EnableHiResTextures', 'True'],
            ['mupen64plus-txFilterMode', 'None'],
            ['mupen64plus-MultiSampling', '0'],
          ]
        : [
            ['mupen64plus-rdp-plugin', 'angrylion'],
            ['mupen64plus-aspect', '4:3'],
            ['mupen64plus-txHiresEnable', 'False'],
          ];
    case 'flycast':
      return [
        ['flycast_internal_resolution', ultra ? '1920x1440' : hd ? '1280x960' : '640x480'],
        ['flycast_widescreen_hack', ultra ? 'enabled' : 'disabled'],
        ['flycast_anisotropic_filtering', ultra ? '8' : hd ? '4' : 'off'],
        ['flycast_custom_textures', hd ? 'enabled' : 'disabled'],
      ];
    default:
      return [];
  }
}
