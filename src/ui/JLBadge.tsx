import React from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

// Distintivo JL de la cabecera: misma estética que el icono de la app (oro 3D con filo azul,
// anillo oro/azul sobre carbono), simplificado para verse nítido a 40-60 pt.
const J = 'M286 300 H556 V598 Q556 726 432 726 H374 Q286 726 286 640 V586 H396 V610 Q396 626 414 626 H426 Q446 626 446 606 V392 H286 Z';
const L = 'M590 300 H700 V622 H824 V726 H590 Z';

export function JLBadge({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Defs>
        <LinearGradient id="jb-bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#23262c" />
          <Stop offset="0.5" stopColor="#111317" />
          <Stop offset="1" stopColor="#050607" />
        </LinearGradient>
        <RadialGradient id="jb-core" cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#1d4ed8" stopOpacity="0.6" />
          <Stop offset="1" stopColor="#1d4ed8" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id="jb-gold" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#fff6c8" />
          <Stop offset="0.2" stopColor="#f7d774" />
          <Stop offset="0.48" stopColor="#d4af37" />
          <Stop offset="0.66" stopColor="#a87d17" />
          <Stop offset="0.85" stopColor="#e9c55a" />
          <Stop offset="1" stopColor="#8a6410" />
        </LinearGradient>
        <LinearGradient id="jb-ring" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#f7d774" />
          <Stop offset="0.45" stopColor="#d4af37" />
          <Stop offset="0.55" stopColor="#38bdf8" />
          <Stop offset="1" stopColor="#8a6410" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#jb-bg)" />
      <Circle cx="512" cy="512" r="420" fill="url(#jb-core)" />
      <Circle cx="512" cy="512" r="430" fill="none" stroke="url(#jb-ring)" strokeWidth="26" />
      <G transform="translate(-40 -10)">
        <G fill="#3a2803">
          <Path d={J} transform="translate(26 26)" />
          <Path d={L} transform="translate(26 26)" />
          <Path d={J} transform="translate(14 14)" />
          <Path d={L} transform="translate(14 14)" />
        </G>
        <G fill="url(#jb-gold)" stroke="#38bdf8" strokeWidth="14" strokeLinejoin="round">
          <Path d={J} />
          <Path d={L} />
        </G>
      </G>
    </Svg>
  );
}
