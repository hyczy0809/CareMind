# CareMind Track C Edge AI Performance Evidence

Generated: 2026-06-12  
Scope: Android Track C offline demo build, with iOS LiteRT-LM bridge noted where relevant.

This file is intentionally evidence-first. Values are split into:

- **Confirmed from project/build artifacts**: values we can prove from source code or the generated APK.
- **Requires real-device capture**: values that must be measured on the actual judge/demo phone in airplane mode.

## Executive Summary

CareMind's judged Track C path is configured as a fully offline edge-AI demo path. In Track C mode, the app routes smart daily logging, simple communication scripts, safety/crisis checks, and short follow-up summaries to local rules plus on-device Gemma runtime. Cloud adapters still exist for non-demo hybrid builds, but Track C routing short-circuits those calls.

The Android build uses **LiteRT-LM**, not the old MediaPipe LLM Inference API, for `.litertlm` Gemma 4 model execution. The generated APK does **not** bundle the model weights; Gemma 4 E2B/E4B are downloaded or staged as external `.litertlm` files.

## Confirmed Demo Configuration

| Metric | Demo Value | Evidence |
|---|---:|---|
| Demo mode | Track C offline mode enabled by default | `frontend/lib/inference/track-c-demo.ts`; `EXPO_PUBLIC_CAREMIND_TRACK_C_OFFLINE_DEMO` defaults to `1` |
| Android package | `com.caremind.app`, version `0.2.1`, versionCode `3` | `frontend/android/app/build.gradle` |
| Latest APK path | `/Users/lola/Desktop/caremind/CareMind_repo/frontend/android/app/build/outputs/apk/release/app-release.apk` | Built locally on 2026-06-12 |
| APK size | `113 MB` | `ls -lh frontend/android/app/build/outputs/apk/release/app-release.apk` |
| Model bundled in APK | No `.litertlm`, `.task`, `.tflite`, or `.gguf` model found in APK | `unzip -l ... | rg '\\.(litertlm|task|tflite|gguf)'` |
| Android runtime | LiteRT-LM Android | `com.google.ai.edge.litertlm:litertlm-android:0.13.1` in `frontend/android/litertlmbridge/build.gradle` |
| Runtime bridge | Java reflection boundary around LiteRT-LM Engine | `frontend/android/litertlmbridge/src/main/java/com/caremind/litertlmbridge/LiteRtLmBridge.java` |
| Old MediaPipe LLM Inference | Not used for Gemma 4 `.litertlm` execution | Android comments and dependency point to LiteRT-LM; no MediaPipe LLM generation dependency in current runtime path |
| Native libraries in APK | `liblitertlm_jni.so`, `libLiteRt.so`, `libLiteRtClGlAccelerator.so` | `unzip -l app-release.apk` |
| Model format | `.litertlm` only for Android Gemma 4 path | `GemmaEngineHolder.validateModelFile()` rejects non-`.litertlm` files |
| Primary judged model | `gemma-4-E2B-it.litertlm` | `GEMMA_RECOMMENDED_MODEL_ID` and frontend fallback catalog |
| E2B model size | `2,588,147,712 bytes` = `2.59 GB` decimal, `2.41 GiB` binary | model registry and frontend catalog |
| E2B SHA-256 | `181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c` | model registry and frontend catalog |
| E4B candidate | `gemma-4-E4B-it.litertlm` | model registry |
| E4B model size | `3,760,000,000 bytes` = `3.76 GB` decimal, `3.50 GiB` binary | model registry |
| E4B support status | Candidate only; not current default judged path | Android native loader caps loadable model size at `2,900,000,000` bytes, so E4B is intentionally gated |
| Quantization | Unknown for Gemma 4 E2B/E4B in current registry | filename/metadata do not encode `4-bit` or `8-bit`; binary is pinned by checksum |
| Backend preference | `AUTO` tries GPU first, then CPU fallback | `GemmaEngineHolder.backendCandidates(AUTO) -> GPU, CPU` |
| GPU library included | Yes | `libLiteRtClGlAccelerator.so` in APK |
| Memory gate | require at least `1,400,000,000` bytes available memory before load | `GemmaEngineHolder.MIN_AVAILABLE_MEMORY_BYTES` |
| Model load safety gate | max loadable model bytes `2,900,000,000` | `GemmaEngineHolder.MAX_LOADABLE_MODEL_BYTES` |
| Engine reuse | Yes, one loaded engine is cached by model path/backend/token limit | `GemmaEngineHolder.engineRef`, `loadedPathRef`, `loadedBackendRef`, `loadedMaxTokensRef` |
| Main-thread safety | Native init/generation runs in `Dispatchers.IO` | `CaremindGemmaModule.scope = SupervisorJob() + Dispatchers.IO` |
| Stub in release | Disabled | `isStubModeEnabled() = BuildConfig.DEBUG && stubMode.get()`; non-debug `setStubMode` logs disabled |
| Track C stub guard | Smoke test fails if native returns `stub_debug` | `runGemma4E2BSmokePrompt()` throws on `stub_debug` |
| Provenance labels | `native_litertlm_success`, `native_litertlm_parse_fallback`, `rule_local_fallback`, `manual_draft`, `unavailable` | shared provenance + offline verification |

## Current Performance Table

These are the values to show only after a real phone run. They are intentionally not fabricated here because no Android device was connected when this evidence file was generated.

The in-app Track C offline verification panel now exports the same evidence table directly from runtime state: device/OS/RAM, runtime dependency, model id, model format, model size, backend, per-task latency, output hash, output length, and forbidden source checks. Unknown values remain marked as `unknown` or `not measured` instead of being guessed.

| Metric | Demo Value |
|---|---|
| Device | **TBD: capture from real phone** |
| Android version | **TBD: capture from real phone** |
| RAM | **TBD: capture from real phone** |
| Runtime | LiteRT-LM Android `0.13.1` |
| Model | Gemma 4 E2B (`gemma-4-E2B-it.litertlm`) for judged demo |
| Model format | `.litertlm` |
| Quantization | Unknown from current model metadata; checksum-pinned binary |
| Backend | `AUTO`; runtime log must show actual `GPU` or `CPU` |
| Model size | `2,588,147,712 bytes` (`2.59 GB` / `2.41 GiB`) |
| APK size | `113 MB`; model not bundled |
| Smart log latency | **TBD: measured from `latencyMs` in provenance/logcat** |
| Simple communication latency | **TBD: measured from `latencyMs` in provenance/logcat** |
| Short follow-up summary latency | local rule summary; **TBD if measured on UI path** |
| First token latency | **Not instrumented yet**; current LiteRT-LM bridge uses synchronous `sendMessage` + `renderMessageIntoString` and reports total elapsed time |
| Total generation time | **TBD: `CaremindGemma generate done ... elapsedMs=...`** |
| Tokens/sec | **TBD / approximate only** unless LiteRT-LM exposes token count; current bridge logs output length, not exact token count |
| Memory peak | **TBD: use `MEM[...]` log snapshots before load, after load, after generate** |
| Offline verification | Airplane mode + app diagnostic + logcat showing native output hash |

## Required Real-Device Capture

Run this on the demo Android phone after installing the latest APK and placing/downloading `gemma-4-E2B-it.litertlm`.

```bash
/Users/lola/Library/Android/sdk/platform-tools/adb devices
/Users/lola/Library/Android/sdk/platform-tools/adb install -r /Users/lola/Desktop/caremind/CareMind_repo/frontend/android/app/build/outputs/apk/release/app-release.apk
/Users/lola/Library/Android/sdk/platform-tools/adb logcat -c
```

Turn on airplane mode manually from the phone UI. Then open CareMind:

1. Go to local model/privacy settings.
2. Confirm Gemma 4 E2B is `ready`.
3. Tap **运行 Track C 离线验证**.
4. Run:
   - 智能记录
   - 简单话术
   - 本地短复诊摘要
5. Copy the diagnostic report shown in the app.

Collect logcat:

```bash
/Users/lola/Library/Android/sdk/platform-tools/adb logcat -d \
  CaremindGemma:D \
  CaremindGemmaEngine:D \
  ReactNativeJS:I \
  '*:S' > /Users/lola/Desktop/caremind/CareMind_repo/docs/track_c_android_offline_logcat.txt
```

## Positive Evidence Patterns

The logcat evidence should contain these patterns.

```text
CaremindGemma: initEngine name=gemma-4-E2B-it.litertlm ... backend=AUTO ...
CaremindGemmaEngine: LiteRT-LM model resolved path=.../gemma-4-E2B-it.litertlm size=2468MB readable=true
CaremindGemmaEngine: MEM[Pre-load ...]
CaremindGemmaEngine: LiteRT-LM Engine.initialize begin backend=GPU ...
CaremindGemmaEngine: LiteRT-LM engine ready elapsedMs=... runtimeBackend=GPU requestedBackend=AUTO ...
CaremindGemma: generate requestId=... name=gemma-4-E2B-it.litertlm ... promptLen=... backend=AUTO maxTokens=...
CaremindGemma: generate done requestId=... elapsedMs=... outLen=...
ReactNativeJS: [local] care_workflow provenance source=native_litertlm_success model=gemma-4-E2B-it.litertlm backend=GPU nativeAttempted=true nativeReturned=true parse=true rawLen=... rawHash=...
```

If GPU fails and CPU fallback works, that is still valid edge inference:

```text
CaremindGemmaEngine: LiteRT-LM Engine.initialize failed backend=GPU
CaremindGemmaEngine: Retrying LiteRT-LM on CPU after GPU failure.
CaremindGemmaEngine: LiteRT-LM engine ready elapsedMs=... runtimeBackend=CPU requestedBackend=AUTO ...
ReactNativeJS: [local] care_workflow provenance source=native_litertlm_success ... backend=CPU nativeAttempted=true nativeReturned=true ...
```

## Negative Evidence To Avoid

The judged demo path should not contain these as the successful result source:

```text
source=stub_debug
source=demo_mock
source=cloud_26b
source=cloud_31b
cloud fallback
/api/care-workflow
/api/reports/follow-up
```

If native output is returned but schema parsing fails, the acceptable degraded source is:

```text
source=native_litertlm_parse_fallback nativeAttempted=true nativeReturned=true rawHash=...
```

If no native output is returned, the app must not present it as real local model inference:

```text
source=rule_local_fallback
source=unavailable
```

## How We Prove It Is Not Stub Or Mock

1. Release builds disable stub mode because Android native code gates it with `BuildConfig.DEBUG && stubMode.get()`.
2. Track C verification explicitly calls `Gemma.setStubMode(false)`.
3. The Gemma 4 E2B smoke test throws if the native result source is `stub_debug`.
4. The UI/diagnostic report includes:
   - `source`
   - `modelId`
   - `backend`
   - `latencyMs`
   - `engineInitialized`
   - `nativeGenerateAttempted`
   - `nativeGenerateReturned`
   - `rawOutputLength`
   - `rawOutputHash`
   - `parseSucceeded`
   - `fallbackReason`
5. A valid offline run must show `nativeGenerateAttempted=true`, `nativeGenerateReturned=true`, non-zero `rawOutputLength`, and non-empty `rawOutputHash`.

## Known Gaps Before Final Judge Demo

- No Android phone was connected during this file generation, so device model, RAM, Android version, actual backend, memory peak, total latency, and throughput are still **not measured**.
- First-token latency is not currently available because the Android bridge uses blocking LiteRT-LM conversation generation. We can report total generation latency now; first-token latency needs streaming callback support or a lower-level runtime hook.
- Exact token/sec is not currently reliable because the bridge does not receive token count from LiteRT-LM. We can report output chars/sec or add tokenization support if the runtime exposes token IDs.
- Gemma 4 E2B/E4B quantization is not stated in current metadata. Do not claim `4-bit` or `8-bit` unless the source model card or LiteRT-LM metadata confirms it.
- E4B is a registry candidate but not the safe default on current Android build because the native loader caps loadable model size at `2.9 GB`; demo should use E2B unless this gate is deliberately changed and tested on an 8GB+ device.

## Final One-Line Claim For Slides

CareMind Track C demo runs Gemma 4 E2B fully offline through LiteRT-LM `.litertlm` on Android, with model weights downloaded outside the APK, GPU-first/CPU-fallback local execution, release-mode stub disabled, and provenance logs proving native generation via non-empty output hash in airplane mode.
