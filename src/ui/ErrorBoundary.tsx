import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

type Props = { children: React.ReactNode; onExit: () => void };
type State = { error: string | null };

// Si la pantalla del emulador falla en JavaScript, se muestra el motivo en lugar de cerrar la app
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: String((error as Error)?.message ?? error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[JL] fallo al abrir el juego', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>No se pudo abrir el juego</Text>
        <Text style={styles.msg} selectable>
          {this.state.error}
        </Text>
        <Pressable
          onPress={() => {
            this.setState({ error: null });
            this.props.onExit();
          }}
          style={styles.btn}>
          <Text style={styles.btnText}>Volver a la biblioteca</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  msg: { color: theme.danger, fontSize: 13, textAlign: 'center' },
  btn: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: theme.amber },
  btnText: { color: theme.amber, fontWeight: '800' },
});
