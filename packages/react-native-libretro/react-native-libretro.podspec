require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'react-native-libretro'
  s.version      = package['version']
  s.summary      = 'Host de núcleos Libretro para React Native (Fabric + Metal)'
  s.homepage     = 'https://github.com/jonisral2211-dev/RetroEmu'
  s.license      = { :type => 'MIT' }
  s.authors      = { 'RetroEmu' => '' }
  s.platforms    = { :ios => '15.1' }
  s.source       = { :path => '.' }

  s.source_files        = 'ios/**/*.{h,hpp,m,mm,c,cpp}'
  # LZMA SDK y rcheevos (RetroAchievements, MIT): cabeceras internas, no se exportan
  s.private_header_files = ['ios/lzma/*.h', 'ios/rcheevos/**/*.h']
  s.vendored_frameworks = 'ios/Frameworks/*.framework'
  s.frameworks          = 'Metal', 'MetalKit', 'AudioToolbox', 'AVFoundation', 'GameController', 'CoreHaptics', 'AVKit', 'PhotosUI', 'OpenGLES', 'CoreImage', 'UniformTypeIdentifiers', 'CoreMotion'
  s.libraries           = 'c++', 'z'
  s.requires_arc        = true

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/ios/include" "$(PODS_TARGET_SRCROOT)/ios/rcheevos/include" "$(PODS_TARGET_SRCROOT)/ios/rcheevos/src"',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    # LZMA SDK (ios/lzma): descompresión de .7z, con PPMd y sin código de compresión
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) Z7_PPMD_SUPPORT=1 Z7_EXTRACT_ONLY=1 RC_DISABLE_LUA=1',
  }

  install_modules_dependencies(s)
end
