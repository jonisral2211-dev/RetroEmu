import React, { memo, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { subscribeCover, subscribeHero } from '../../covers/CoverCache';
import { CONSOLE_LABEL, Console } from '../../emulator/cores';
import type { Entry } from '../../library/useLibrary';
import { ART_GLOW, ArtKind, ConsoleArt } from '../../ui/ConsoleArt';
import { ConsoleIcon } from '../../ui/ConsoleIcon';

// Paleta "Gaming Mode": azul noche, paneles pizarra, foco blanco con halo azul y botón verde
export const S = {
  bg: '#0B1016',
  bg2: '#121922',
  panel: '#1A2330',
  panelHi: '#233042',
  line: '#2C3A4D',
  text: '#E8EDF2',
  dim: '#93A0B0',
  faint: '#5C6878',
  blue: '#1A9FFF',
  focus: '#FFFFFF',
  green1: '#7BD83F',
  green2: '#3C9A1B',
  gold: '#FFC83D',
  cross: '#8AB8FF',
  circle: '#FF7A7A',
  triangle: '#5EE0B1',
  square: '#EE93D8',
} as const;

/** Carátula + captura panorámica de un juego (caché local; null si no hay o sin red). */
export function useArt(entry: Entry | undefined, wantHero: boolean): { box: string | null; hero: string | null } {
  const [box, setBox] = useState<string | null>(null);
  const [hero, setHero] = useState<string | null>(null);
  useEffect(() => {
    setBox(null);
    setHero(null);
    if (!entry) return;
    let alive = true;
    const a = subscribeCover(entry.path, entry.console, (u) => alive && setBox(u));
    const b = wantHero ? subscribeHero(entry.path, entry.console, (u) => alive && setHero(u)) : () => {};
    return () => {
      alive = false;
      a();
      b();
    };
  }, [entry?.path, entry?.console, wantHero]); // eslint-disable-line react-hooks/exhaustive-deps
  return { box, hero };
}

function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

/**
 * Arte generativo sin conexión: degradado por título con el color de la consola, su ilustración
 * de fondo y el título en grande. Cada juego tiene siempre el mismo.
 */
export const GeneratedArt = memo(function GeneratedArt({
  entry,
  title,
  width,
  height,
}: {
  entry: Entry;
  title: string;
  width: number;
  height: number;
}) {
  const hue = hashHue(title);
  const glow = ART_GLOW[entry.console as ArtKind] ?? S.blue;
  const id = `ga${hue}${Math.round(width)}`;
  const known = entry.console in ART_GLOW;
  const fontSize = Math.max(12, Math.min(width / 9, height / 4.2));
  const words = title.split(' ');
  const lines: string[] = [];
  const perLine = Math.max(8, Math.floor(width / (fontSize * 0.58)));
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= perLine) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const shown = lines.slice(0, 3);
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={`hsl(${hue}, 45%, 26%)`} />
            <Stop offset="0.55" stopColor={`hsl(${(hue + 40) % 360}, 40%, 13%)`} />
            <Stop offset="1" stopColor="#070A0E" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill={`url(#${id})`} />
        <Circle cx={width * 0.85} cy={height * 0.15} r={Math.max(width, height) * 0.5} fill={glow} opacity={0.12} />
        {shown.map((line, i) => (
          <SvgText
            key={i}
            x={width * 0.08}
            y={height * 0.86 - (shown.length - 1 - i) * fontSize * 1.08}
            fill="#FFFFFF"
            fontSize={fontSize}
            fontWeight="800"
            opacity={0.94}>
            {line}
          </SvgText>
        ))}
      </Svg>
      {known ? (
        <View style={[styles.genArt, { opacity: 0.32 }]} pointerEvents="none">
          <ConsoleArt kind={entry.console as ArtKind} width={width * 0.6} height={height * 0.5} />
        </View>
      ) : null}
    </View>
  );
});

/** Etiqueta de consola (icono + nombre corto). */
export function ConsoleChip({ console, small }: { console: string; small?: boolean }) {
  if (!(console in CONSOLE_LABEL)) return null;
  return (
    <View style={[styles.chip, small && styles.chipSmall]}>
      <ConsoleIcon kind={console as Console} size={small ? 10 : 12} color={S.text} />
      <Text style={[styles.chipText, small && styles.chipTextSmall]}>{CONSOLE_LABEL[console as Console]}</Text>
    </View>
  );
}

/** Imagen de un juego: captura panorámica, carátula, o arte generativo. */
function GameImage({
  entry,
  title,
  width,
  height,
  wide,
  box,
  hero,
}: {
  entry: Entry;
  title: string;
  width: number;
  height: number;
  wide: boolean;
  box: string | null;
  hero: string | null;
}) {
  if (wide && hero) return <Image source={{ uri: hero }} style={StyleSheet.absoluteFill} resizeMode="cover" />;
  if (box) {
    return (
      <>
        <Image source={{ uri: box }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={wide ? 18 : 14} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,12,18,0.35)' }]} />
        <Image source={{ uri: box }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      </>
    );
  }
  return <GeneratedArt entry={entry} title={title} width={width} height={height} />;
}

/** Tarjeta de juego: panorámica (16:9, carruseles) o carátula (2:3, cuadrícula). */
export const GameTile = memo(function GameTile({
  entry,
  title,
  variant,
  width,
  focused,
  favorite,
  onPress,
}: {
  entry: Entry;
  title: string;
  variant: 'wide' | 'box';
  width: number;
  focused: boolean;
  favorite: boolean;
  onPress: () => void;
}) {
  const wide = variant === 'wide';
  const height = wide ? (width * 9) / 16 : width * 1.4;
  const { box, hero } = useArt(entry, wide);
  return (
    <Pressable onPress={onPress} style={{ width }}>
      <View style={[styles.tile, { width, height }, focused && styles.tileFocused]}>
        <GameImage entry={entry} title={title} width={width} height={height} wide={wide} box={box} hero={hero} />
        {wide ? (
          <View style={styles.tileShade} pointerEvents="none">
            <Text style={styles.tileTitle} numberOfLines={1}>
              {title}
            </Text>
          </View>
        ) : null}
        <View style={styles.tileBadges} pointerEvents="none">
          <ConsoleChip console={entry.console} small />
          {favorite ? <Text style={styles.star}>★</Text> : null}
        </View>
      </View>
      {!wide ? (
        <Text style={[styles.caption, focused && styles.captionFocused]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
    </Pressable>
  );
});

/** Banner principal del juego enfocado (captura panorámica a sangre con degradado). */
export function HeroBanner({
  entry,
  title,
  subtitle,
  width,
  height,
  favorite,
}: {
  entry: Entry | undefined;
  title: string;
  subtitle: string;
  width: number;
  height: number;
  favorite: boolean;
}) {
  const { box, hero } = useArt(entry, true);
  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: S.bg2 }}>
      {entry ? (
        hero ? (
          <Image source={{ uri: hero }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : box ? (
          <Image source={{ uri: box }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={24} />
        ) : (
          <GeneratedArt entry={entry} title="" width={width} height={height} />
        )
      ) : null}
      <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
        <Defs>
          <LinearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={S.bg} stopOpacity="0.15" />
            <Stop offset="0.55" stopColor={S.bg} stopOpacity="0.35" />
            <Stop offset="1" stopColor={S.bg} stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="heroSide" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={S.bg} stopOpacity="0.85" />
            <Stop offset="0.6" stopColor={S.bg} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#heroFade)" />
        <Rect x="0" y="0" width={width} height={height} fill="url(#heroSide)" />
      </Svg>
      {entry ? (
        <View style={styles.heroInfo} pointerEvents="none">
          {box ? (
            <View style={[styles.heroBox, { height: height * 0.62, width: height * 0.62 * 0.72 }]}>
              <Image source={{ uri: box }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            </View>
          ) : null}
          <View style={styles.heroText}>
            <ConsoleChip console={entry.console} />
            <Text style={[styles.heroTitle, { fontSize: Math.min(30, Math.max(19, width / 26)) }]} numberOfLines={2}>
              {favorite ? '★ ' : ''}
              {title}
            </Text>
            <Text style={styles.heroSub} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Glifo de botón PlayStation para la barra de ayudas. */
export function PadGlyph({ kind }: { kind: 'cross' | 'circle' | 'triangle' | 'square' | 'l1' | 'r1' | 'menu' | 'view' }) {
  const color =
    kind === 'cross' ? S.cross : kind === 'circle' ? S.circle : kind === 'triangle' ? S.triangle : kind === 'square' ? S.square : S.dim;
  const label = { cross: '✕', circle: '○', triangle: '△', square: '□', l1: 'L1', r1: 'R1', menu: '≡', view: '⧉' }[kind];
  const pill = kind === 'l1' || kind === 'r1';
  return (
    <View style={[styles.glyph, pill && styles.glyphPill, { borderColor: color }]}>
      <Text style={[styles.glyphText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  genArt: { position: 'absolute', right: -6, top: 4, alignItems: 'flex-end' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(10,14,20,0.72)',
  },
  chipSmall: { paddingHorizontal: 5, paddingVertical: 2, gap: 3 },
  chipText: { color: S.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  chipTextSmall: { fontSize: 9 },
  tile: { borderRadius: 8, overflow: 'hidden', backgroundColor: S.panel, borderWidth: 2, borderColor: 'transparent' },
  tileFocused: {
    borderColor: S.focus,
    transform: [{ scale: 1.06 }],
    shadowColor: S.blue,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  tileShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(6,9,13,0.62)',
  },
  tileTitle: { color: S.text, fontSize: 13, fontWeight: '800' },
  tileBadges: { position: 'absolute', top: 6, left: 6, right: 6, flexDirection: 'row', justifyContent: 'space-between' },
  star: { color: S.gold, fontSize: 14, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 4 },
  caption: { color: S.dim, fontSize: 12, fontWeight: '600', marginTop: 6 },
  captionFocused: { color: S.text, fontWeight: '800' },
  heroInfo: { position: 'absolute', left: 18, right: 18, bottom: 14, flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  heroBox: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: S.panel,
    shadowColor: '#000',
    shadowOpacity: 0.7,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  heroText: { flex: 1, gap: 6 },
  heroTitle: { color: S.text, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 8 },
  heroSub: { color: S.dim, fontSize: 13, fontWeight: '600' },
  glyph: { minWidth: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  glyphPill: { paddingHorizontal: 6, borderRadius: 6 },
  glyphText: { fontSize: 11, fontWeight: '900' },
});
