import type { HostComponent, ViewProps } from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

export interface NativeProps extends ViewProps {
  /**
   * true = juego 3D: filtro bilineal + realce de nitidez suave.
   * false = juego 2D: "sharp bilinear" (píxel nítido sin dientes de sierra a escala no entera).
   */
  filter?: boolean;
  /** true = estira la imagen a toda la vista ("Expandir"); false = relación de aspecto original. */
  stretch?: boolean;
}

export default codegenNativeComponent<NativeProps>('LibretroView') as HostComponent<NativeProps>;
