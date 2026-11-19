import type { CoreId } from './cores';

// Ranuras de guardado. Un mismo juego abierto con otro núcleo (FBNeo vs MAME, DeSmuME vs
// melonDS) usa ranuras propias: sus estados no son compatibles entre núcleos.
export function slotsFor(core: CoreId | null): { save: number; auto: number } {
  // SwanStation y PCSX abren los mismos juegos pero sus estados no son compatibles
  if (core === 'swanstation') return { save: 2, auto: 97 };
  const alt = core === 'fbneo' || core === 'desmume';
  return alt ? { save: 1, auto: 98 } : { save: 0, auto: 99 };
}

/** Número de la primera de las 5 ranuras manuales (las del menú de pausa) para ese núcleo. */
export function manualSlotBase(core: CoreId | null): number {
  return 10 + slotsFor(core).save * 10;
}
