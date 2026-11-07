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
  s.vendored_frameworks = 'ios/Frameworks/*.framework'
  s.frameworks          = 'Metal', 'MetalKit', 'AudioToolbox', 'AVFoundation', 'GameController'
  s.libraries           = 'c++', 'z'
  s.requires_arc        = true

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/ios/include"',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
  }

  install_modules_dependencies(s)
end
