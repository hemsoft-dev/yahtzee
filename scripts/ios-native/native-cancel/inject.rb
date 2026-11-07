require 'json'
require 'xcodeproj'

project_path, source_path = ARGV
raise 'Expected one generated project and one observer source' unless ARGV.length == 2
expected_source = File.join(File.dirname(File.expand_path(project_path)), 'NativeDiagnostics', 'NativeCancelObserver.mm')
raise 'Observer must be inside the generated project' unless File.expand_path(source_path) == expected_source && File.file?(source_path) && !File.symlink?(source_path)
project = Xcodeproj::Project.open(project_path)
targets = project.targets.select { |target| target.product_type == 'com.apple.product-type.application' }
raise 'Expected exactly one generated application target' unless targets.length == 1
raise 'Existing native diagnostic group was preserved' if project.main_group.children.any? { |g| g.display_name == 'NativeDiagnostics' }
group = project.main_group.new_group('NativeDiagnostics', 'NativeDiagnostics')
reference = group.new_file('NativeCancelObserver.mm')
group.new_file('RuntimeHooks.h')
entry = targets.first.source_build_phase.add_file_reference(reference, true)
entry.settings = { 'COMPILER_FLAGS' => '-fobjc-arc' }
modal = group.new_file('NativeModalObserver.mm')
group.new_file('ModalWindowRuntime.h')
modal_entry = targets.first.source_build_phase.add_file_reference(modal, true)
modal_entry.settings = { 'COMPILER_FLAGS' => '-fobjc-arc' }
framework = project.frameworks_group.new_file('System/Library/Frameworks/QuartzCore.framework', :sdk_root)
targets.first.frameworks_build_phase.add_file_reference(framework, true)
project.save
puts JSON.generate({ added: true, sourceCount: 2 })
