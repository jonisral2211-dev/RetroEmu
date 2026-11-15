import React, { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, UIManager, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { theme } from '../theme';
import { JLBadge } from '../ui/JLBadge';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

type IconKind = 'folder' | 'pad' | 'tv' | 'net' | 'tune';

function GuideIcon({ kind }: { kind: IconKind }) {
  const c = theme.amber;
  return (
    <Svg width={30} height={30} viewBox="0 0 24 24">
      {kind === 'folder' ? (
        <Path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" stroke={c} strokeWidth={1.6} fill="none" />
      ) : null}
      {kind === 'pad' ? (
        <>
          <Path d="M6 8h12a4 4 0 0 1 3.9 4.8l-.9 4.4a2.3 2.3 0 0 1-4 .9L15.4 16H8.6L7 18.1a2.3 2.3 0 0 1-4-.9l-.9-4.4A4 4 0 0 1 6 8z" stroke={c} strokeWidth={1.6} fill="none" />
          <Path d="M7.5 11v3M6 12.5h3" stroke={c} strokeWidth={1.6} />
          <Circle cx="16" cy="11.5" r="1" fill={c} />
          <Circle cx="17.8" cy="13.3" r="1" fill={c} />
        </>
      ) : null}
      {kind === 'tv' ? (
        <>
          <Rect x="2.5" y="4.5" width="19" height="12.5" rx="2" stroke={c} strokeWidth={1.6} fill="none" />
          <Path d="M8 20.5h8M12 17v3.5" stroke={c} strokeWidth={1.6} />
        </>
      ) : null}
      {kind === 'net' ? (
        <>
          <Circle cx="6" cy="12" r="2.6" stroke={c} strokeWidth={1.6} fill="none" />
          <Circle cx="18" cy="6" r="2.6" stroke={c} strokeWidth={1.6} fill="none" />
          <Circle cx="18" cy="18" r="2.6" stroke={c} strokeWidth={1.6} fill="none" />
          <Path d="M8.4 10.8l7.2-3.6M8.4 13.2l7.2 3.6" stroke={c} strokeWidth={1.6} />
        </>
      ) : null}
      {kind === 'tune' ? (
        <Path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
      ) : null}
    </Svg>
  );
}

type Step = string | { t: string; code?: string };
type Card = { icon: IconKind; title: string; intro: string; steps: Step[]; tip?: string };

const CARDS: Card[] = [
  {
    icon: 'folder',
    title: '1. Cómo agregar juegos y carpetas',
    intro:
      'JL Emulator ordena tus juegos en carpetas por consola dentro de "En mi iPhone → JL Emulator". Puedes copiarlos con la app Archivos o descargarlos desde "Explorar web".',
    steps: [
      'Desde Explorar web: navega a tu página, toca el enlace del archivo y la descarga se guarda y clasifica sola (los .zip y .7z grandes se descomprimen en segundo plano).',
      'Desde la app Archivos: abre Archivos → En mi iPhone → JL Emulator y copia o mueve el juego a la carpeta de su consola. También puedes soltarlo en la raíz y pulsar Actualizar: se coloca solo.',
      { t: 'PlayStation → ps1/', code: '.chd  ·  .cue + .bin  ·  .iso  ·  .pbp' },
      { t: 'PSP → psp/', code: '.iso  ·  .cso  ·  .chd (DVD)  ·  .pbp' },
      { t: 'Nintendo 64 → n64/', code: '.z64  ·  .n64  ·  .v64' },
      { t: 'Nintendo DS → nds/   ·   GBA → gba/', code: '.nds  ·  .gba' },
      { t: 'Saturn → saturn/   ·   Mega Drive → sega/', code: '.chd  ·  .cue + .bin  ·  .md  ·  .gen' },
      { t: 'Super Nintendo → snes/   ·   NES → nes/', code: '.sfc  ·  .smc  ·  .fig  ·  .nes  ·  .fds  ·  .unf' },
      { t: 'Game Boy → gb/   ·   Game Boy Color → gbc/', code: '.gb  ·  .gbc  ·  .zip' },
      { t: 'Dreamcast → dreamcast/ (BIOS opcional en system/dc/)', code: '.gdi + pistas  ·  .cdi  ·  .chd' },
      { t: 'Ports PC → ports/ (Cave Story ya viene incluido)', code: '.wad (Doom)  ·  id1/pak0.pak (Quake)  ·  VSWAP.WL6  ·  .zip con el juego' },
      { t: 'Arcade → arcade/ (MAME) o fbneo/ (FBNeo)', code: '.zip (romset sin descomprimir)' },
      'Un .zip o .7z en cualquier carpeta de consola (no arcade) se descomprime solo y desaparece al terminar.',
      'Neo-Geo (King of Fighters, Metal Slug): copia también neogeo.zip (la BIOS) en arcade/, fbneo/ o system/. La app la reparte donde haga falta y no la muestra como juego.',
      'Versiones modificadas (por ejemplo kf2k2mp2) necesitan también el juego original (kof2002.zip) en la misma carpeta.',
    ],
    tip: 'Mantén pulsada una tarjeta para cambiar su miniatura (Fotos), recargar la carátula, eliminar el juego o moverlo a otra consola.',
  },
  {
    icon: 'pad',
    title: '2. Conectar 1 o 2 mandos (PS5, PS4, Xbox)',
    intro: 'Cualquier mando Bluetooth compatible con iPhone funciona: DualSense (PS5), DualShock 4 (PS4), Xbox y mandos MFi.',
    steps: [
      'DualSense: con el mando apagado, mantén pulsados PS + Create (Compartir) hasta que la luz parpadee en azul rápido.',
      'En el iPhone ve a Ajustes → Bluetooth y toca el mando en "Otros dispositivos".',
      'El primer mando es el Jugador 1: se enciende 1 luz y la barra de luz se pone azul.',
      'Repite con el segundo mando: será el Jugador 2 (2 luces, barra roja). Ideal para jugar a dobles en la misma pantalla o en la TV.',
      'Para cambiar quién es J1 y J2: en partida toca el engranaje → Mando externo → Intercambiar J1 / J2.',
      'Con un mando conectado el pad táctil se oculta solo; arriba aparece el botón "Mostrar controles" por si los quieres ver. Los juegos que vibran hacen vibrar el mando.',
      'Palancas arcade Bluetooth: emparéjalas igual en Ajustes → Bluetooth. En el engranaje → Mando / Palanca Bluetooth puedes buscar mandos, ver cuál está conectado y abrir "Mapeo y prueba de botones" para comprobar cada botón y asignarle otra función (botones 1-6, COIN, START) y ajustar la zona muerta del stick.',
    ],
  },
  {
    icon: 'tv',
    title: '3. Jugar en la TV (Modo Consola)',
    intro: 'El juego sale a pantalla completa en la TV, sin botones ni menús encima, y el sonido sale por la TV.',
    steps: [
      'Por cable (recomendado: sin retraso, 60 FPS): adaptador Lightning/USB-C a HDMI y cable a la TV.',
      'Inalámbrico (AirPlay): con el iPhone y el Apple TV o Smart TV compatible en la misma Wi-Fi, abre el Centro de Control → Duplicar pantalla y elige la TV. El botón "Transmitir a TV / AirPlay" del menú abre el selector de AirPlay.',
      'El botón "Transmitir a TV / AirPlay" del juego te muestra estos pasos: el selector de AirPlay de las apps solo envía el audio; para el vídeo hace falta Duplicar pantalla (o HDMI).',
      'Al detectar la TV, el iPhone se bloquea en vertical y se convierte en un mando a pantalla completa con el diseño de la consola: PlayStation (cruceta y stick abajo a la izquierda, △○✕□ a la derecha, L1/L2/R1/R2 arriba), N64 (stick grande, C amarillos, Z), Arcade (palanca grande y 6 botones en arco con COIN y START), Sega (6 botones) y GBA/NDS (en DS, un trackpad para el lápiz). Al desconectar la TV vuelve todo a la normalidad.',
      'Con Chromecast, capturadora u otros casos especiales: Configuración → TV → "Activar modo control ahora".',
      'Con 1 o 2 mandos físicos, el iPhone muestra el panel "Modo Consola Activo" con Configuración y Guardar/Cargar a mano.',
      'En Configuración → TV puedes elegir 4:3 Original o 16:9 Expandir para la imagen de la TV.',
    ],
    tip: 'Por AirPlay hay algo de retraso según la red; para juegos de pelea usa cable HDMI.',
  },
  {
    icon: 'net',
    title: '4. Jugar en línea con amigos',
    intro:
      'Dos iPhone, cada uno con su copia de JL Emulator, juegan la misma partida como Jugador 1 y Jugador 2. Pueden estar en la misma casa o en ciudades distintas.',
    steps: [
      'Antes: los dos con la misma versión de JL Emulator y exactamente el mismo archivo del juego (se comprueba al conectar; si no coinciden verás "Los archivos del juego no coinciden").',
      'Jugador 1: abre el juego → engranaje → Jugar en línea → "Crear sala en línea (código)". Aparece un código de 6 caracteres, por ejemplo K7Q2MX. (La primera vez escribe la dirección del servidor de salas en "Servidor de salas"; los dos jugadores deben usar el mismo.)',
      'Toca "Compartir código" para enviarlo por WhatsApp o Mensajes, o "Copiar".',
      'Jugador 2: abre el mismo juego → engranaje → Jugar en línea → escribe el código en "Unirse con código o IP" → Unirse.',
      'Al conectar, el Jugador 2 recibe la partida del Jugador 1 y empezáis juntos. Arriba verás el ping en milisegundos.',
      'En la misma Wi-Fi también puedes usar "Crear sala local" y unirte escribiendo la IP que aparece.',
      'Jugador 2 sin la app (Mando Web): en Jugar en línea toca "Crear mando web para el Jugador 2" y comparte el enlace. Tu amigo lo abre en Safari o Chrome, elige el tipo de mando (Arcade, PlayStation/PSP, N64 o GBA) y su móvil se convierte en el mando del Jugador 2 de tu partida, sin instalar nada ni tener el juego.',
      'Peleas y carreras (KOF 2002, Dragon Ball GT, Mega Drive, GBA, PS1) usan rollback: tus botones responden al instante y la app corrige en silencio si la red se retrasa. N64 y PSP usan retardo adaptable.',
    ],
    tip: 'Durante la partida en línea el juego no se pausa ni se pueden cargar estados (desincronizaría a los dos).',
  },
  {
    icon: 'tune',
    title: '5. Botones, sensibilidad y partidas guardadas',
    intro: 'Todo está en el engranaje de la esquina superior durante la partida (al abrirlo, el juego se pausa).',
    steps: [
      'Editar controles: toca un botón (borde dorado) y arrástralo a donde quieras. Ajusta su tamaño, el tamaño global y la transparencia. Se guarda por consola y por orientación.',
      'Respuesta táctil: sensibilidad del stick (50-200 %), zona muerta (5-40 %), área de detección de los botones y vibración háptica.',
      'Dirección: D-Pad, Stick o Ambos.',
      'Guardar partida / Cargar partida: guarda el momento exacto y vuelve a él cuando quieras. Al salir del juego también se guarda solo y al volver continúa donde lo dejaste.',
      'Pantalla y gráficos: imagen original o expandida, resolución (PS1 1x/2x) y filtro nítido o suave.',
    ],
  },
];

export default function GuideScreen({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState<number | null>(0);
  const toggle = (i: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => (o === i ? null : i));
  };
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <JLBadge size={46} />
          <View style={styles.headerText}>
            <Text style={styles.kicker}>GUÍA Y MANUAL DE USO</Text>
            <Text style={styles.title}>¿Cómo funciona?</Text>
          </View>
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
              <Text style={styles.closeText}>Cerrar</Text>
            </Pressable>
          ) : null}
        </View>
        {CARDS.map((card, i) => {
          const expanded = open === i;
          return (
            <View key={card.title} style={[styles.card, expanded && styles.cardOpen]}>
              <Pressable onPress={() => toggle(i)} style={styles.cardHead}>
                <View style={styles.iconBox}>
                  <GuideIcon kind={card.icon} />
                </View>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.chevron}>{expanded ? '▴' : '▾'}</Text>
              </Pressable>
              {expanded ? (
                <View style={styles.cardBody}>
                  <Text style={styles.intro}>{card.intro}</Text>
                  {card.steps.map((step, j) => {
                    const s = typeof step === 'string' ? { t: step } : step;
                    return (
                      <View key={j} style={styles.step}>
                        <View style={styles.stepNum}>
                          <Text style={styles.stepNumText}>{j + 1}</Text>
                        </View>
                        <View style={styles.stepText}>
                          <Text style={styles.stepBody}>{s.t}</Text>
                          {s.code ? <Text style={styles.code}>{s.code}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                  {card.tip ? (
                    <View style={styles.tip}>
                      <Text style={styles.tipText}>{card.tip}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  headerText: { flex: 1 },
  kicker: { color: theme.amber, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: { color: theme.text, fontSize: 24, fontWeight: '800', marginTop: 2 },
  close: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.amber,
    backgroundColor: theme.amberDim,
  },
  closeText: { color: theme.amber, fontWeight: '800' },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  cardOpen: { borderColor: 'rgba(212,175,55,0.6)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.amberDim,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
  },
  cardTitle: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '800' },
  chevron: { color: theme.amber, fontSize: 16 },
  cardBody: { paddingHorizontal: 14, paddingBottom: 16, gap: 10 },
  intro: { color: theme.titaniumHi, fontSize: 13, lineHeight: 19 },
  step: { flexDirection: 'row', gap: 10 },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.amber,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: theme.bg, fontSize: 12, fontWeight: '900' },
  stepText: { flex: 1, gap: 4 },
  stepBody: { color: theme.text, fontSize: 13, lineHeight: 19 },
  code: {
    color: theme.amber,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: theme.bg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  tip: {
    borderLeftWidth: 3,
    borderLeftColor: theme.amber,
    backgroundColor: theme.amberDim,
    padding: 10,
    borderRadius: 8,
  },
  tipText: { color: theme.text, fontSize: 12, lineHeight: 18 },
});
