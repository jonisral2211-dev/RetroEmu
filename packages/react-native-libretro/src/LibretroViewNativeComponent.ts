import type { HostComponent, ViewProps } from 'react-native';
import type { Int32 } from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

export interface NativeProps extends ViewProps {
  /**
   * true = juego 3D: filtro bilineal + realce de nitidez suave.
   * false = juego 2D: "sharp bilinear" (píxel nítido sin dientes de sierra a escala no entera).
   */
  filter?: boolean;
  /** true = estira la imagen a toda la vista ("Expandir"); false = relación de aspecto original. */
  stretch?: boolean;
  /** 0 = imagen completa, 1 = mitad superior, 2 = mitad inferior (pantallas de la DS por separado). */
  region?: Int32;
}

export default codegenNativeComponent<NativeProps>('LibretroView') as HostComponent<NativeProps>;
