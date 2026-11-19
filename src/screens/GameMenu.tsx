import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Libretro } from 'react-native-libretro';
import { PHYS, readPad } from '../input/uiNav';
import type { DirMode } from '../input/layouts';
import type { GamepadStatus } from '../input/useGamepadStatus';
import { isRoomCode, loadRelay, parseRelay, saveRelay, WEBPAD_HTTP_PORT } from '../net/relaySettings';
import { theme } from '../theme';

export const NET_PORT = 55435;

export type TouchMode = 'auto' | 'show' | 'hide';
export type FilterMode = 'sharp' | 'smooth';
export type NetState = { phase: string; message: string; code: string; ping: number };
/** Mando web del Jugador 2: fase 0 apagado, 1 conectando, 2 esperando, 3 conectado. */
export type WebPadState = { phase: number; code: string; message: string; seats: number };

// "fase|código|mensaje|asientos" (asientos: bit p = puerto p con mando web)
export function parseWebPadStatus(raw: string): WebPadState {
  const [phase = '0', code = '', message = '', seats = '0'] = raw.split('|');
  return { phase: Number(phase) || 0, code, message, seats: Number(seats) || 0 };
}

const SEAT_COLOR = ['#D4AF37', '#3b82f6', '#22c55e', '#f97316'];
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

// ---- Navegación con mando (cruceta + botones) -----------------------------------------------------
// Cada control del menú se registra en orden al pintarse; la cruceta mueve el foco, el botón inferior
// (✕ / A de Xbox) lo activa, izquierda/derecha cambian los selectores y el botón derecho (○ / B)
// o SELECT cierran el menú.
type FocusItem = { press: () => void; step?: (dir: -1 | 1) => void; ref: React.RefObject<View> };
const FocusCtx = createContext<{ reg: (item: FocusItem) => number; focused: number } | null>(null);

function useFocusItem(item: Omit<FocusItem, 'ref'>): { ref: React.RefObject<View>; focused: boolean } {
  const ctx = useContext(FocusCtx);
  const ref = useRef<View>(null);
  const index = ctx ? ctx.reg({ ...item, ref }) : -1;
  return { ref, focused: !!ctx && ctx.focused === index };
}

// gamepadInput() da botones FÍSICOS (PHYS): ✕ elige, ○ / Create cierran, Options elige
const PAD = {
  B: PHYS.CROSS,
  SELECT: PHYS.OPTIONS,
  START: PHYS.MENU,
  UP: PHYS.UP,
  DOWN: PHYS.DOWN,
  LEFT: PHYS.LEFT,
  RIGHT: PHYS.RIGHT,
  A: PHYS.CIRCLE,
};

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
  const { ref, focused } = useFocusItem({ press: () => !disabled && onPress() });
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        danger && styles.actionDanger,
        disabled && styles.disabled,
        pressed && styles.pressed,
        focused && styles.focused,
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
  const i = Math.max(0, options.findIndex((o) => o.id === value));
  const { ref, focused } = useFocusItem({
    press: () => onChange(options[(i + 1) % options.length].id),
    step: (dir) => onChange(options[Math.min(options.length - 1, Math.max(0, i + dir))].id),
  });
  return (
    <View ref={ref} style={[styles.row, focused && styles.focusedRow]}>
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
  /** Ruta de audio AirPlay activa pero sin pantalla externa (sin Duplicar pantalla). */
  airplayAudioOnly?: boolean;
  tvStretch: boolean;
  onTvStretch: (v: boolean) => void;
  onGuide: () => void;
  /** Botón TV/AirPlay: sin pantalla externa abre las instrucciones de Duplicar pantalla. */
  onAirPlay: () => void;
  /** Modo control forzado a mano (Chromecast, capturadora…). */
  forceController: boolean;
  onForceController: (v: boolean) => void;
  onControllerTest: () => void;
  webPad: WebPadState;
  tvOrient: 'portrait' | 'landscape' | 'auto';
  onTvOrient: (v: 'portrait' | 'landscape' | 'auto') => void;
  /** Paneles: 5 ranuras con captura, rebobinado, trucos y ajuste fino de imagen. */
  slotsPanel?: React.ReactNode;
  rewindPanel?: React.ReactNode;
  cheatsPanel?: React.ReactNode;
  imagePanel?: React.ReactNode;
  /** Ajustes propios de la consola (pantallas de DS, paleta de Game Boy…). */
  /** Diseño del mando web (/play?type=) para esta consola: arcade, ps, n64, gba, snes, nes. */
  webPadType?: string;
  extras?: { label: string; value: string; options: Option<string>[]; onChange: (v: string) => void; note?: string }[];
};

// QR del enlace del mando web: los invitados lo escanean con la cámara y entran directos
function WebPadQR({ link }: { link: string }) {
  const [uri, setUri] = useState('');
  useEffect(() => {
    const path = Libretro.qrCode(link);
    setUri(path ? `file://${path}` : '');
  }, [link]);
  if (!uri) return null;
  return (
    <View style={styles.qrWrap}>
      <Image source={{ uri }} style={styles.qr} resizeMode="contain" />
      <Text style={styles.qrHint}>Escanéalo con la cámara del móvil para entrar como J2, J3 o J4</Text>
    </View>
  );
}

function webPadLink(host: string, code: string, type?: string): string {
  return `http://${host}:${WEBPAD_HTTP_PORT}/play?code=${code}${type ? `&type=${type}` : ''}`;
}

export function GameMenu(p: GameMenuProps) {
  // Foco del mando: lista de controles registrada en cada pintado (en orden de aparición)
  const items = useRef<FocusItem[]>([]);
  items.current = [];
  const [focused, setFocused] = useState(-1);
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const focusCtx = { reg: (item: FocusItem) => items.current.push(item) - 1, focused };
  const propsRef = useRef(p);
  propsRef.current = p;
  useEffect(() => {
    let last = 0;
    const id = setInterval(() => {
      const buttons = readPad();
      const pressed = buttons & ~last;
      last = buttons;
      if (!pressed) return;
      const count = items.current.length;
      if (!count) return;
      if (pressed & (PAD.A | PAD.SELECT)) {
        propsRef.current.onResume();
        return;
      }
      setFocused((f) => {
        if (pressed & PAD.DOWN) return f < 0 ? 0 : Math.min(count - 1, f + 1);
        if (pressed & PAD.UP) return f < 0 ? 0 : Math.max(0, f - 1);
        const item = items.current[f];
        if (item && pressed & (PAD.LEFT | PAD.RIGHT)) item.step?.(pressed & PAD.LEFT ? -1 : 1);
        if (item && pressed & (PAD.B | PAD.START)) item.press();
        return f;
      });
    }, 70);
    return () => clearInterval(id);
  }, []);
  // El control enfocado se desplaza a la vista
  useEffect(() => {
    const target = items.current[focused]?.ref.current;
    const content = contentRef.current;
    if (!target || !content) return;
    try {
      target.measureLayout(content as never, (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true }), () => {});
    } catch {
      // medición no disponible
    }
  }, [focused]);

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
        <FocusCtx.Provider value={focusCtx}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View ref={contentRef} collapsable={false}>
          {p.pad.connected ? (
            <Text style={styles.padHint}>🎮 Mando: cruceta para moverte · ✕ / A elegir · ○ / B volver al juego</Text>
          ) : null}
          <Section title="Partida">
            <View style={styles.grid}>
              <Action label="Guardar partida" onPress={p.onSave} />
              <Action label="Cargar partida" onPress={p.onLoad} disabled={online} />
              <Action label="Reiniciar" onPress={p.onReset} disabled={online} />
              <Action label="Salir del juego" onPress={p.onExit} danger />
            </View>
          </Section>

          {p.slotsPanel ? <Section title="Ranuras de guardado">{p.slotsPanel}</Section> : null}
          {p.rewindPanel ? <Section title="⏪ Rebobinar">{p.rewindPanel}</Section> : null}

          <Section title="Controles">
            <Action
              label={p.forceController || p.tvConnected ? 'Editar botones (mando de TV)' : 'Editar controles (botón a botón, sensibilidad, vibración)'}
              onPress={p.onEditControls}
            />
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
              label="Calidad de imagen"
              value={p.filter}
              onChange={p.onFilter}
              options={[
                { id: 'sharp', label: 'Nítido HD (Pixel-Perfect)' },
                { id: 'smooth', label: 'Suavizado ligero' },
              ]}
            />
            {p.imagePanel}
            {(p.extras ?? []).map((x) => (
              <View key={x.label}>
                <Segmented label={x.label} value={x.value} onChange={x.onChange} options={x.options} />
                {x.note ? <Text style={styles.note}>{x.note}</Text> : null}
              </View>
            ))}
          </Section>

          {p.cheatsPanel ? <Section title="Trucos / Parches">{p.cheatsPanel}</Section> : null}

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

          <Section title="Jugadores (4 puertos)">
            {[0, 1, 2, 3].map((port) => {
              const web = (p.webPad.seats >> port) & 1;
              const physical = p.pad.players?.[port];
              const who =
                port === 0
                  ? `Host (este iPhone${physical ? ` + ${physical.kind}` : ''})`
                  : web
                    ? 'Mando Web'
                    : physical
                      ? `${physical.kind === 'PS5' ? 'DualSense' : physical.kind} Bluetooth`
                      : 'Libre';
              return (
                <View key={port} style={styles.seatRow}>
                  <View style={[styles.seatBadge, { backgroundColor: SEAT_COLOR[port] }]}>
                    <Text style={styles.seatBadgeText}>J{port + 1}</Text>
                  </View>
                  <Text style={[styles.seatWho, who === 'Libre' && styles.seatFree]}>{who}</Text>
                  {web ? (
                    <Pressable onPress={() => Libretro.webPadKick(port)} hitSlop={8}>
                      <Text style={styles.seatKick}>Liberar</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </Section>

          <Section title="Invitar jugadores J2, J3 y J4 sin app (Mando Web)">
            <Text style={styles.note}>
              Hasta 3 amigos abren el mismo enlace en Safari o Chrome y su móvil se convierte en el mando de J2, J3
              y J4 (el primer asiento libre; pueden cambiarse de asiento), sin instalar nada ni tener el juego. Se
              puede mezclar con mandos Bluetooth: cada mando físico ocupa su puerto y el navegador toma otro.
            </Text>
            {p.webPad.phase === 0 ? (
              <Action
                label="Crear sala de mandos web (J2-J4)"
                primary
                disabled={!relay || online}
                onPress={() => relay && Libretro.webPadStart(relay.host, relay.port)}
              />
            ) : (
              <>
                <Text style={[styles.status, p.webPad.phase === 3 && styles.statusOn]}>{p.webPad.message}</Text>
                {p.webPad.code && relay ? (
                  <View style={styles.codeBox}>
                    <Text style={styles.codeLabel}>CÓDIGO DEL MANDO WEB</Text>
                    <Text style={styles.code} selectable>
                      {p.webPad.code}
                    </Text>
                    <Text style={styles.link} selectable>
                      {webPadLink(relay.host, p.webPad.code, p.webPadType)}
                    </Text>
                    <WebPadQR link={webPadLink(relay.host, p.webPad.code, p.webPadType)} />
                    <View style={styles.grid}>
                      <Action label="Copiar enlace" onPress={() => Libretro.copyToClipboard(webPadLink(relay.host, p.webPad.code, p.webPadType))} />
                      <Action
                        label="Compartir enlace / código"
                        primary
                        onPress={() =>
                          Share.share({
                            message:
                              `¡Juega conmigo ${p.title} en JL Emulator! Abre este enlace en tu móvil y serás el ` +
                              `Jugador 2, 3 o 4 (no hace falta instalar nada): ${webPadLink(relay.host, p.webPad.code, p.webPadType)} ` +
                              `(código ${p.webPad.code})`,
                          }).catch(() => {})
                        }
                      />
                    </View>
                  </View>
                ) : null}
                <Action label="Cerrar mando web" onPress={() => Libretro.webPadStop()} danger />
              </>
            )}
            {online ? <Text style={styles.note}>No disponible durante una partida en línea entre dos apps.</Text> : null}
          </Section>

          <Section title="TV y AirPlay">
            <Text style={[styles.status, p.tvConnected && styles.statusOn]}>
              {p.tvConnected ? 'TV conectada: el juego se ve en la TV' : 'Sin TV conectada'}
            </Text>
            {p.airplayAudioOnly ? (
              <Text style={styles.warnText}>
                Conectaste solo audio AirPlay. Para ver el juego en la TV y usar el iPhone como control, activa
                'Duplicar pantalla' (Screen Mirroring) en el Centro de control.
              </Text>
            ) : null}
            <Action label="Transmitir a TV / AirPlay" primary onPress={p.onAirPlay} />
            {!p.tvConnected ? (
              <Action
                label={p.forceController ? 'Salir del modo control' : 'Activar modo control ahora'}
                onPress={() => p.onForceController(!p.forceController)}
              />
            ) : null}
            <Segmented
              label="Orientación del control en TV"
              value={p.tvOrient}
              onChange={p.onTvOrient}
              options={[
                { id: 'portrait', label: 'Vertical (Palanca)' },
                { id: 'landscape', label: 'Horizontal (Mando)' },
                { id: 'auto', label: 'Automático' },
              ]}
            />
            <Text style={styles.note}>
              Vertical: palanca bloqueada en vertical · Horizontal: mando clásico con las dos manos, como PSP/PS1 ·
              Automático: gira con el teléfono. El vídeo sigue fijo en la TV.
            </Text>
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

          <Section title="Mando / Palanca Bluetooth">
            <Text style={[styles.status, p.pad.connected && styles.statusOn]}>
              {p.pad.connected ? `Conectado: ${p.pad.name || p.pad.kind || 'mando'}` : 'Ningún mando detectado'}
            </Text>
            {(p.pad.players ?? []).map((pl, i) => (
              <Text key={i} style={styles.playerRow}>
                J{i + 1} · {pl.name || pl.kind}
                {pl.rumble ? ' · vibración' : ''}
              </Text>
            ))}
            <View style={styles.grid}>
              <Action label="Buscar mandos" onPress={() => Libretro.discoverControllers()} />
              <Action label="Mapeo y prueba de botones" onPress={p.onControllerTest} />
            </View>
            {(p.pad.count ?? 0) >= 2 ? <Action label="Intercambiar J1 / J2" onPress={() => Libretro.swapPlayers()} /> : null}
            <Text style={styles.note}>
              Enciende tu palanca o mando en modo emparejamiento y conéctalo en Ajustes &gt; Bluetooth del iPhone
              (DualSense: PS + Create hasta que parpadee). Aparece aquí solo al conectarse y los controles táctiles
              se ocultan (botón "Mostrar controles" para verlos). Funcionan DualSense, DualShock 4, Xbox, MFi y
              palancas arcade compatibles con iPhone; con el stick izquierdo también te mueves en arcade, PS1 y GBA.
            </Text>
          </Section>

          <Section title="Ayuda">
            <Action label="¿Cómo funciona? / Guía" onPress={p.onGuide} />
          </Section>

          <Section title="Diagnóstico">
            <Action label={p.debugOn ? 'Ocultar consola debug' : 'Mostrar consola debug'} onPress={p.onDebug} />
          </Section>
          </View>
        </ScrollView>
        </FocusCtx.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  focused: { borderColor: '#D4AF37', borderWidth: 2, shadowColor: '#D4AF37', shadowOpacity: 0.7, shadowRadius: 8 },
  focusedRow: { borderRadius: 10, borderWidth: 2, borderColor: '#D4AF37' },
  padHint: { color: '#D4AF37', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  qrWrap: { alignItems: 'center', marginVertical: 10, gap: 6 },
  qr: { width: 190, height: 190, backgroundColor: '#fff', borderRadius: 10 },
  qrHint: { color: '#9aa0a8', fontSize: 12, textAlign: 'center' },
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
  warnText: { color: theme.amber, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  link: { color: theme.titaniumHi, fontSize: 13, textAlign: 'center' },
  seatRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  seatBadge: { minWidth: 34, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, alignItems: 'center' },
  seatBadgeText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  seatWho: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  seatFree: { color: theme.textDim, fontWeight: '400' },
  seatKick: { color: theme.danger, fontWeight: '800', fontSize: 13 },
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
