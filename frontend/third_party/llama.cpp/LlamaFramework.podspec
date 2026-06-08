Pod::Spec.new do |s|
  s.name           = 'LlamaFramework'
  s.version        = '9558.0'
  s.module_name    = 'llama'
  s.summary        = 'llama.cpp source build for CareMind iOS'
  s.description    = 'Official llama.cpp source build used by CareMind iOS on-device GGUF inference.'
  s.license        = { :type => 'MIT', :file => 'LICENSE' }
  s.author         = { 'ggml-org' => 'https://github.com/ggml-org/llama.cpp' }
  s.homepage       = 'https://github.com/ggml-org/llama.cpp'
  s.platforms      = { :ios => '16.0' }
  s.source         = {
    :git => 'https://github.com/ggml-org/llama.cpp.git',
    :commit => '1705d434f6b3a7bf69763fe9689b790b46253edd'
  }

  s.static_framework = true
  s.source_files = [
    'include/**/*.{h,hpp}',
    'ggml/include/**/*.{h,hpp}',
    'src/**/*.{h,c,cpp}',
    'ggml/src/*.{h,c,cpp}',
    'ggml/src/ggml-cpu/*.{h,c,cpp}',
    'ggml/src/ggml-cpu/amx/*.{h,cpp}',
    'ggml/src/ggml-cpu/arch/arm/*.{h,c,cpp}'
  ]
  s.exclude_files = [
    'ggml/src/ggml-cpu/spacemit/**/*',
    'ggml/src/ggml-cpu/arch/x86/**/*',
    'ggml/src/ggml-cpu/arch/powerpc/**/*',
    'ggml/src/ggml-cpu/arch/riscv/**/*',
    'ggml/src/ggml-cpu/arch/s390x/**/*'
  ]
  s.public_header_files = [
    'include/llama.h',
    'ggml/include/ggml.h',
    'ggml/include/ggml-alloc.h',
    'ggml/include/ggml-backend.h',
    'ggml/include/ggml-cpu.h',
    'ggml/include/ggml-opt.h',
    'ggml/include/gguf.h'
  ]
  s.header_mappings_dir = '.'
  s.frameworks = 'Accelerate', 'Foundation'
  s.libraries = 'c++'
  s.compiler_flags = [
    '-D_DARWIN_C_SOURCE',
    '-DGGML_VERSION=\"9558\"',
    '-DGGML_COMMIT=\"1705d434\"',
    '-DGGML_USE_CPU',
    '-DGGML_USE_ACCELERATE',
    '-DACCELERATE_NEW_LAPACK',
    '-DACCELERATE_LAPACK_ILP64',
    '-Wno-documentation',
    '-Wno-shorten-64-to-32'
  ]
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'ARCHS[sdk=iphonesimulator*]' => 'arm64',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64',
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/include" "${PODS_TARGET_SRCROOT}/ggml/include" "${PODS_TARGET_SRCROOT}/src" "${PODS_TARGET_SRCROOT}/ggml/src" "${PODS_TARGET_SRCROOT}/ggml/src/ggml-cpu"'
  }
end
