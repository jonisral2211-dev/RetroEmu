import type { HostComponent, ViewProps } from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

export interface NativeProps extends ViewProps {
  /** true = filtro lineal, false = nearest (píxel nítido). */
  filter?: boolean;
}

export default codegenNativeComponent<NativeProps>('LibretroView') as HostComponent<NativeProps>;
