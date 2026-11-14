import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconKind = 'all' | 'gba' | 'n64' | 'sega' | 'mame' | 'ps1';

// Siluetas vectoriales minimalistas (trazo fino, viewBox 24x24)
export function ConsoleIcon({ kind, size = 18, color }: { kind: IconKind; size?: number; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'all' ? (
        <>
          <Rect x={3.5} y={3.5} width={7} height={7} rx={1.6} {...stroke} />
          <Rect x={13.5} y={3.5} width={7} height={7} rx={1.6} {...stroke} />
          <Rect x={3.5} y={13.5} width={7} height={7} rx={1.6} {...stroke} />
          <Rect x={13.5} y={13.5} width={7} height={7} rx={1.6} {...stroke} />
        </>
      ) : null}
      {kind === 'gba' ? (
        // Portátil horizontal: cuerpo con alas, pantalla, cruceta y dos botones
        <>
          <Path d="M5 7h14c1.7 0 3 1.6 3 3.6v2.8C22 15.4 20.7 17 19 17H5c-1.7 0-3-1.6-3-3.6v-2.8C2 8.6 3.3 7 5 7z" {...stroke} />
          <Rect x={8} y={9} width={8} height={6} rx={0.8} {...stroke} />
          <Path d="M4.6 12h2M5.6 11v2" {...stroke} />
          <Circle cx={18.2} cy={11.2} r={0.7} fill={color} />
          <Circle cx={19.6} cy={12.8} r={0.7} fill={color} />
        </>
      ) : null}
      {kind === 'n64' ? (
        // Mando de tres empuñaduras
        <>
          <Path d="M4 8.5C4 7.1 5.1 6 6.5 6h11C18.9 6 20 7.1 20 8.5c0 1.4-.6 2.6-1.5 3.3L17.2 18c-.2.9-1.6.9-1.8 0l-1-4.3h-4.8l-1 4.3c-.2.9-1.6.9-1.8 0L5.5 11.8C4.6 11.1 4 9.9 4 8.5z" {...stroke} />
          <Path d="M12 11.5v4.5" {...stroke} />
          <Circle cx={12} cy={10.2} r={1.1} {...stroke} />
          <Path d="M6.8 9h2M7.8 8v2" {...stroke} />
          <Circle cx={16.6} cy={9} r={0.7} fill={color} />
        </>
      ) : null}
      {kind === 'sega' ? (
        // Mando de seis botones con forma de media luna
        <>
          <Path d="M3 11c0-2.2 1.8-4 4-4h10c2.2 0 4 1.8 4 4 0 2.8-1.7 6-4.3 6-1.7 0-2.3-1.6-4.7-1.6S9 17 7.3 17C4.7 17 3 13.8 3 11z" {...stroke} />
          <Path d="M6 11h2.6M7.3 9.7v2.6" {...stroke} />
          <Circle cx={14.6} cy={12} r={0.75} fill={color} />
          <Circle cx={16.6} cy={11.2} r={0.75} fill={color} />
          <Circle cx={18.4} cy={10.4} r={0.75} fill={color} />
        </>
      ) : null}
      {kind === 'mame' ? (
        // Mueble arcade: marquesina, pantalla y panel de control con palanca
        <>
          <Path d="M7 3h10v4.5l1.5 3.5V21H5.5V11L7 7.5z" {...stroke} />
          <Path d="M7 7.5h10" {...stroke} />
          <Rect x={8.2} y={9} width={7.6} height={4.6} rx={0.6} {...stroke} />
          <Path d="M5.5 16h13" {...stroke} />
          <Path d="M9 16v-1.6" {...stroke} />
          <Circle cx={9} cy={14} r={0.8} fill={color} />
          <Circle cx={14} cy={15} r={0.6} fill={color} />
          <Circle cx={15.8} cy={15} r={0.6} fill={color} />
        </>
      ) : null}
      {kind === 'ps1' ? (
        // Disco óptico
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Circle cx={12} cy={12} r={2.4} {...stroke} />
          <Path d="M12 5.8a6.2 6.2 0 0 1 5.6 3.6" {...stroke} />
        </>
      ) : null}
    </Svg>
  );
}
