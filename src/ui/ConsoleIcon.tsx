import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconKind =
  | 'all'
  | 'gba'
  | 'n64'
  | 'sega'
  | 'mame'
  | 'fbneo'
  | 'ps1'
  | 'psp'
  | 'nds'
  | 'saturn'
  | 'snes'
  | 'nes'
  | 'gb'
  | 'gbc'
  | 'ports'
  | 'dreamcast'
  | 'n3ds'
  | 'ps2';

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
      {kind === 'nds' || kind === 'n3ds' ? (
        // Portátil de doble pantalla abierta
        <>
          <Rect x={5} y={2.5} width={14} height={8.5} rx={1.6} {...stroke} />
          <Rect x={7.5} y={4.3} width={9} height={5} rx={0.5} {...stroke} />
          <Rect x={5} y={12.5} width={14} height={9} rx={1.6} {...stroke} />
          <Rect x={8.5} y={14.3} width={7} height={5.2} rx={0.5} {...stroke} />
          <Circle cx={6.9} cy={17} r={0.5} fill={color} />
          <Circle cx={17.1} cy={17} r={0.5} fill={color} />
        </>
      ) : null}
      {kind === 'psp' ? (
        // Portátil panorámica: pantalla ancha, cruceta y botones a los lados
        <>
          <Rect x={1.8} y={7} width={20.4} height={10} rx={5} {...stroke} />
          <Rect x={7} y={8.8} width={10} height={6.4} rx={0.6} {...stroke} />
          <Path d="M3.6 12h1.8M4.5 11.1v1.8" {...stroke} />
          <Circle cx={19.6} cy={11.2} r={0.6} fill={color} />
          <Circle cx={19.6} cy={12.8} r={0.6} fill={color} />
        </>
      ) : null}
      {kind === 'saturn' ? (
        // Planeta con anillo
        <>
          <Circle cx={12} cy={12} r={5.2} {...stroke} />
          <Path d="M3.2 15.5c-1-1.6 2.6-4.4 8-6.2s10.4-2 11.4-.4-2.6 4.4-8 6.2-10.4 2-11.4.4z" {...stroke} />
        </>
      ) : null}
      {kind === 'fbneo' ? (
        // Panel arcade: palanca con bola y seis botones
        <>
          <Rect x={2.5} y={11} width={19} height={8.5} rx={1.8} {...stroke} />
          <Path d="M6.5 15.5V8.5" {...stroke} />
          <Circle cx={6.5} cy={7} r={2} {...stroke} />
          <Circle cx={12.5} cy={14} r={0.9} fill={color} />
          <Circle cx={15.5} cy={13.4} r={0.9} fill={color} />
          <Circle cx={18.5} cy={12.8} r={0.9} fill={color} />
          <Circle cx={12.5} cy={17} r={0.9} fill={color} />
          <Circle cx={15.5} cy={16.4} r={0.9} fill={color} />
          <Circle cx={18.5} cy={15.8} r={0.9} fill={color} />
        </>
      ) : null}
      {kind === 'snes' ? (
        // Mando de Super Nintendo: hueso redondeado, cruceta y rombo de cuatro botones
        <>
          <Path d="M7.5 7h9a5 5 0 0 1 0 10h-9a5 5 0 0 1 0-10z" {...stroke} />
          <Path d="M5.6 12h3.4M7.3 10.3v3.4" {...stroke} />
          <Circle cx={16.6} cy={9.9} r={0.8} fill={color} />
          <Circle cx={14.7} cy={12} r={0.8} fill={color} />
          <Circle cx={18.5} cy={12} r={0.8} fill={color} />
          <Circle cx={16.6} cy={14.1} r={0.8} fill={color} />
          <Path d="M10.8 13.6l1-.6M12.6 13.6l1-.6" {...stroke} />
        </>
      ) : null}
      {kind === 'nes' ? (
        // Mando rectangular de NES: cruceta, SELECT/START y dos botones redondos
        <>
          <Rect x={2.5} y={7.5} width={19} height={9} rx={1.4} {...stroke} />
          <Path d="M4.8 12h3.4M6.5 10.3v3.4" {...stroke} />
          <Path d="M10.2 12.8h1.4M12.4 12.8h1.4" {...stroke} />
          <Circle cx={16.4} cy={12.4} r={1.1} fill={color} />
          <Circle cx={19.2} cy={12.4} r={1.1} fill={color} />
        </>
      ) : null}
      {kind === 'gb' || kind === 'gbc' ? (
        // Portátil vertical clásica: pantalla, cruceta, A/B y esquina inferior redondeada
        <>
          <Path d="M6 2.5h12a1.5 1.5 0 0 1 1.5 1.5v14c0 2.2-1.8 3.5-4 3.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5z" {...stroke} />
          <Rect x={7} y={5} width={10} height={6.6} rx={0.8} {...stroke} />
          <Path d="M7.2 16h2.8M8.6 14.6v2.8" {...stroke} />
          <Circle cx={14.4} cy={16.6} r={0.85} fill={color} />
          <Circle cx={16.4} cy={15.2} r={0.85} fill={color} />
          {kind === 'gbc' ? <Path d="M9 8.3h6" {...stroke} /> : null}
        </>
      ) : null}
      {kind === 'dreamcast' ? (
        // Espiral de Dreamcast
        <>
          <Path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5c0-3.2-2.6-5.6-5.7-5.6-2.8 0-5 2.2-5 4.9 0 2.3 1.8 4 4 4 1.8 0 3.2-1.4 3.2-3.1" {...stroke} />
        </>
      ) : null}
      {kind === 'ports' ? (
        // PC clásico: monitor CRT con mira de shooter y teclado
        <>
          <Rect x={3} y={3} width={18} height={12.5} rx={1.8} {...stroke} />
          <Circle cx={12} cy={9.2} r={2.6} {...stroke} />
          <Path d="M12 5.4v1.6M12 11.4v1.6M8.2 9.2h1.6M14.2 9.2h1.6" {...stroke} />
          <Path d="M9 15.5l-.8 2.5h7.6l-.8-2.5" {...stroke} />
          <Rect x={4} y={19} width={16} height={2.4} rx={0.8} {...stroke} />
        </>
      ) : null}
      {kind === 'ps1' || kind === 'ps2' ? (
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
