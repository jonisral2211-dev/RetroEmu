# Añade al proyecto generado (ios/RetroEmu.xcodeproj) la extensión de widgets JLLiveActivity
# (Live Activity: Dynamic Island y pantalla de bloqueo) y el puente Swift en el target de la app.
#
# Bundle ID: el de la app NO se toca (lo pone la plantilla de React Native:
# org.reactjs.native.example.RetroEmu). La extensión usa <bundle de la app>.LiveActivity, el
# sufijo que exige iOS para extensiones embebidas; SideStore la firma junto con la app.
#
# Uso: ruby scripts/add-live-activity.rb ios/RetroEmu.xcodeproj ios-overlay/LiveActivity
require 'xcodeproj'
require 'fileutils'

project_path = ARGV[0] or abort('falta la ruta del .xcodeproj')
overlay = File.expand_path(ARGV[1] || 'ios-overlay/LiveActivity')
ios_dir = File.dirname(File.expand_path(project_path))

project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == 'RetroEmu' } or abort('no se encontró el target RetroEmu')

if project.targets.any? { |t| t.name == 'JLLiveActivity' }
  puts 'JLLiveActivity ya existe; nada que hacer'
  exit 0
end

# Bundle ID resuelto de la app (la plantilla usa $(PRODUCT_NAME:rfc1034identifier))
app_release = app.build_configurations.find { |c| c.name == 'Release' } || app.build_configurations.first
raw_id = app_release.build_settings['PRODUCT_BUNDLE_IDENTIFIER'].to_s
product_name = app_release.build_settings['PRODUCT_NAME'].to_s
product_name = 'RetroEmu' if product_name.empty? || product_name.include?('$(')
app_id = raw_id.gsub('$(PRODUCT_NAME:rfc1034identifier)', product_name.gsub(/[^A-Za-z0-9.-]/, '-'))
app_id = 'org.reactjs.native.example.RetroEmu' if app_id.empty? || app_id.include?('$(')
ext_id = "#{app_id}.LiveActivity"
puts "Bundle ID app: #{app_id} -> extensión: #{ext_id}"

# Copiar los fuentes junto al proyecto
dest = File.join(ios_dir, 'JLLiveActivity')
FileUtils.mkdir_p(dest)
%w[JLGameAttributes.swift JLLiveActivityWidget.swift JLLiveActivityBridge.swift Info.plist].each do |f|
  FileUtils.cp(File.join(overlay, f), File.join(dest, f))
end

group = project.main_group.new_group('JLLiveActivity', 'JLLiveActivity')
attrs_ref = group.new_reference('JLGameAttributes.swift')
widget_ref = group.new_reference('JLLiveActivityWidget.swift')
bridge_ref = group.new_reference('JLLiveActivityBridge.swift')
group.new_reference('Info.plist')

# ---- Target de la extensión ------------------------------------------------------------------
ext = project.new_target(:app_extension, 'JLLiveActivity', :ios, '16.2', nil, :swift)
ext.add_file_references([attrs_ref, widget_ref])
%w[WidgetKit SwiftUI ActivityKit].each do |fw|
  ref = project.frameworks_group.new_file("System/Library/Frameworks/#{fw}.framework", :sdk_root)
  ext.frameworks_build_phase.add_file_reference(ref, true)
end

marketing = app_release.build_settings['MARKETING_VERSION'] || '1.0'
build_num = app_release.build_settings['CURRENT_PROJECT_VERSION'] || '1'
ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = ext_id
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'JLLiveActivity/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['MARKETING_VERSION'] = marketing
  s['CURRENT_PROJECT_VERSION'] = build_num
  s['SKIP_INSTALL'] = 'YES'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['ENABLE_BITCODE'] = 'NO'
  s['SWIFT_EMIT_LOC_STRINGS'] = 'NO'
  s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = ''
  s['ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME'] = ''
end

# ---- Target de la app: puente Swift + embebido de la extensión ----------------------------------
app.add_file_references([attrs_ref, bridge_ref])
app.build_configurations.each do |c|
  s = c.build_settings
  s['SWIFT_VERSION'] ||= '5.0'
  # La app sigue siendo iOS 15.1: ActivityKit se enlaza débil (solo se usa en iOS 16.2+)
  flags = s['OTHER_LDFLAGS']
  flags = flags.nil? ? ['$(inherited)'] : Array(flags)
  flags += ['-weak_framework', 'ActivityKit'] unless flags.include?('ActivityKit')
  s['OTHER_LDFLAGS'] = flags
end

embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' || p.name == 'Embed App Extensions' }
embed ||= app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
build_file = embed.add_file_reference(ext.product_reference, true)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
# Justo después de "Copy Bundle Resources": detrás de las fases de script provoca ciclos en Xcode
app.build_phases.delete(embed)
app.build_phases.insert(app.build_phases.index(app.resources_build_phase) + 1, embed)
app.add_dependency(ext)

project.save
puts 'JLLiveActivity añadida al proyecto'
