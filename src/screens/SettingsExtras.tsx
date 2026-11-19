import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Libretro } from 'react-native-libretro';
import { RaAccount, signInRa, signOutRa, subscribeRaAccount } from '../achievements/ra';
import { setSkinsEnabled, skinsEnabled, subscribeSkins } from '../input/skins';
import {
  cloudAutoSync,
  cloudInfo,
  CloudInfo,
  linkCloudFolder,
  setCloudAutoSync,
  subscribeCloud,
  syncNow,
  unlinkCloudFolder,
} from '../library/cloudSync';
import { theme } from '../theme';
import { setExperience, useExperience } from '../ui/experiencePrefs';

// Secciones nuevas de Ajustes: RetroAchievements, partidas en iCloud Drive y experiencia
// (vibración, skins, música ambiental, paralaje y Live Activity).

function Row({ label, note, value, onChange }: { label: string; note?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <Text style={styles.switchLabel}>{label}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.amber }} />
    </View>
  );
}

// ---- RetroAchievements ---------------------------------------------------------------------------
export function RetroAchievementsSection() {
  const [account, setAccount] = useState<RaAccount | null>(null);
  const [user, setUser] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeRaAccount(setAccount), []);

  const signIn = () => {
    setBusy(true);
    signInRa(user, key)
      .then((a) => {
        setKey('');
        Alert.alert('RetroAchievements', `Sesión iniciada como ${a.user}.`);
      })
      .catch((e) => Alert.alert('No se pudo iniciar sesión', String(e?.message ?? e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Text style={styles.section}>LOGROS RETRO (RETROACHIEVEMENTS)</Text>
      {account ? (
        <View style={styles.card}>
          <View style={styles.accountRow}>
            {account.avatar ? <Image source={{ uri: account.avatar }} style={styles.avatar} /> : <Text style={styles.trophy}>🏆</Text>}
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{account.user}</Text>
              <Text style={styles.note}>{account.points != null ? `${account.points} puntos` : 'Cuenta vinculada'}</Text>
            </View>
            <Pressable onPress={() => signOutRa()} style={({ pressed }) => [styles.small, pressed && styles.pressed]}>
              <Text style={styles.smallText}>Cerrar sesión</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <TextInput
            value={user}
            onChangeText={setUser}
            placeholder="Usuario"
            placeholderTextColor={theme.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder="Web API Key"
            placeholderTextColor={theme.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />
          <Pressable onPress={signIn} disabled={busy} style={({ pressed }) => [styles.action, styles.actionOn, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={theme.amber} /> : <Text style={[styles.actionText, styles.actionTextOn]}>Iniciar sesión</Text>}
          </Pressable>
        </View>
      )}
      <Text style={styles.note}>
        La Web API Key está en retroachievements.org → Settings → Keys. Los logros se detectan durante la partida (hash
        compatible con RA) y se muestran como trofeo. Con la Web API Key los desbloqueos se guardan en este iPhone; la
        web de RetroAchievements solo registra los que se hacen con la contraseña de la cuenta.
      </Text>
    </>
  );
}

// ---- Partidas en iCloud Drive ----------------------------------------------------------------------
export function CloudSection() {
  const [info, setInfo] = useState<CloudInfo>(cloudInfo());
  const [auto, setAuto] = useState(cloudAutoSync());
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      subscribeCloud(() => {
        setInfo(cloudInfo());
        setAuto(cloudAutoSync());
      }),
    [],
  );

  const link = () =>
    linkCloudFolder()
      .then((name) => {
        if (name) Alert.alert('Carpeta vinculada', `Las partidas se copiarán en "${name}/JL Emulator Partidas".`);
      })
      .catch((e) => Alert.alert('iCloud Drive', String(e?.message ?? e)));
  const syncAll = () => {
    setBusy(true);
    syncNow('', 'both')
      .then((r) =>
        r.ok
          ? Alert.alert(
              'Sincronizado',
              `Subidos: ${r.pushed ?? 0} · Traídos: ${r.pulled ?? 0}${r.pending ? ` · ${r.pending} descargándose de iCloud (vuelve a sincronizar en un momento)` : ''}`,
            )
          : Alert.alert('No se pudo sincronizar', r.error ?? ''),
      )
      .finally(() => setBusy(false));
  };
  const last = info.lastSync ? new Date(info.lastSync).toLocaleString() : 'nunca';

  return (
    <>
      <Text style={styles.section}>PARTIDAS EN ICLOUD DRIVE</Text>
      {info.linked ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>☁️ {info.name}</Text>
          <Text style={styles.note}>
            {info.available ? `Última sincronización: ${last}` : 'Carpeta no disponible ahora (¿sin conexión?): se juega con la copia local.'}
          </Text>
          <Row
            label="Sincronizar automáticamente"
            note="Al guardar, pausar, cerrar o minimizar un juego, y antes de abrirlo."
            value={auto}
            onChange={setCloudAutoSync}
          />
          <View style={styles.rowGap}>
            <Pressable onPress={syncAll} disabled={busy} style={({ pressed }) => [styles.action, styles.flex, pressed && styles.pressed]}>
              {busy ? <ActivityIndicator color={theme.amber} /> : <Text style={styles.actionText}>Sincronizar todo ahora</Text>}
            </Pressable>
            <Pressable onPress={link} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Text style={styles.actionText}>Cambiar</Text>
            </Pressable>
            <Pressable onPress={unlinkCloudFolder} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Text style={styles.actionText}>Quitar</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={link} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionText}>☁️ Elegir carpeta de iCloud Drive para las partidas</Text>
        </Pressable>
      )}
      <Text style={styles.note}>
        Se copian los guardados nativos (.srm, .sav, memory cards) y las ranuras de estado con sus capturas en "JL
        Emulator Partidas" dentro de la carpeta que elijas (crea una en iCloud Drive). Gana siempre la copia más reciente
        y la local se conserva para jugar sin conexión.
      </Text>
    </>
  );
}

// ---- Experiencia ---------------------------------------------------------------------------------
export function ExperienceSection() {
  const exp = useExperience();
  const [skins, setSkins] = useState(skinsEnabled());
  useEffect(() => subscribeSkins(setSkins), []);
  let liveOk = true;
  try {
    liveOk = Libretro.liveActivityAvailable();
  } catch {
    liveOk = false;
  }
  return (
    <>
      <Text style={styles.section}>EXPERIENCIA</Text>
      <Row
        label="Skins de controles por consola"
        note="SNES, GBA translúcido, DualShock, N64, Arcade… Se ocultan con una transición al conectar un mando."
        value={skins}
        onChange={setSkinsEnabled}
      />
      <Row
        label="Vibración Rumble"
        note="Los juegos que vibran (PS1 con DualShock, N64 con Rumble Pak, GBA) lo hacen en el mando o, sin mando, en el iPhone."
        value={exp.rumble}
        onChange={(v) => setExperience({ rumble: v })}
      />
      {exp.rumble ? (
        <Row
          label="N64: Rumble Pak"
          note="Desactívalo si un juego guarda en el Controller Pak (Mempak)."
          value={exp.n64RumblePak}
          onChange={(v) => setExperience({ n64RumblePak: v })}
        />
      ) : null}
      <Row
        label="Música ambiental (Gaming Mode)"
        note="Suave y retro, generada en el iPhone. Se pausa al jugar o si otra app reproduce audio."
        value={exp.music}
        onChange={(v) => setExperience({ music: v })}
      />
      <Row
        label="Paralaje 3D en carátulas"
        note="Inclina el iPhone en la ficha del juego."
        value={exp.parallax}
        onChange={(v) => setExperience({ parallax: v })}
      />
      <Row
        label="Live Activity de la partida"
        note={
          liveOk
            ? 'Al minimizar el juego: carátula, tiempo de sesión y botones Guardar / Volver en la Dynamic Island y la pantalla de bloqueo.'
            : 'No disponible: necesita iOS 16.2 o superior y las Actividades en directo activadas en Ajustes de iOS → JL Emulator.'
        }
        value={exp.liveActivity}
        onChange={(v) => setExperience({ liveActivity: v })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { color: theme.amber, fontSize: 12, fontWeight: '800', letterSpacing: 2, marginTop: 14 },
  note: { color: theme.textDim, fontSize: 12, lineHeight: 18 },
  card: { padding: 12, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, gap: 8 },
  cardTitle: { color: theme.text, fontWeight: '800', fontSize: 15 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  trophy: { fontSize: 28 },
  input: {
    color: theme.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceHi,
  },
  action: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
  },
  actionOn: { borderColor: theme.amber, backgroundColor: theme.amberDim },
  actionText: { color: theme.text, fontWeight: '800', fontSize: 14 },
  actionTextOn: { color: theme.amber },
  pressed: { opacity: 0.7 },
  rowGap: { flexDirection: 'row', gap: 8 },
  small: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: theme.border },
  smallText: { color: theme.text, fontSize: 12, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  switchLabel: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
