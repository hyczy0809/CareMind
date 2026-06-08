Pod::Spec.new do |s|
  s.name           = 'CaremindGemma'
  s.version        = '0.1.0'
  s.summary        = 'CareMind iOS on-device inference bridge'
  s.description    = 'Local Swift bridge for CareMind iOS privacy-mode model lifecycle and GGUF inference.'
  s.license        = { :type => 'MIT' }
  s.author         = { 'CareMind' => 'caremind@example.com' }
  s.homepage       = 'https://github.com/hyczy0809/CareMind'
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '6.0'
  s.source         = { :git => 'https://github.com/hyczy0809/CareMind.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'LlamaFramework'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
