import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { Libretro } from 'react-native-libretro';

/**
 * Inclinación del iPhone (giroscopio) como Animated.ValueXY en [-1, 1] para el paralaje 3D.
 * Solo lee el sensor mientras `enabled`; al apagarse vuelve suavemente al centro.
 */
export function useTilt(enabled: boolean): Animated.ValueXY {
  const tilt = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  useEffect(() => {
    if (!enabled) {
      Animated.spring(tilt, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      return;
    }
    try {
      Libretro.motionStart();
    } catch {
      return;
    }
    let frame = 0;
    let last = 0;
    const loop = (t: number) => {
      // ~30 lecturas por segundo: suficiente y barato
      if (t - last > 32) {
        last = t;
        const [x, y] = Libretro.motionTilt().split('|').map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) tilt.setValue({ x, y });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      Libretro.motionStop();
      Animated.spring(tilt, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
    };
  }, [enabled, tilt]);
  return tilt;
}
