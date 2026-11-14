import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Libretro } from 'react-native-libretro';
import type { DirMode } from '../input/layouts';
import type { GamepadStatus } from '../input/useGamepadStatus';
import { isRoomCode, loadRelay, parseRelay, saveRelay } from '../net/relaySettings';
import { theme } from '../theme';

export const NET_PORT = 55435;

export type TouchMode = 'auto' | 'show' | 'hide';
export type FilterMode = 'sharp' | 'smooth';
export type NetState = { phase: string; message: string; code: string; ping: number };
type Option<T extends string> = { id: T; label: string };

// "fase|mensaje|código|ping"
export function parseNetStatus(raw: string): NetState {
  const [phase = 'idle', message = '', code = '', ping = '-1'] = raw.split('|');
  return { phase, message, code, ping: Number(ping) };
}

/** Botón de engranaje discreto (única pieza de interfaz sobre el juego). */
export function GearButton({ onPress, online }: { onPress: () => void; online: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={({ pressed }) => [styles.gear, pressed && styles.pressed]}>
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Path
          d="M10.3 2.6h3.4l.5 2.6a7.5 7.5 0 0 1 1.9 1.1l2.5-.9 1.7 2.9-2 1.7a7.6 7.6 0 0 1 0 2.2l2 1.7-1.7 2.9-2.5-.9a7.5 7.5 0 0 1-1.9 1.1l-.5 2.6h-3.4l-.5-2.6a7.5 7.5 0 0 1-1.9-1.1l-2.5.9-1.7-2.9 2-1.7a7.6 7.6 0 0 1 0-2.2l-2-1.7 1.7-2.9 2.5.9a7.5 7.5 0 0 1 1.9-1.1z"
          stroke={theme.amber}
          strokeWidth={1.6}
          fill="none"
          strokeLinejoin="round"
        />
        <Circle cx="12" cy="12" r="3" stroke={theme.amber} strokeWidth={1.6} fill="none" />
      </Svg>
      {online ? <View style={styles.onlineDot} /> : null}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Action({
  label,
  onPress,
  primary,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        danger && styles.actionDanger,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.actionText, primary && styles.actionTextPrimary, danger && styles.actionTextDanger]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.segment}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <Pressable key={o.id} onPress={() => onChange(o.id)} style={[styles.segItem, on && styles.segItemOn]}>
              <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export type GameMenuProps = {
  landscape: boolean;
  title: string;
  onResume: () => void;
  onExit: () => void;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
  onEditControls: () => void;
  dirMode: DirMode;
  onDirMode: (m: DirMode) => void;
  touchMode: TouchMode;
  onTouchMode: (m: TouchMode) => void;
  genesisSix?: boolean;
  onGenesisSix?: (v: boolean) => void;
  stretch: boolean;
  onStretch: (v: boolean) => void;
  aspectName: string;
  resolutions: Option<string>[];
  resolution: string;
  onResolution: (id: string) => void;
  resolutionNote: string;
  filter: FilterMode;
  onFilter: (f: FilterMode) => void;
  pad: GamepadStatus;
  net: NetState;
  debugOn: boolean;
  onDebug: () => void;
  tvConnected: boolean;
  tvStretch: boolean;
  onTvStretch: (v: boolean) => void;
  onGuide: () => void;
};

export function GameMenu(p: GameMenuProps) {
  const [address, setAddress] = useState('');
  const [relayText, setRelayText] = useState('');
  useEffect(() => {
    loadRelay().then(setRelayText);
  }, []);
  const relay = parseRelay(relayText);
  const myIp = Libretro.localAddress();
  const online = p.net.phase !== 'idle';
  // Código de 6 caracteres -> sala del servidor; si no, IP (opcionalmente con :puerto)
  const join = () => {
    const v = address.trim();
    if (isRoomCode(v)) {
      if (relay) Libretro.netJoinCode(v.toUpperCase(), relay.host, relay.port);
      return;
    }
    const [ip, port] = v.split(':');
    Libretro.netJoin(ip, Number(port) || NET_PORT);
  };

  const padText = p.pad.connected
    ? `${p.pad.kind === 'PS5' ? 'DualSense (PS5)' : p.pad.kind === 'PS4' ? 'DualShock 4 (PS4)' : p.pad.kind || 'Mando'} conectado` +
      `${p.pad.name ? ` · ${p.pad.name}` : ''}${p.pad.rumble ? ' · vibración activa' : ''}`
    : 'Ningún mando conectado. Empareja tu DualSense, DualShock 4 o Xbox en Ajustes → Bluetooth y aparecerá aquí.';

  return (
    <View style={styles.overlay}>
      <View style={[styles.sheet, p.landscape && styles.sheetLandscape]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>{online ? 'EN LÍNEA · NO SE PAUSA' : 'PAUSA'}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {p.title}
            </Text>
          </View>
          <Action label="Reanudar" onPress={p.onResume} primary />
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Section title="Partida">
            <View style={styles.grid}>
              <Action label="Guardar partida" onPress={p.onSave} />
              <Action label="Cargar partida" onPress={p.onLoad} disabled={online} />
              <Action label="Reiniciar" onPress={p.onReset} disabled={online} />
              <Action label="Salir del juego" onPress={p.onExit} danger />
            </View>
          </Section>

          <Section title="Controles">
            <Action label="Editar controles (botón a botón, sensibilidad, vibración)" onPress={p.onEditControls} />
            <Segmented
              label="Dirección"
              value={p.dirMode}
              onChange={p.onDirMode}
              options={[
                { id: 'dpad', label: 'D-Pad' },
                { id: 'stick', label: 'Stick' },
                { id: 'both', label: 'Ambos' },
              ]}
            />
            <Segmented
              label="Pad táctil"
              value={p.touchMode}
              onChange={p.onTouchMode}
              options={[
                { id: 'auto', label: 'Auto' },
                { id: 'show', label: 'Mostrar' },
                { id: 'hide', label: 'Ocultar' },
              ]}
            />
            {p.onGenesisSix ? (
              <Segmented
                label="Mando Mega Drive"
                value={p.genesisSix ? '6' : '3'}
                onChange={(v) => p.onGenesisSix?.(v === '6')}
                options={[
                  { id: '3', label: '3 botones' },
                  { id: '6', label: '6 botones' },
                ]}
              />
            ) : null}
          </Section>

          <Section title="Pantalla y gráficos">
            <Segmented
              label="Imagen"
              value={p.stretch ? 'fill' : 'orig'}
              onChange={(v) => p.onStretch(v === 'fill')}
              options={[
                { id: 'orig', label: `${p.aspectName} Original` },
                { id: 'fill', label: 'Expandir' },
              ]}
            />
            <Segmented label="Resolución" value={p.resolution} onChange={p.onResolution} options={p.resolutions} />
            <Text style={styles.note}>{p.resolutionNote}</Text>
            <Segmented
              label="Filtro"
              value={p.filter}
              onChange={p.onFilter}
              options={[
                { id: 'sharp', label: 'Nítido (píxel)' },
                { id: 'smooth', label: 'Suave + realce' },
              ]}
            />
          </Section>

          <Section title="Jugar en línea (Netplay)">
            <View style={styles.netHead}>
              <Text style={[styles.status, online && styles.statusOn]}>{p.net.message || 'Sin conexión'}</Text>
              {p.net.phase === 'playing' && p.net.ping >= 0 ? (
                <View style={[styles.pingBadge, p.net.ping > 150 && styles.pingBad]}>
                  <Text style={styles.pingText}>{p.net.ping} ms</Text>
                </View>
              ) : null}
            </View>
            {p.net.phase === 'waiting' && p.net.code ? (
              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>CÓDIGO DE SALA</Text>
                <Text style={styles.code} selectable>
                  {p.net.code}
                </Text>
                <View style={styles.grid}>
                  <Action label="Copiar" onPress={() => Libretro.copyToClipboard(p.net.code)} />
                  <Action
                    label="Compartir código"
                    primary
                    onPress={() =>
                      Share.share({
                        message:
                          `¡Juguemos ${p.title} en JL Emulator! Abre el mismo juego → engranaje → ` +
                          `Jugar en línea → Unirse con el código ${p.net.code}`,
                      }).catch(() => {})
                    }
                  />
                </View>
              </View>
            ) : null}
            {online ? (
              <Action label="Desconectar" onPress={() => Libretro.netStop()} danger />
            ) : (
              <>
                <Action
                  label="Crear sala en línea (código para compartir)"
                  primary
                  disabled={!relay}
                  onPress={() => relay && Libretro.netHostRelay(relay.host, relay.port)}
                />
                <Action
                  label={`Crear sala local (misma Wi-Fi) · ${myIp || 'sin Wi-Fi'}:${NET_PORT}`}
                  onPress={() => Libretro.netHost(NET_PORT)}
                />
                <View style={styles.joinRow}>
                  <TextInput
                    value={address}
                    onChangeText={setAddress}
                    placeholder="Código de sala o IP"
                    placeholderTextColor={theme.textDim}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <Action label="Unirse" primary disabled={!address.trim()} onPress={join} />
                </View>
              </>
            )}
            <Text style={styles.rowLabel}>Servidor de salas (para jugar a distancia)</Text>
            <TextInput
              value={relayText}
              onChangeText={setRelayText}
              onEndEditing={() => saveRelay(relayText)}
              placeholder="servidor:55436"
              placeholderTextColor={theme.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
            <Text style={styles.note}>
              {relay
                ? 'Con código de sala no hace falta abrir puertos: los dos iPhone se conectan hacia fuera al servidor, desde cualquier Wi-Fi o datos móviles.'
                : 'Para jugar a distancia con código escribe aquí la dirección de tu servidor de salas (JL Relay). Sin servidor puedes jugar en la misma Wi-Fi o por IP con el puerto ' + NET_PORT + ' abierto.'}{' '}
              Ambos necesitan la misma versión de la app y el mismo archivo del juego (se comprueba al conectar).
              Peleas y carreras usan rollback; N64 y PSP, retardo adaptable. En línea no se pausa ni se cargan estados.
            </Text>
          </Section>

          <Section title="TV y AirPlay">
            <Text style={[styles.status, p.tvConnected && styles.statusOn]}>
              {p.tvConnected ? 'TV conectada: el juego se ve en la TV' : 'Sin TV conectada'}
            </Text>
            <Action label="Transmitir a TV / AirPlay" onPress={() => Libretro.showAirPlayPicker()} />
            <Segmented
              label="Imagen en la TV"
              value={p.tvStretch ? 'fill' : 'orig'}
              onChange={(v) => p.onTvStretch(v === 'fill')}
              options={[
                { id: 'orig', label: '4:3 Original' },
                { id: 'fill', label: '16:9 Expandir' },
              ]}
            />
            <Text style={styles.note}>
              Por cable HDMI (adaptador) no hay retraso. Por AirPlay usa Centro de Control → Duplicar pantalla con
              la TV en la misma Wi-Fi.
            </Text>
          </Section>

          <Section title="Mando externo">
            <Text style={[styles.status, p.pad.connected && styles.statusOn]}>{padText}</Text>
            {(p.pad.players ?? []).map((pl, i) => (
              <Text key={i} style={styles.playerRow}>
                J{i + 1} · {pl.kind}
                {pl.name ? ` · ${pl.name}` : ''}
              </Text>
            ))}
            {(p.pad.count ?? 0) >= 2 ? <Action label="Intercambiar J1 / J2" onPress={() => Libretro.swapPlayers()} /> : null}
            <Text style={styles.note}>
              Botones: Cruz/Círculo/Cuadrado/Triángulo, L1/R1, L2/R2 analógicos, L3/R3, ambos sticks, cruceta,
              Create (Select) y Options (Start). Con el pad táctil en Auto se oculta al conectar el mando.
            </Text>
          </Section>

          <Section title="Ayuda">
            <Action label="¿Cómo funciona? / Guía" onPress={p.onGuide} />
          </Section>

          <Section title="Diagnóstico">
            <Action label={p.debugOn ? 'Ocultar consola debug' : 'Mostrar consola debug'} onPress={p.onDebug} />
          </Section>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gear: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13,14,18,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.45)',
  },
  onlineDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#22C55E',
    borderWidth: 1,
    borderColor: '#0D0E12',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,6,8,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '96%',
    borderRadius: 20,
    backgroundColor: 'rgba(21,23,29,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.5)',
    overflow: 'hidden',
  },
  sheetLandscape: { maxWidth: 640 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  headerText: { flex: 1 },
  kicker: { color: theme.amber, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: { color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 2 },
  body: { padding: 18, paddingTop: 6, gap: 4 },
  section: { marginTop: 12, gap: 8 },
  sectionTitle: { color: theme.amber, fontSize: 11, fontWeight: '800', letterSpacing: 1.8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: theme.surfaceHi,
    borderWidth: 1,
    borderColor: theme.border,
  },
  actionPrimary: { backgroundColor: theme.amber, borderColor: theme.amber, flexGrow: 0 },
  actionDanger: { borderColor: 'rgba(229,103,91,0.6)' },
  actionText: { color: theme.titaniumHi, fontWeight: '700', fontSize: 14, textAlign: 'center' },
  actionTextPrimary: { color: theme.bg },
  actionTextDanger: { color: theme.danger },
  row: { gap: 6 },
  rowLabel: { color: theme.textDim, fontSize: 12, fontWeight: '600' },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.bg,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: theme.border,
  },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segItemOn: { backgroundColor: theme.amber },
  segText: { color: theme.titaniumHi, fontSize: 12, fontWeight: '700' },
  segTextOn: { color: theme.bg },
  note: { color: theme.textDim, fontSize: 11, lineHeight: 16 },
  status: { color: theme.titaniumHi, fontSize: 13, lineHeight: 18 },
  statusOn: { color: '#4ADE80', fontWeight: '700' },
  joinRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  netHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pingBadge: { backgroundColor: 'rgba(34,197,94,0.18)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pingBad: { backgroundColor: 'rgba(229,103,91,0.2)' },
  pingText: { color: theme.text, fontSize: 12, fontWeight: '800' },
  codeBox: {
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.amber,
    backgroundColor: theme.amberDim,
  },
  codeLabel: { color: theme.amber, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  code: { color: theme.text, fontSize: 34, fontWeight: '900', letterSpacing: 8 },
  playerRow: { color: theme.titaniumHi, fontSize: 13, fontWeight: '600' },
  input: {
    flex: 1,
    color: theme.text,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
});
