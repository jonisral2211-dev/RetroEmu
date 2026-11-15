import React from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

// Ilustraciones 3D de consolas (vectoriales, nítidas a cualquier tamaño): volumen con
// degradados de luz cenital, brillos especulares, sombra de contacto y halo de neón propio.
// viewBox 160 x 110. Cada Svg tiene sus propias Defs (ids con prefijo por consola).

export type ArtKind =
  | 'ps1'
  | 'nds'
  | 'saturn'
  | 'fbneo'
  | 'mame'
  | 'n64'
  | 'gba'
  | 'psp'
  | 'sega'
  | 'snes'
  | 'nes'
  | 'gb'
  | 'gbc'
  | 'ports'
  | 'dreamcast';

export const ART_GLOW: Record<ArtKind, string> = {
  ps1: '#3B82F6',
  nds: '#38BDF8',
  saturn: '#A855F7',
  fbneo: '#F97316',
  mame: '#EF4444',
  n64: '#22C55E',
  gba: '#6366F1',
  psp: '#22D3EE',
  sega: '#F43F5E',
  snes: '#8B5CF6',
  nes: '#DC2626',
  gb: '#84CC16',
  gbc: '#EAB308',
  ports: '#F59E0B',
  dreamcast: '#F97316',
};

/** Halo de neón y sombra de contacto comunes. */
function Stage({ id, color }: { id: string; color: string }) {
  return (
    <>
      <Defs>
        <RadialGradient id={`${id}-halo`} cx="50%" cy="58%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={color} stopOpacity="0.55" />
          <Stop offset="0.45" stopColor={color} stopOpacity="0.18" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`${id}-floor`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#000" stopOpacity="0.75" />
          <Stop offset="1" stopColor="#000" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Ellipse cx="80" cy="60" rx="78" ry="52" fill={`url(#${id}-halo)`} />
      <Ellipse cx="80" cy="99" rx="62" ry="7" fill={`url(#${id}-floor)`} />
      <Path d="M18 100 Q80 92 142 100" stroke={color} strokeOpacity="0.55" strokeWidth="0.8" fill="none" />
    </>
  );
}

// ---- PlayStation: consola gris con tapa de CD y mando al lado ------------------------
function Ps1() {
  return (
    <>
      <Stage id="ps1" color={ART_GLOW.ps1} />
      <Defs>
        <LinearGradient id="ps1-top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E4E6EA" />
          <Stop offset="1" stopColor="#B9BDC4" />
        </LinearGradient>
        <LinearGradient id="ps1-front" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A9ADB4" />
          <Stop offset="1" stopColor="#7E838B" />
        </LinearGradient>
        <RadialGradient id="ps1-lid" cx="45%" cy="40%" rx="60%" ry="60%">
          <Stop offset="0" stopColor="#D9DCE1" />
          <Stop offset="1" stopColor="#9EA3AB" />
        </RadialGradient>
        <LinearGradient id="ps1-pad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#D5D8DD" />
          <Stop offset="1" stopColor="#8F949C" />
        </LinearGradient>
      </Defs>
      {/* Cuerpo: cara superior en perspectiva + frontal */}
      <Path d="M14 52 L30 36 L112 36 L100 52 Z" fill="url(#ps1-top)" />
      <Path d="M14 52 L100 52 L100 70 L14 70 Z" fill="url(#ps1-front)" />
      <Path d="M100 52 L112 36 L112 54 L100 70 Z" fill="#6D727A" />
      <Path d="M14 52 L100 52" stroke="#F4F5F7" strokeWidth="0.8" />
      {/* Tapa del CD */}
      <Ellipse cx="62" cy="44" rx="25" ry="6.5" fill="url(#ps1-lid)" stroke="#8A8F97" strokeWidth="0.6" />
      <Ellipse cx="62" cy="44" rx="5" ry="1.4" fill="#8A8F97" />
      <Path d="M44 42 Q62 37 80 42" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="0.8" fill="none" />
      {/* Botones Power / Open / Reset y logo */}
      <Circle cx="22" cy="45" r="2.6" fill="#9DA2A9" stroke="#6D727A" strokeWidth="0.5" />
      <Circle cx="96" cy="44" r="2.4" fill="#9DA2A9" stroke="#6D727A" strokeWidth="0.5" />
      <Rect x="24" y="58" width="16" height="2.4" rx="1" fill="#5D6168" />
      <Rect x="74" y="57" width="4" height="4" fill="#E53E3E" />
      <Rect x="78" y="57" width="4" height="4" fill="#F6C343" />
      <Rect x="74" y="61" width="4" height="4" fill="#3B82F6" />
      <Rect x="78" y="61" width="4" height="4" fill="#22C55E" />
      {/* Mando (dogbone) */}
      <G transform="translate(96 66)">
        <Path
          d="M6 8 Q10 0 22 2 L38 2 Q50 0 54 8 Q60 24 50 30 Q44 32 40 24 L20 24 Q16 32 10 30 Q0 24 6 8 Z"
          fill="url(#ps1-pad)"
          stroke="#6D727A"
          strokeWidth="0.6"
        />
        <Path d="M10 8 L14 8 L14 4 L17 4 L17 8 L21 8 L21 11 L17 11 L17 15 L14 15 L14 11 L10 11 Z" fill="#4B5058" />
        <Circle cx="44" cy="5.5" r="2" fill="none" stroke="#22C55E" strokeWidth="1" />
        <Circle cx="49" cy="10" r="2" fill="none" stroke="#EF4444" strokeWidth="1" />
        <Circle cx="44" cy="14.5" r="2" fill="none" stroke="#60A5FA" strokeWidth="1" />
        <Circle cx="39" cy="10" r="2" fill="none" stroke="#F0ABFC" strokeWidth="1" />
        <Rect x="25" y="9" width="4" height="1.6" rx="0.8" fill="#4B5058" />
        <Rect x="31" y="9" width="4" height="1.6" rx="0.8" fill="#4B5058" />
        <Path d="M8 6 Q14 1 22 3" stroke="#FFF" strokeOpacity="0.7" strokeWidth="0.7" fill="none" />
      </G>
      <Path d="M100 92 Q96 80 104 72" stroke="#6D727A" strokeWidth="1" fill="none" />
    </>
  );
}

// ---- Nintendo DS: abierta, dos pantallas encendidas y lápiz -------------------------
function Nds() {
  return (
    <>
      <Stage id="nds" color={ART_GLOW.nds} />
      <Defs>
        <LinearGradient id="nds-shell" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F4F5F7" />
          <Stop offset="1" stopColor="#BFC4CC" />
        </LinearGradient>
        <LinearGradient id="nds-scr" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7DD3FC" />
          <Stop offset="0.5" stopColor="#2563EB" />
          <Stop offset="1" stopColor="#1E1B4B" />
        </LinearGradient>
        <LinearGradient id="nds-scr2" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#A7F3D0" />
          <Stop offset="0.6" stopColor="#0EA5E9" />
          <Stop offset="1" stopColor="#0C4A6E" />
        </LinearGradient>
        <LinearGradient id="nds-pen" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#E5E7EB" />
          <Stop offset="1" stopColor="#6B7280" />
        </LinearGradient>
      </Defs>
      {/* Mitad superior (inclinada hacia atrás) */}
      <Path d="M44 8 L116 8 L120 46 L40 46 Z" fill="url(#nds-shell)" stroke="#9CA3AF" strokeWidth="0.6" />
      <Path d="M56 13 L104 13 L106 40 L54 40 Z" fill="#111827" />
      <Path d="M58 15 L102 15 L104 38 L56 38 Z" fill="url(#nds-scr)" />
      <Path d="M58 15 L80 15 L62 38 L56 38 Z" fill="#FFF" fillOpacity="0.16" />
      <Circle cx="49" cy="27" r="1.3" fill="#9CA3AF" />
      <Circle cx="111" cy="27" r="1.3" fill="#9CA3AF" />
      {/* Bisagra */}
      <Rect x="40" y="45" width="80" height="5" rx="2.5" fill="#9CA3AF" />
      {/* Mitad inferior */}
      <Path d="M36 50 L124 50 L132 90 L28 90 Z" fill="url(#nds-shell)" stroke="#9CA3AF" strokeWidth="0.6" />
      <Path d="M60 54 L100 54 L102 82 L58 82 Z" fill="#111827" />
      <Path d="M62 56 L98 56 L100 80 L60 80 Z" fill="url(#nds-scr2)" />
      <Path d="M62 56 L76 56 L64 80 L60 80 Z" fill="#FFF" fillOpacity="0.18" />
      {/* Cruceta */}
      <Path d="M40 66 L44 66 L44 62 L48 62 L48 66 L52 66 L52 70 L48 70 L48 74 L44 74 L44 70 L40 70 Z" fill="#374151" />
      {/* A B X Y */}
      <Circle cx="114" cy="62" r="2.4" fill="#4B5563" />
      <Circle cx="119" cy="67" r="2.4" fill="#4B5563" />
      <Circle cx="114" cy="72" r="2.4" fill="#4B5563" />
      <Circle cx="109" cy="67" r="2.4" fill="#4B5563" />
      <Circle cx="107" cy="80" r="1.2" fill="#6B7280" />
      <Circle cx="112" cy="80" r="1.2" fill="#6B7280" />
      {/* Lápiz táctil */}
      <G transform="rotate(-28 128 70)">
        <Rect x="104" y="68" width="44" height="3.4" rx="1.7" fill="url(#nds-pen)" />
        <Path d="M148 68 L154 69.7 L148 71.4 Z" fill="#4B5563" />
      </G>
      <Path d="M30 88 L130 88" stroke="#FFF" strokeOpacity="0.5" strokeWidth="0.6" />
    </>
  );
}

// ---- Sega Saturn: consola negra brillante y mando de 6 botones ------------------------
function Saturn() {
  return (
    <>
      <Stage id="sat" color={ART_GLOW.saturn} />
      <Defs>
        <LinearGradient id="sat-top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3F3F46" />
          <Stop offset="1" stopColor="#18181B" />
        </LinearGradient>
        <LinearGradient id="sat-front" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#27272A" />
          <Stop offset="1" stopColor="#09090B" />
        </LinearGradient>
        <RadialGradient id="sat-lid" cx="40%" cy="35%" rx="65%" ry="65%">
          <Stop offset="0" stopColor="#52525B" />
          <Stop offset="0.6" stopColor="#1F1F23" />
          <Stop offset="1" stopColor="#0A0A0C" />
        </RadialGradient>
        <LinearGradient id="sat-pad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3F3F46" />
          <Stop offset="1" stopColor="#0F0F12" />
        </LinearGradient>
      </Defs>
      <Path d="M12 50 L28 30 L118 30 L104 50 Z" fill="url(#sat-top)" />
      <Path d="M12 50 L104 50 L104 70 L12 70 Z" fill="url(#sat-front)" />
      <Path d="M104 50 L118 30 L118 52 L104 70 Z" fill="#050506" />
      <Path d="M12 50 L104 50" stroke="#A1A1AA" strokeOpacity="0.6" strokeWidth="0.7" />
      <Ellipse cx="66" cy="40" rx="26" ry="7.5" fill="url(#sat-lid)" stroke="#52525B" strokeWidth="0.6" />
      <Path d="M46 37 Q66 31 86 37" stroke="#E4E4E7" strokeOpacity="0.55" strokeWidth="0.9" fill="none" />
      <Circle cx="66" cy="40" r="1.6" fill="#A855F7" fillOpacity="0.9" />
      <Rect x="18" y="56" width="22" height="3" rx="1.5" fill="#3F3F46" />
      <Circle cx="96" cy="58" r="2" fill="#71717A" />
      <Circle cx="89" cy="58" r="2" fill="#71717A" />
      <SvgText x="22" y="67" fontSize="5.2" fontWeight="700" fill="#A1A1AA" letterSpacing="1.4">
        SEGA SATURN
      </SvgText>
      {/* Mando de 6 botones */}
      <G transform="translate(92 68)">
        <Path
          d="M4 10 Q6 1 18 1 L44 1 Q56 1 58 10 Q60 22 50 24 Q44 25 40 19 L22 19 Q18 25 12 24 Q2 22 4 10 Z"
          fill="url(#sat-pad)"
          stroke="#52525B"
          strokeWidth="0.6"
        />
        <Circle cx="14" cy="10" r="5" fill="#18181B" stroke="#3F3F46" strokeWidth="0.5" />
        <Path d="M11.5 10 L16.5 10 M14 7.5 L14 12.5" stroke="#71717A" strokeWidth="1.6" />
        <Circle cx="40" cy="7" r="1.8" fill="#A1A1AA" />
        <Circle cx="45" cy="6" r="1.8" fill="#A1A1AA" />
        <Circle cx="50" cy="5" r="1.8" fill="#A1A1AA" />
        <Circle cx="40" cy="13" r="2.2" fill="#71717A" />
        <Circle cx="45.5" cy="12" r="2.2" fill="#71717A" />
        <Circle cx="51" cy="11" r="2.2" fill="#71717A" />
        <Path d="M8 4 Q16 0 28 1" stroke="#FFF" strokeOpacity="0.45" strokeWidth="0.7" fill="none" />
      </G>
    </>
  );
}

// ---- Arcade: gabinete con marquesina encendida, palanca y botones ---------------------
function Cabinet({ id, label, color, accent }: { id: string; label: string; color: string; accent: string }) {
  return (
    <>
      <Stage id={id} color={color} />
      <Defs>
        <LinearGradient id={`${id}-side`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#1F2937" />
          <Stop offset="1" stopColor="#0B1120" />
        </LinearGradient>
        <LinearGradient id={`${id}-front`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#374151" />
          <Stop offset="1" stopColor="#1F2937" />
        </LinearGradient>
        <LinearGradient id={`${id}-marq`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={accent} />
          <Stop offset="0.5" stopColor="#FDE68A" />
          <Stop offset="1" stopColor={accent} />
        </LinearGradient>
        <LinearGradient id={`${id}-scr`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0EA5E9" />
          <Stop offset="0.5" stopColor="#6D28D9" />
          <Stop offset="1" stopColor="#111827" />
        </LinearGradient>
      </Defs>
      {/* Lateral */}
      <Path d="M96 6 L112 12 L112 96 L96 96 Z" fill={`url(#${id}-side)`} />
      {/* Frontal */}
      <Path d="M52 6 L96 6 L96 96 L52 96 Z" fill={`url(#${id}-front)`} />
      {/* Marquesina */}
      <Rect x="52" y="6" width="44" height="14" fill={`url(#${id}-marq)`} />
      <Rect x="52" y="6" width="44" height="14" fill="#FFF" fillOpacity="0.12" />
      <SvgText x="74" y="16.5" fontSize="7.4" fontWeight="900" fill="#1F1300" textAnchor="middle" letterSpacing="0.6">
        {label}
      </SvgText>
      <Path d="M52 20 L96 20" stroke="#000" strokeOpacity="0.5" strokeWidth="1" />
      {/* Pantalla con resplandor */}
      <Rect x="56" y="24" width="36" height="28" rx="2" fill="#030712" />
      <Rect x="58" y="26" width="32" height="24" rx="1.5" fill={`url(#${id}-scr)`} />
      <Path d="M62 44 L66 36 L70 42 L74 32 L80 40 L86 34" stroke="#FDE68A" strokeWidth="1" fill="none" />
      <Rect x="58" y="26" width="32" height="8" fill="#FFF" fillOpacity="0.1" />
      {/* Panel de control */}
      <Path d="M48 56 L100 56 L96 66 L52 66 Z" fill="#4B5563" />
      <Path d="M48 56 L100 56" stroke="#9CA3AF" strokeWidth="0.7" />
      <Path d="M61.5 61 L61.5 54" stroke="#D1D5DB" strokeWidth="1.3" />
      <Circle cx="61.5" cy="52.6" r="3" fill="#EF4444" />
      <Circle cx="60.6" cy="51.8" r="1" fill="#FFF" fillOpacity="0.7" />
      <Circle cx="74" cy="60" r="1.9" fill={accent} />
      <Circle cx="80" cy="59" r="1.9" fill="#22D3EE" />
      <Circle cx="86" cy="60" r="1.9" fill="#FACC15" />
      <Circle cx="77" cy="63.4" r="1.9" fill="#A855F7" />
      <Circle cx="83" cy="63.4" r="1.9" fill="#22C55E" />
      {/* Puerta de monedas */}
      <Rect x="66" y="74" width="16" height="14" rx="1" fill="#111827" stroke="#4B5563" strokeWidth="0.6" />
      <Rect x="69" y="77" width="3" height="5" fill="#F59E0B" />
      <Rect x="76" y="77" width="3" height="5" fill="#F59E0B" />
      <Path d="M52 6 L52 96" stroke="#FFF" strokeOpacity="0.25" strokeWidth="0.8" />
    </>
  );
}

// ---- Nintendo 64: consola con cartucho y cuatro puertos ------------------------------
function N64() {
  return (
    <>
      <Stage id="n64" color={ART_GLOW.n64} />
      <Defs>
        <LinearGradient id="n64-top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#4B5563" />
          <Stop offset="1" stopColor="#1F2937" />
        </LinearGradient>
        <LinearGradient id="n64-front" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2B323C" />
          <Stop offset="1" stopColor="#0F1318" />
        </LinearGradient>
        <LinearGradient id="n64-cart" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#9CA3AF" />
          <Stop offset="1" stopColor="#4B5563" />
        </LinearGradient>
        <LinearGradient id="n64-label" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F59E0B" />
          <Stop offset="1" stopColor="#DC2626" />
        </LinearGradient>
      </Defs>
      {/* Cuerpo con lomo central */}
      <Path d="M18 58 L36 40 L124 40 L142 58 Z" fill="url(#n64-top)" />
      <Path d="M18 58 L142 58 L138 80 L22 80 Z" fill="url(#n64-front)" />
      <Path d="M18 58 L142 58" stroke="#9CA3AF" strokeOpacity="0.6" strokeWidth="0.7" />
      <Path d="M58 40 L102 40 L108 58 L52 58 Z" fill="#374151" />
      {/* Cartucho */}
      <Path d="M62 14 L98 14 L100 46 L60 46 Z" fill="url(#n64-cart)" stroke="#374151" strokeWidth="0.6" />
      <Rect x="66" y="18" width="28" height="18" rx="1.5" fill="url(#n64-label)" />
      <Path d="M70 32 L76 22 L80 30 L84 24 L90 32 Z" fill="#FDE68A" fillOpacity="0.85" />
      <Path d="M62 14 L98 14" stroke="#F3F4F6" strokeWidth="0.8" />
      {/* Interruptores */}
      <Rect x="40" y="50" width="10" height="4" rx="1.5" fill="#6B7280" />
      <Rect x="110" y="50" width="10" height="4" rx="1.5" fill="#6B7280" />
      {/* Puertos de mando */}
      {[40, 62, 84, 106].map((x) => (
        <Rect key={x} x={x} y="66" width="14" height="7" rx="2" fill="#0B0F14" stroke="#4B5563" strokeWidth="0.5" />
      ))}
      {/* Logo de colores */}
      <Rect x="74" y="60" width="3" height="3" fill="#EF4444" />
      <Rect x="77" y="60" width="3" height="3" fill="#22C55E" />
      <Rect x="80" y="60" width="3" height="3" fill="#3B82F6" />
      <Rect x="83" y="60" width="3" height="3" fill="#FACC15" />
    </>
  );
}

// ---- Game Boy Advance: portátil índigo con pantalla encendida -------------------------
function Gba() {
  return (
    <>
      <Stage id="gba" color={ART_GLOW.gba} />
      <Defs>
        <LinearGradient id="gba-body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#818CF8" />
          <Stop offset="0.55" stopColor="#4F46E5" />
          <Stop offset="1" stopColor="#312E81" />
        </LinearGradient>
        <LinearGradient id="gba-scr" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#BEF264" />
          <Stop offset="0.5" stopColor="#22C55E" />
          <Stop offset="1" stopColor="#14532D" />
        </LinearGradient>
      </Defs>
      {/* Gatillos */}
      <Path d="M20 34 Q24 24 42 24 L52 24 L52 32 Z" fill="#3730A3" />
      <Path d="M140 34 Q136 24 118 24 L108 24 L108 32 Z" fill="#3730A3" />
      {/* Cuerpo */}
      <Path
        d="M14 46 Q14 30 34 30 L126 30 Q146 30 146 46 L146 72 Q146 92 120 92 L40 92 Q14 92 14 72 Z"
        fill="url(#gba-body)"
        stroke="#312E81"
        strokeWidth="0.8"
      />
      <Path d="M20 40 Q24 33 36 33 L124 33" stroke="#E0E7FF" strokeOpacity="0.6" strokeWidth="1" fill="none" />
      {/* Pantalla */}
      <Rect x="48" y="36" width="64" height="44" rx="4" fill="#1E1B4B" />
      <Rect x="54" y="41" width="52" height="34" rx="1.5" fill="url(#gba-scr)" />
      <Path d="M54 41 L74 41 L58 75 L54 75 Z" fill="#FFF" fillOpacity="0.18" />
      {/* Cruceta */}
      <Path d="M26 58 L31 58 L31 53 L35 53 L35 58 L40 58 L40 62 L35 62 L35 67 L31 67 L31 62 L26 62 Z" fill="#1E1B4B" />
      {/* A y B */}
      <Circle cx="128" cy="56" r="4" fill="#1E1B4B" />
      <Circle cx="120" cy="64" r="4" fill="#1E1B4B" />
      <Circle cx="127" cy="55" r="1.3" fill="#FFF" fillOpacity="0.35" />
      <Circle cx="119" cy="63" r="1.3" fill="#FFF" fillOpacity="0.35" />
      <Rect x="66" y="84" width="8" height="2.4" rx="1.2" fill="#312E81" />
      <Rect x="86" y="84" width="8" height="2.4" rx="1.2" fill="#312E81" />
    </>
  );
}

// ---- PSP: portátil negra panorámica --------------------------------------------------
function Psp() {
  return (
    <>
      <Stage id="psp" color={ART_GLOW.psp} />
      <Defs>
        <LinearGradient id="psp-body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3F3F46" />
          <Stop offset="0.5" stopColor="#18181B" />
          <Stop offset="1" stopColor="#050505" />
        </LinearGradient>
        <LinearGradient id="psp-scr" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#67E8F9" />
          <Stop offset="0.45" stopColor="#2563EB" />
          <Stop offset="1" stopColor="#1E1B4B" />
        </LinearGradient>
        <LinearGradient id="psp-chrome" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#6B7280" />
          <Stop offset="0.5" stopColor="#F3F4F6" />
          <Stop offset="1" stopColor="#6B7280" />
        </LinearGradient>
      </Defs>
      <Path
        d="M6 56 Q6 34 30 34 L130 34 Q154 34 154 56 Q154 80 130 80 L30 80 Q6 80 6 56 Z"
        fill="url(#psp-body)"
        stroke="url(#psp-chrome)"
        strokeWidth="1.2"
      />
      <Path d="M14 46 Q18 37 32 37 L128 37" stroke="#FFF" strokeOpacity="0.4" strokeWidth="1" fill="none" />
      {/* Pantalla 16:9 */}
      <Rect x="40" y="40" width="80" height="34" rx="2" fill="#020617" />
      <Rect x="42" y="42" width="76" height="30" rx="1" fill="url(#psp-scr)" />
      <Path d="M42 42 L70 42 L50 72 L42 72 Z" fill="#FFF" fillOpacity="0.15" />
      {/* Cruceta y nub */}
      <Path d="M18 50 L22 50 L22 46 L25 46 L25 50 L29 50 L29 53 L25 53 L25 57 L22 57 L22 53 L18 53 Z" fill="#52525B" />
      <Circle cx="23" cy="67" r="4.2" fill="#27272A" stroke="#71717A" strokeWidth="0.7" />
      <Circle cx="22.2" cy="66.2" r="1.4" fill="#A1A1AA" fillOpacity="0.6" />
      {/* Botones de acción */}
      <Circle cx="137" cy="47" r="2.3" fill="none" stroke="#4ADE80" strokeWidth="1" />
      <Circle cx="142" cy="52" r="2.3" fill="none" stroke="#F87171" strokeWidth="1" />
      <Circle cx="137" cy="57" r="2.3" fill="none" stroke="#60A5FA" strokeWidth="1" />
      <Circle cx="132" cy="52" r="2.3" fill="none" stroke="#F0ABFC" strokeWidth="1" />
      <Rect x="128" y="66" width="18" height="2" rx="1" fill="#52525B" />
      <SvgText x="80" y="79" fontSize="3.6" fill="#A1A1AA" textAnchor="middle" letterSpacing="1.6">
        PSP
      </SvgText>
    </>
  );
}

// ---- Mega Drive: consola negra con anillo 16-BIT y mando de 3 botones -----------------
function Sega() {
  return (
    <>
      <Stage id="sega" color={ART_GLOW.sega} />
      <Defs>
        <LinearGradient id="sega-top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3F3F46" />
          <Stop offset="1" stopColor="#0C0C0E" />
        </LinearGradient>
        <RadialGradient id="sega-ring" cx="45%" cy="40%" rx="60%" ry="60%">
          <Stop offset="0" stopColor="#27272A" />
          <Stop offset="1" stopColor="#050506" />
        </RadialGradient>
      </Defs>
      <Path d="M10 56 Q10 36 34 34 L104 34 Q122 36 122 56 L122 70 L10 70 Z" fill="url(#sega-top)" />
      <Path d="M10 70 L122 70 L120 78 L12 78 Z" fill="#050506" />
      <Ellipse cx="66" cy="50" rx="30" ry="12" fill="url(#sega-ring)" stroke="#52525B" strokeWidth="0.8" />
      <Ellipse cx="66" cy="50" rx="22" ry="8" fill="none" stroke="#3F3F46" strokeWidth="0.6" />
      <Rect x="50" y="46" width="32" height="6" rx="1" fill="#09090B" />
      <SvgText x="66" y="64" fontSize="4.6" fontWeight="800" fill="#EF4444" textAnchor="middle" letterSpacing="1">
        16-BIT
      </SvgText>
      <Path d="M18 44 Q24 37 38 36 L100 36" stroke="#FFF" strokeOpacity="0.35" strokeWidth="0.9" fill="none" />
      <Rect x="96" y="58" width="16" height="3" rx="1.5" fill="#EF4444" fillOpacity="0.85" />
      {/* Mando de 3 botones */}
      <G transform="translate(100 70)">
        <Path
          d="M2 12 Q2 2 16 2 L40 2 Q54 2 54 12 Q54 26 40 26 Q34 26 30 20 L26 20 Q22 26 16 26 Q2 26 2 12 Z"
          fill="url(#sega-top)"
          stroke="#52525B"
          strokeWidth="0.6"
        />
        <Circle cx="15" cy="12" r="5.4" fill="#18181B" />
        <Path d="M12 12 L18 12 M15 9 L15 15" stroke="#71717A" strokeWidth="1.8" />
        <Circle cx="36" cy="14" r="2.5" fill="#52525B" />
        <Circle cx="42" cy="11.5" r="2.5" fill="#52525B" />
        <Circle cx="48" cy="9" r="2.5" fill="#52525B" />
        <Rect x="24" y="7" width="6" height="2" rx="1" fill="#3F3F46" />
      </G>
    </>
  );
}

// ---- Super Nintendo: consola gris claro con botones morados y mando de cuatro colores ----
function Snes() {
  return (
    <>
      <Stage id="snes" color={ART_GLOW.snes} />
      <Defs>
        <LinearGradient id="snes-top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ECEDF1" />
          <Stop offset="1" stopColor="#B8BAC4" />
        </LinearGradient>
        <LinearGradient id="snes-front" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A6A8B3" />
          <Stop offset="1" stopColor="#787B87" />
        </LinearGradient>
        <LinearGradient id="snes-purple" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A78BFA" />
          <Stop offset="1" stopColor="#5B21B6" />
        </LinearGradient>
      </Defs>
      <Path d="M12 50 Q12 34 28 34 L98 34 Q114 34 114 50 L114 66 L12 66 Z" fill="url(#snes-top)" />
      <Path d="M12 66 L114 66 L112 76 L14 76 Z" fill="url(#snes-front)" />
      <Rect x="38" y="38" width="50" height="14" rx="3" fill="#6B6E7A" />
      <Rect x="42" y="41" width="42" height="8" rx="1.5" fill="#2E2F36" />
      <Rect x="20" y="56" width="12" height="5" rx="2.5" fill="url(#snes-purple)" />
      <Rect x="94" y="56" width="12" height="5" rx="2.5" fill="url(#snes-purple)" />
      <Path d="M18 42 Q22 36 32 36 L96 36" stroke="#FFF" strokeOpacity="0.55" strokeWidth="0.9" fill="none" />
      <G transform="translate(96 70)">
        <Path d="M12 2 L46 2 Q58 2 58 14 Q58 26 46 26 L12 26 Q0 26 0 14 Q0 2 12 2 Z" fill="url(#snes-top)" stroke="#9CA0AB" strokeWidth="0.6" />
        <Path d="M8 14 L16 14 M12 10 L12 18" stroke="#3F3F46" strokeWidth="2.2" />
        <Circle cx="46" cy="8.5" r="2.6" fill="#3B82F6" />
        <Circle cx="40.5" cy="14" r="2.6" fill="#22C55E" />
        <Circle cx="51.5" cy="14" r="2.6" fill="#EF4444" />
        <Circle cx="46" cy="19.5" r="2.6" fill="#FACC15" />
        <Rect x="22" y="15" width="5" height="2" rx="1" fill="#6B6E7A" />
        <Rect x="29" y="15" width="5" height="2" rx="1" fill="#6B6E7A" />
      </G>
    </>
  );
}

// ---- NES: caja gris de carga frontal con franja negra y mando rectangular ------------
function Nes() {
  return (
    <>
      <Stage id="nes" color={ART_GLOW.nes} />
      <Defs>
        <LinearGradient id="nes-top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E5E5E5" />
          <Stop offset="1" stopColor="#BDBDBD" />
        </LinearGradient>
        <LinearGradient id="nes-front" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A3A3A3" />
          <Stop offset="1" stopColor="#737373" />
        </LinearGradient>
      </Defs>
      <Path d="M14 44 L28 34 L118 34 L106 44 Z" fill="url(#nes-top)" />
      <Path d="M14 44 L106 44 L106 76 L14 76 Z" fill="url(#nes-front)" />
      <Path d="M106 44 L118 34 L118 66 L106 76 Z" fill="#8A8A8A" />
      <Rect x="14" y="44" width="92" height="12" fill="#262626" />
      <Rect x="30" y="47" width="60" height="6" rx="1" fill="#0A0A0A" />
      <Rect x="20" y="64" width="9" height="3" rx="1" fill="#DC2626" />
      <Rect x="33" y="64" width="9" height="3" rx="1" fill="#404040" />
      <Path d="M28 35 L117 35" stroke="#FFF" strokeOpacity="0.5" strokeWidth="0.8" />
      <G transform="translate(94 74)">
        <Rect x="0" y="0" width="56" height="22" rx="2" fill="#D4D4D4" stroke="#737373" strokeWidth="0.6" />
        <Rect x="4" y="4" width="48" height="14" rx="1" fill="#171717" />
        <Path d="M9 11 L17 11 M13 7 L13 15" stroke="#525252" strokeWidth="2.4" />
        <Rect x="22" y="11" width="5" height="2" rx="1" fill="#737373" />
        <Rect x="29" y="11" width="5" height="2" rx="1" fill="#737373" />
        <Circle cx="40" cy="12" r="2.8" fill="#DC2626" />
        <Circle cx="47" cy="12" r="2.8" fill="#DC2626" />
      </G>
    </>
  );
}

// ---- Game Boy (gris, pantalla verde) y Game Boy Color (carcasa de color, pantalla a color) ----
function GameBoy({ color }: { color: boolean }) {
  const id = color ? 'gbc' : 'gb';
  return (
    <>
      <Stage id={id} color={ART_GLOW[id]} />
      <Defs>
        <LinearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color ? '#FDE047' : '#E7E5E4'} />
          <Stop offset="1" stopColor={color ? '#CA8A04' : '#A8A29E'} />
        </LinearGradient>
        <LinearGradient id={`${id}-scr`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color ? '#F472B6' : '#BEF264'} />
          <Stop offset="0.5" stopColor={color ? '#38BDF8' : '#84CC16'} />
          <Stop offset="1" stopColor={color ? '#4ADE80' : '#3F6212'} />
        </LinearGradient>
      </Defs>
      <Path d="M56 8 L104 8 Q108 8 108 12 L108 88 Q108 100 96 100 L56 100 Q52 100 52 96 L52 12 Q52 8 56 8 Z" fill={`url(#${id}-body)`} />
      <Path d="M55 11 L105 11" stroke="#FFF" strokeOpacity="0.55" strokeWidth="0.9" />
      <Rect x="58" y="15" width="44" height="36" rx="3" fill={color ? '#1F2937' : '#57534E'} />
      <Rect x="64" y="20" width="32" height="26" rx="1" fill={`url(#${id}-scr)`} />
      <Path d="M64 20 L78 20 L68 46 L64 46 Z" fill="#FFF" fillOpacity="0.15" />
      <Circle cx="61" cy="30" r="1.2" fill="#EF4444" />
      <Path d="M60 68 L70 68 M65 63 L65 73" stroke="#1C1917" strokeWidth="3" />
      <Circle cx="92" cy="70" r="3.6" fill={color ? '#7C3AED' : '#9D174D'} />
      <Circle cx="100" cy="65" r="3.6" fill={color ? '#7C3AED' : '#9D174D'} />
      <Rect x="70" y="82" width="7" height="2" rx="1" transform="rotate(-25 73 83)" fill="#57534E" />
      <Rect x="80" y="82" width="7" height="2" rx="1" transform="rotate(-25 83 83)" fill="#57534E" />
      <Path d="M92 90 L100 86 M93 93 L101 89 M94 96 L102 92" stroke="#57534E" strokeWidth="0.9" />
    </>
  );
}

// ---- Dreamcast: consola blanca con tapa redonda, espiral naranja y mando con VMU ---------
function Dreamcast() {
  return (
    <>
      <Stage id="dc" color={ART_GLOW.dreamcast} />
      <Defs>
        <LinearGradient id="dc-body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F8FAFC" />
          <Stop offset="1" stopColor="#CBD5E1" />
        </LinearGradient>
        <RadialGradient id="dc-lid" cx="45%" cy="40%" rx="60%" ry="60%">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#D6DBE3" />
        </RadialGradient>
      </Defs>
      <Path d="M14 50 L30 36 L112 36 L104 50 Z" fill="url(#dc-body)" />
      <Path d="M14 50 L104 50 L104 74 L14 74 Z" fill="#B8C1CE" />
      <Path d="M104 50 L112 36 L112 62 L104 74 Z" fill="#9AA5B4" />
      <Ellipse cx="64" cy="43" rx="30" ry="6" fill="url(#dc-lid)" stroke="#94A3B8" strokeWidth="0.5" />
      <Path d="M58 41 a5 3 0 1 0 9 1.6 c0 -1.6 -1.6 -2.6 -3.4 -2.6 -1.4 0 -2.6 0.9 -2.6 2" stroke="#F97316" strokeWidth="1.3" fill="none" />
      <Circle cx="24" cy="66" r="2" fill="#F97316" />
      <Rect x="34" y="64" width="22" height="4" rx="2" fill="#94A3B8" />
      <G transform="translate(102 66)">
        <Path d="M6 4 Q4 2 10 2 L40 2 Q46 2 44 4 L46 22 Q46 30 38 28 L30 20 L20 20 L12 28 Q4 30 4 22 Z" fill="url(#dc-body)" stroke="#94A3B8" strokeWidth="0.6" />
        <Rect x="18" y="4" width="14" height="10" rx="1.5" fill="#334155" />
        <Rect x="20" y="6" width="10" height="6" rx="0.8" fill="#86EFAC" />
        <Circle cx="12" cy="11" r="3.2" fill="#94A3B8" />
        <Circle cx="38" cy="9" r="1.6" fill="#22C55E" />
        <Circle cx="41" cy="12" r="1.6" fill="#3B82F6" />
        <Circle cx="35" cy="12" r="1.6" fill="#FACC15" />
        <Circle cx="38" cy="15" r="1.6" fill="#EF4444" />
      </G>
    </>
  );
}

// ---- Ports: PC clásico (monitor CRT con un pasillo 3D y mira) y teclado -------------------
function Ports() {
  return (
    <>
      <Stage id="ports" color={ART_GLOW.ports} />
      <Defs>
        <LinearGradient id="ports-case" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E7E2D3" />
          <Stop offset="1" stopColor="#B5AE98" />
        </LinearGradient>
        <LinearGradient id="ports-scr" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7C2D12" />
          <Stop offset="0.55" stopColor="#B45309" />
          <Stop offset="1" stopColor="#1C1917" />
        </LinearGradient>
      </Defs>
      <Rect x="42" y="12" width="76" height="62" rx="6" fill="url(#ports-case)" />
      <Rect x="49" y="18" width="62" height="46" rx="4" fill="#0C0A09" />
      <Rect x="52" y="21" width="56" height="40" rx="2" fill="url(#ports-scr)" />
      {/* Pasillo en perspectiva */}
      <Path d="M52 21 L70 35 L90 35 L108 21 M52 61 L70 47 L90 47 L108 61 M70 35 L70 47 M90 35 L90 47" stroke="#FDBA74" strokeOpacity="0.55" strokeWidth="0.8" fill="none" />
      <Circle cx="80" cy="41" r="4" stroke="#FEF3C7" strokeWidth="0.9" fill="none" />
      <Path d="M80 34.5 L80 37 M80 45 L80 47.5 M73.5 41 L76 41 M84 41 L86.5 41" stroke="#FEF3C7" strokeWidth="0.9" />
      <Path d="M52 21 L66 21 L56 61 L52 61 Z" fill="#FFF" fillOpacity="0.08" />
      <Circle cx="110" cy="69" r="1.4" fill="#22C55E" />
      <Path d="M70 74 L66 82 L94 82 L90 74 Z" fill="#A8A08A" />
      <Path d="M28 86 L132 86 L138 96 L22 96 Z" fill="url(#ports-case)" />
      <Path d="M32 89 L128 89 M30 92 L130 92" stroke="#8A8371" strokeWidth="1.2" strokeDasharray="3 1.4" />
    </>
  );
}

export function ConsoleArt({ kind, width, height }: { kind: ArtKind; width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 160 110">
      {kind === 'ps1' ? <Ps1 /> : null}
      {kind === 'nds' ? <Nds /> : null}
      {kind === 'saturn' ? <Saturn /> : null}
      {kind === 'fbneo' ? <Cabinet id="fbn" label="FBNEO" color={ART_GLOW.fbneo} accent="#F97316" /> : null}
      {kind === 'mame' ? <Cabinet id="mame" label="ARCADE" color={ART_GLOW.mame} accent="#EF4444" /> : null}
      {kind === 'n64' ? <N64 /> : null}
      {kind === 'gba' ? <Gba /> : null}
      {kind === 'psp' ? <Psp /> : null}
      {kind === 'sega' ? <Sega /> : null}
      {kind === 'snes' ? <Snes /> : null}
      {kind === 'nes' ? <Nes /> : null}
      {kind === 'gb' ? <GameBoy color={false} /> : null}
      {kind === 'gbc' ? <GameBoy color /> : null}
      {kind === 'ports' ? <Ports /> : null}
      {kind === 'dreamcast' ? <Dreamcast /> : null}
    </Svg>
  );
}
