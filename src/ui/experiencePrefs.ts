import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// Interruptores de experiencia (Ajustes): vibración Rumble en el iPhone, música ambiental de la
// interfaz SteamOS, paralaje 3D de las carátulas y Live Activity de la partida.
export type ExperiencePrefs = {
  rumble: boolean;
  /** N64: Rumble Pak en el mando (en vez de Controller Pak). */
  n64RumblePak: boolean;
  music: boolean;
  musicVolume: number;
  parallax: boolean;
  liveActivity: boolean;
};

const KEY = 'jl.experience.v1';
const DEFAULTS: ExperiencePrefs = { rumble: true, n64RumblePak: true, music: true, musicVolume: 0.5, parallax: true, liveActivity: true };

let prefs: ExperiencePrefs = { ...DEFAULTS };
let loaded = false;
const listeners = new Set<(p: ExperiencePrefs) => void>();

AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) prefs = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ExperiencePrefs>) };
  })
  .catch(() => {})
  .finally(() => {
    loaded = true;
    listeners.forEach((l) => l(prefs));
  });

export function getExperience(): ExperiencePrefs {
  return prefs;
}

export function experienceLoaded(): boolean {
  return loaded;
}

export function setExperience(patch: Partial<ExperiencePrefs>): void {
  prefs = { ...prefs, ...patch };
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
  listeners.forEach((l) => l(prefs));
}

export function subscribeExperience(fn: (p: ExperiencePrefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useExperience(): ExperiencePrefs {
  const [p, setP] = useState(prefs);
  useEffect(() => subscribeExperience(setP), []);
  return p;
}
