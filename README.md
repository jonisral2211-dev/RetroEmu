# RetroEmu

Emulador retro para iPhone: React Native (New Architecture) como UI, núcleos de Libretro
(mGBA, Genesis Plus GX, Mupen64Plus-Next) en C/C++ y render nativo con Metal.

> Solo para ROMs que tengas legalmente (volcadas de tus propios cartuchos). La app no incluye ni descarga juegos.

## Estructura

```
index.js / src/             UI React Native (biblioteca, reproductor, pad táctil)
packages/react-native-libretro/
  src/                      TurboModule (NativeLibretro.ts) y componente Fabric (LibretroView)
  ios/                      Host C++ (LibretroHost, AudioOutput), Metal (LibretroView.mm), TurboModule (LibretroModule.mm)
scripts/                    cores.lock, build de cores, generación de ios/, empaquetado .ipa
ios-overlay/Podfile         Podfile propio (se copia a ios/ al generar el proyecto)
.github/workflows/          CI: compila el .ipa sin firmar en macos-latest
```

`ios/` no está en el repo: se genera en CI con la plantilla de React Native 0.76.9.

## Compilar en la nube (GitHub Actions)

1. Crea un repositorio **privado** en GitHub y sube este proyecto:
   ```bash
   git add . && git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/RetroEmu.git
   git push -u origin main
   ```
2. Ve a **Actions → iOS unsigned IPA → Run workflow**.
3. Al terminar, descarga el artifact **RetroEmu-unsigned-ipa** (`RetroEmu-unsigned.ipa`).

## Instalar en el iPhone con Sideloadly (Windows)

1. Instala Sideloadly y, si te lo pide, iTunes/iCloud de Apple desde la web oficial de Apple (no desde Microsoft Store).
2. Conecta el iPhone por cable, confía en el ordenador y activa **Modo desarrollador** (Ajustes → Privacidad y seguridad → Modo desarrollador; iOS 16+).
3. En Sideloadly: arrastra `RetroEmu-unsigned.ipa`, introduce tu Apple ID y pulsa **Start**.
4. En el iPhone: Ajustes → General → VPN y gestión de dispositivos → confía en tu Apple ID.
5. Copia tus ROMs: abre **Archivos → En mi iPhone → RetroEmu** y pega los archivos (`.gba`, `.md`, `.z64`…). Luego pulsa *Actualizar* en la app.

Notas de cuenta gratuita de Apple: la firma caduca a los 7 días (vuelve a instalar con Sideloadly) y hay un límite de apps sideloaded a la vez.

## Estado actual

- **Core activo:** mGBA (Game Boy / GBA). Genesis Plus GX y Mupen64Plus-Next están en `scripts/cores.lock` con `enabled=false` hasta verificar su build para iOS.
- **Sin verificar:** el código se escribió sin compilar. La primera ejecución de CI probablemente necesite ajustes (flags de make de cada core, nombre del binario producido, versiones de CocoaPods).
- **Pendiente:** fijar cada core y `libretro.h` a un commit concreto (ahora apuntan a `master`).
- **Limitaciones conocidas:** el sincronismo audio/vídeo va por reloj (sin *audio-driven timing*); la SRAM se guarda al parar el juego, no periódicamente.
