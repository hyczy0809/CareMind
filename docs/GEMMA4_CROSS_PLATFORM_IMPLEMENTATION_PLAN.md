# CareMind Gemma 4 Cross-Platform Implementation Plan

Date: 2026-06-12
Scope: Android, iOS, backend, AI routing, document parsing, safety, privacy, and release readiness.

This plan improves the existing CareMind architecture rather than replacing it. The product should keep the current Expo/React Native shell, FastAPI backend, ADK-style cloud agents, native iOS/Android local model bridges, document review flow, and conservative medical-safety posture.

## Phase 0-2 Implementation Status

Status as of 2026-06-12:

- Phase 0 is complete for the implementation-plan layer: this document defines the official support boundary, shared intent/model-profile vocabulary, privacy policy shape, runtime status shape, and phase-level acceptance criteria.
- Phase 1 is complete at the routing-abstraction layer: frontend and backend now have mirrored deterministic model-profile routing contracts, including local-first consent behavior, timeout policy, cloud fallback policy, Android AICore optional boundary, and backend `classify_caremind_intent` model-routing metadata.
- Phase 2A is complete at the shared mobile facade layer: frontend product code can call a platform-neutral mobile runtime facade for model availability, runtime initialization status, generation, cancellation, and timeout handling.
- Phase 2B is simulator-build verified: iOS continues to use the existing Swift native bridge behind the new facade, with LiteRT-LM Swift treated as Early Preview. `xcodebuild` Debug simulator build passed on iPhone 17 / iOS 26.5. Real-device E2B smoke testing is still required.
- Phase 2C is implementation-ready rather than build-verified: Android continues to use the existing Kotlin native bridge/downloader behind the new facade. Gradle/device validation is blocked in the current environment until Java/JDK is installed and configured.

## Phase 3-5 Implementation Status

Status as of 2026-06-12:

- Phase 3 is complete at the shared contract and safe fallback layer. Backend and local mobile structuring now return `field_confidence`, `low_confidence_fields`, `notes_for_caregiver`, and `diagnostic_risk` on `StructuredLogV2`. Diagnostic-risk text is retained as caregiver-facing observation metadata rather than a medical conclusion.
- Phase 4 is complete at the backend pipeline contract and deterministic fallback layer. `FollowupSummaryRequest` now accepts structured care logs, daily metrics, caregiver trend, document images, cloud consent, raw-text policy, full-window requirement, and optional English key phrases. `FollowupSummaryResponse` now returns `summary_zh`, `source_window_days`, unreadable-document markers, safety flags, model profile, and input bundle overview.
- Phase 4 cloud provider integration remains behind the adapter boundary. The current implementation does not pretend to call a real Gemma 4 26B/31B provider; it produces schema-valid safe output using the existing backend service until provider credentials and API shape are confirmed.
- Phase 5 is complete at the document parsing contract and safe manual fallback layer. Document parsing now returns parse quality, doctor-review-needed status, medical-term candidates, safety flags, model profile, multimodal-attempt marker, and family-confirmation requirement.
- Phase 5 multimodal model execution remains provider-gated. Until cloud Gemma 4 multimodal is configured, the backend marks `multimodal_attempted: false` and `model_profile: deterministic_fallback`, while still handling blurry/incomplete/unsupported files safely.
- Verified commands:
  - `python -m unittest tests.test_gemma4_phase3_5_contracts`
  - `python -m unittest`
  - `cd frontend && npm run typecheck`

## Phase 6-8 Implementation Status

Status as of 2026-06-12:

- Phase 6 is complete at the mobile policy-enforcement layer. Local-first mode now keeps daily logs and guardrail checks on the local path when possible, blocks raw document upload/parse cloud calls unless the user explicitly consents, and requires explicit cloud-summary consent before sending raw follow-up context. Consent and blocked-network telemetry uses metadata only, not raw text or file content.
- Phase 6 keeps the existing caregiver workflow instead of replacing it. The follow-up prep screen now surfaces cloud-processing consent at the point of upload and summary generation, while the API facade also enforces the same rule so UI bypasses do not silently upload files in local-first mode.
- Phase 7 is complete for the checks available in the current environment. Backend contract tests pass, the full Python unittest suite passes, frontend TypeScript typecheck passes, and the iOS Debug simulator build passes on iPhone 17 / iOS 26.5.
- Phase 7 Android validation has a precise environment blocker: `./gradlew :app:assembleDebug` cannot run because this machine has no Java Runtime installed. Android product code and Gradle files were not rewritten as part of this phase.
- Phase 8 iOS archive and TestFlight upload readiness is complete for build `0.2.1 (8)`. The first upload attempt for build `7` was rejected because that build number had already been used, so the iOS build number was incremented to `8`, a new Release `iphoneos` archive was created at `/Users/lola/Desktop/caremind/CareMind_repo/frontend/artifacts/ios/CareMind-0.2.1-ios-b8-20260612-1159.xcarchive`, and App Store Connect returned `Upload succeeded`.
- Phase 8 App Store Connect processing is now Apple-side. The upload event recorded `uploadedBuildNumber: 8`, `state: success`, and `title: Uploaded to Apple`. TestFlight availability can still require Apple processing time and any manual App Store Connect compliance prompts.
- Verified commands:
  - `python -m unittest tests.test_gemma4_phase3_5_contracts`
  - `python -m unittest`
  - `cd frontend && npm run typecheck`
  - `cd frontend && xcodebuild -workspace ios/CareMind.xcworkspace -scheme CareMind -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' build`
  - `cd frontend/android && ./gradlew :app:assembleDebug` blocked by missing Java Runtime
  - `cd frontend && xcodebuild -workspace ios/CareMind.xcworkspace -scheme CareMind -configuration Release -sdk iphoneos -archivePath artifacts/ios/CareMind-0.2.1-ios-b8-20260612-1159.xcarchive archive`
  - `cd frontend && xcodebuild -exportArchive -archivePath artifacts/ios/CareMind-0.2.1-ios-b8-20260612-1159.xcarchive -exportPath artifacts/ios/upload-b8-20260612-120330 -exportOptionsPlist artifacts/ios/ExportOptions-AppStoreConnectUpload.plist -allowProvisioningUpdates`

## Official Support Boundary

This plan follows the current public Google AI Edge direction for Gemma 4 mobile deployment:

- The mobile on-device baseline is LiteRT-LM. Google documents LiteRT-LM as the edge runtime path for Android, iOS, Web, Desktop, and IoT, with Gemma 4 E2B/E4B model support and CPU/GPU acceleration. Reference: [LiteRT-LM Overview](https://ai.google.dev/edge/litert-lm/overview).
- Android is the more mature native route today because the LiteRT-LM Kotlin API is marked Stable. The Android plan should use the existing Kotlin/MediaPipe native module as the current base while converging toward a clean LiteRT-LM adapter boundary.
- iOS is supported, but the LiteRT-LM Swift API is marked Early Preview. The iOS plan is suitable for PoC, pilot, and controlled rollout, with explicit API-change and runtime-stability risk management.
- Android should also reserve an optional AICore / ML Kit GenAI route for eligible devices and use cases. This is an Android system-level GenAI capability and should be treated as an optional provider path, not as the cross-platform Gemma 4 LiteRT-LM baseline. Reference: [Gemini Nano and AICore](https://developer.android.com/ai/gemini-nano).
- Cloud-side Gemma 4 26B/31B is CareMind's product-level enhancement layer. It is not part of the Android/iOS on-device runtime framework. It should be isolated behind a provider adapter.
- Multimodal document organization is a CareMind business workflow built on top of Gemma 4 multimodal capability. The official runtime does not provide a complete doctor-review document workflow out of the box.
- Existing MediaPipe LLM Inference mobile APIs are documented as deprecated for Android/iOS with migration guidance toward LiteRT-LM. Reference: [MediaPipe LLM Inference Guide](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference).

## 1. Current-State Findings

### Existing Relevant Files and Modules

- Product docs:
  - `/Users/lola/Desktop/caremind/CareMind_PRD_v0.2_Complete.md`
  - `/Users/lola/Desktop/caremind/CareMind_repo/docs/PRD.md`
  - `/Users/lola/Desktop/caremind/implementation plan.md`
  - `/Users/lola/Desktop/caremind/CareMind_repo/docs/ios-edge-architecture.md`
- Backend/API:
  - `/Users/lola/Desktop/caremind/CareMind_repo/main.py`
  - `/Users/lola/Desktop/caremind/CareMind_repo/my_agent/`
- Mobile app:
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/ios/`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/android/`
- iOS native local model bridge:
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/modules/caremind-ios-gemma/ios/CaremindGemmaModule.swift`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/modules/caremind-ios-gemma/ios/CaremindGemma.podspec`
- Android native local model bridge:
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/android/app/src/main/java/com/caremind/app/gemma/CaremindGemmaModule.kt`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/android/app/src/main/java/com/caremind/app/gemma/GemmaEngineHolder.kt`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/android/app/src/main/java/com/caremind/app/gemma/GemmaModelDownloader.kt`
- Frontend inference:
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/lib/inference/inference-router.ts`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/lib/inference/privacy-mode.ts`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/lib/inference/local/`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/lib/inference/shared/`
- Document upload/review:
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/components/followup/FollowupPrepScreen.tsx`
  - `/Users/lola/Desktop/caremind/CareMind_repo/frontend/lib/care-workflow-api.ts`

### Current AI Architecture

- Backend uses a root orchestrator plus specialist agents in `my_agent/cloud_agents.py`.
- Existing specialist concepts already map well to the new plan: event structuring, patient risk, caregiver support, care plan, doctor summary.
- Intent classification already exists in `my_agent/agent_trigger_router.py`, including daily log, communication, follow-up, follow-up document, caregiver support, medical boundary, crisis, onboarding, and today care.
- Current cloud model selection is centralized in `my_agent/model_config.py`, but it is still close to a single-model adapter. It does not yet represent Gemma 4 E2B/E4B/26B/31B as explicit profiles.
- Frontend inference routing currently chooses local vs cloud based mainly on privacy mode and local model readiness. It does not yet return a typed routing decision with intent, model profile, timeout, fallback, consent, and telemetry reason.

### Current Backend Architecture

- Backend is FastAPI with endpoints for care workflow, follow-up summaries, guardrails, document upload/parse/review/delete, model catalog/download, telemetry, and OpenAI-compatible chat.
- Follow-up summary currently assembles typed output from care context, attention items, memory, and confirmed documents. It is not yet a long-context multimodal model pipeline.
- Document parse currently uses conservative metadata/template logic. It does not inspect real PDF/image content with multimodal inference.
- Backend model registry already references Gemma 4 E2B/E4B LiteRT-LM assets for mobile distribution, which is a useful foundation.

### Current iOS Architecture

- Xcode workspace exists at `frontend/ios/CareMind.xcworkspace`.
- Scheme `CareMind` is detectable through `xcodebuild -list`.
- Current observed settings include bundle id `com.caremind.app`, version `0.2.1`, build `7`, iOS deployment target `16.0`, and supported iPhone simulator/device platforms.
- Native Swift bridge already chooses a LiteRT-LM path for `.litertlm` files and a llama/GGUF fallback path where configured.
- LiteRT-LM vendor artifacts exist under `frontend/vendor/litert-lm/`.
- The implementation plan must treat iOS LiteRT-LM Swift as Early Preview and add explicit risk handling for API changes, runtime initialization failure, memory pressure, and unsupported devices.

### Current Android Architecture

- Android app exists under `frontend/android`.
- Package id is `com.caremind.app`.
- Current Gradle setup uses Kotlin and MediaPipe GenAI dependency `com.google.mediapipe:tasks-genai:0.10.35`.
- Native module already supports model download, model deletion, runtime info, init, generation, audio generation surface, cancellation, and stub mode.
- `GemmaEngineHolder.kt` centralizes model initialization and generation with backend selection and memory checks.
- `GemmaModelDownloader.kt` supports model download, checksum, resume/cancel, disk checks, private app storage, and debug model path `/data/local/tmp/llm/gemma.litertlm`.
- Gradle build could not be validated in the current environment because Java/JDK is missing.

### Current Document Upload / Report Parsing Flow

- Frontend supports PDF/JPG/PNG/DOCX selection and upload.
- Backend supports upload, parse, review confirmation, and delete.
- Family confirmation already exists and should be preserved.
- Current parse result lacks multimodal extraction, image-quality status, doctor-review-needed marking, medical-term candidates, and model profile metadata.

### Current Tests / Build Commands

Commands already checked:

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo
python -m unittest tests.test_agent_trigger_routing
```

Result: passed, 15 tests.

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend
npm run typecheck
```

Result: passed.

Useful commands to keep:

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo
uvicorn main:app --host 127.0.0.1 --port 8090
```

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend
xcodebuild -workspace ios/CareMind.xcworkspace -scheme CareMind -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' build
```

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend/android
./gradlew :app:assembleDebug
```

Android command is currently blocked until Java/JDK is installed or configured.

### Current Deployment Setup

- iOS archives/export options exist under frontend artifacts, but App Store Connect/TestFlight credentials must not be assumed.
- Android APK artifacts exist, but no production keystore, AAB, or Play Console credentials were found. Current release signing appears to rely on debug signing and is not Play-ready.
- Backend has Docker/Cloud Run style deployment support, but the cloud Gemma 4 26B/31B provider remains ambiguous.

## 2. Gap Analysis

### What Already Exists

- Expo/React Native mobile app with both iOS and Android native code.
- Native local model bridges on both platforms.
- Model catalog and model download foundation.
- Backend orchestrator and specialist-agent shape.
- Deterministic intent classification.
- Guardrail endpoint and local safety fallback.
- Document upload and family confirmation flow.
- Privacy mode foundation.
- Basic backend tests and frontend TypeScript validation.

### What Needs To Change

- Introduce explicit model profiles for on-device E2B/E4B and cloud 26B/31B.
- Add shared `RoutingDecision` contract used consistently by frontend, iOS, Android, and backend.
- Add platform runtime availability checks and model initialization status.
- Enforce 4-second on-device fallback policy only when privacy/local-first mode allows cloud fallback.
- Move follow-up summary generation to a long-context, multimodal backend pipeline.
- Replace template-only report parsing with a multimodal organization pipeline when user consent permits.
- Add degraded-image behavior: unreadable, partially readable, doctor-review-needed.
- Add structured output validation for logs, summaries, safety, and document parsing.
- Add telemetry that records routing decisions without raw medical content.

### What Should Not Change

- Do not rewrite the app shell or backend framework.
- Do not remove existing deterministic fallbacks.
- Do not skip family confirmation for document parse results.
- Do not make cloud processing mandatory for local-first users.
- Do not assume App Store Connect, TestFlight, Google Play, release keystore, or cloud provider credentials exist.

### What Is Missing For iOS

- Verified real-device Gemma 4 E2B smoke test.
- Early Preview risk tracking for LiteRT-LM Swift.
- Product-facing wrapper contract that hides Swift/runtime details from app logic.
- Explicit error mapping for model missing, init failure, memory pressure, timeout, and unsupported device.
- Model download/onboarding decision for large `.litertlm` files.

### What Is Missing For Android

- Local Java/JDK setup for Gradle validation.
- Verified real-device Gemma 4 E2B smoke test.
- Production signing config and Play-ready AAB path.
- Optional AICore / ML Kit provider evaluation for eligible devices and use cases.
- E4B gating rules based on memory, storage, backend support, and latency.

### What Is Missing For Cloud Gemma 4 26B/31B

- Provider choice and environment variables.
- Text and multimodal adapter boundary.
- Prompt/version registry.
- Request/response schema validation.
- Safety post-processing.
- Degraded document image handling.
- Persistent document storage strategy for production if local `/tmp` storage remains insufficient.

## 3. Proposed Target Architecture

### LLM Capability Layering

On-device Gemma 4 E2B/E4B:

- Simple natural language to structured daily logs.
- Short/simple communication phrasing.
- Basic crisis and medical-boundary keyword detection.
- Weak/offline summaries over recent cached logs.
- Local-first privacy mode tasks.

Cloud Gemma 4 26B/31B:

- 7/30 day follow-up summaries.
- Long-context synthesis over care logs, metrics, caregiver trends, and confirmed documents.
- Multimodal reasoning over PDF/image/report screenshots when user consent permits.
- Complex communication phrasing.
- Complex medical-adjacent boundary explanations.

CareMind deterministic fallback:

- Crisis templates.
- Medical boundary refusal templates.
- Cached log summaries.
- Manual document entry and family confirmation.

### Shared Intent Routing / Model Profile System

Add a shared router in frontend and a mirrored backend router:

- Input: intent, platform, privacy config, model availability, network state, user consent, complexity level.
- Output: routing decision with selected profile, timeout, fallback profile, consent requirement, and telemetry reason.
- Runtime adapters execute the decision without leaking platform details into product flows.

### Shared Structured Output Contracts

All AI outputs should be schema-validated before use. Local model XML or relaxed text can remain an internal implementation detail only if it is normalized into the shared JSON contracts before reaching product logic.

### Shared Safety / Medical-Boundary Guardrails

- Pre-check input for crisis and medical-adjacent risk.
- Post-check model output for diagnosis-like claims.
- Isolate diagnostic-risk content into safe fields.
- Do not allow a single report parse to infer diagnosis, disease direction, worsening, or improvement.

### Shared Privacy / Local-First Policy

- Local-first mode is a policy object, not just a UI toggle.
- Raw text and files stay local unless the user explicitly confirms cloud processing.
- Structured metrics may upload if allowed by policy.
- Cloud summaries require explicit confirmation in local-first mode.

### iOS LiteRT-LM Swift Runtime Adapter

- Keep existing native bridge.
- Add stable product-facing interface.
- Treat Swift API as Early Preview and isolate it behind adapter boundaries.
- Support Gemma 4 E2B first.
- Prepare E4B as optional only after device capability checks.

### Android Runtime Adapter

- Keep existing Kotlin native module and downloader.
- Use LiteRT-LM-compatible model assets as the common baseline.
- Evaluate AICore / ML Kit as optional Android-only provider where available.
- Support Gemma 4 E2B first.
- Gate E4B by device memory, storage, backend, and measured latency.

### Cloud Gemma 4 26B/31B Adapter Boundary

- Add a provider interface independent of the current default cloud model.
- Support text generation and multimodal document requests.
- Add prompt registry, schema validation, safety post-check, timeout, and telemetry.
- Keep provider choice configurable.

### Multimodal Document Pipeline

- Upload stores file metadata and user summary.
- If user permits cloud parsing, backend sends PDF/image or rendered pages to cloud Gemma 4 multimodal adapter.
- Extract document type, date, title, 1-3 communication points, and medical-term explanation candidates.
- Return parse quality: readable, partially_readable, unreadable, unsupported.
- Mark blurry/incomplete reports as doctor-review-needed.
- Family caregiver must confirm before document content influences follow-up summary.
- Manual fallback remains available.

### Telemetry and Observability

Track:

- Intent, selected model profile, platform, availability result.
- Fallback reason, timeout, latency bucket.
- Parse quality and confirmation status.
- Safety category and whether output was blocked or rewritten.

Do not track:

- Raw medical notes.
- Raw document images.
- Full model prompts.
- Full model outputs in local-first mode.

## 4. Model Routing Table

| Intent | Default model profile | iOS on-device support | Android on-device support | Cloud support | Fallback behavior | Timeout limit | Privacy/local-first behavior | Required tests |
|---|---|---:|---:|---:|---|---:|---|---|
| `daily_log` | `on_device_e2b` | Yes, Early Preview runtime risk | Yes, Stable Kotlin route | Yes | Cloud if privacy allows; deterministic fallback otherwise | 4s local | Local first; upload structured metrics only | JSON schema, confidence, fallback |
| `communication_simple` | `on_device_e2b` | Yes | Yes | Yes | Cloud if allowed; template if blocked | 4s local | Local preferred | Tone, safety, timeout |
| `communication_complex` | `cloud_26b_or_31b` | No default | No default | Yes | Safe template if offline/no consent | 10s cloud | Explicit cloud confirmation in local-first | Boundary, family-context |
| `caregiver_support` | `configurable_local_or_cloud` | Yes | Yes | Yes | Based on device/privacy/network | 4s local, 10s cloud | Local preferred; cloud by consent | Privacy, fallback |
| `follow_up_summary` | `cloud_31b_long_context` | Local cached fallback only | Local cached fallback only | Yes | Cached local summary if offline/no consent | 10s target | Cloud requires confirmation | 7/30 day summary, safety |
| `followup_document` | `cloud_26b_multimodal` | Local metadata/manual fallback | Local metadata/manual fallback | Yes | Manual entry if parse fails/no consent | 15s cloud | File stays local unless confirmed | Clear/blurry/incomplete files |
| `medical_boundary` | `on_device_e2b_simple` then cloud for complex | Yes | Yes | Yes | Safe refusal template | 4s local, 8s cloud | Local first | Diagnostic-risk cases |
| `crisis` | `local_detector` plus optional cloud help text | Yes | Yes | Yes | Immediate emergency template | Immediate local | Local detector always runs | Crisis keywords, blocked outputs |
| `offline_summary` | `on_device_e2b` | Yes | Yes | No | Deterministic cached summary | 4s local | Local only | Weak-network behavior |
| `android_system_prompt` | `android_aicore_optional` | N/A | Optional eligible devices | No | Fall back to LiteRT-LM provider | TBD after probe | Local only | Availability, provider parity |

## 5. Phased Implementation

### Phase 0: Docs / Contracts / Schema Updates Only

- Add this implementation plan.
- Update PRD architecture section with LLM capability layering and model-routing table.
- Define shared contracts for intent, model profile, routing decision, safety result, local-first config, and model availability.
- Document official support boundary:
  - Android LiteRT-LM Kotlin: stable.
  - iOS LiteRT-LM Swift: Early Preview.
  - Android AICore / ML Kit: optional system-level route.
  - Cloud 26B/31B: CareMind product extension.

Acceptance:

- Docs are reviewed.
- No product behavior changes.
- Existing tests still pass.

### Phase 1: Shared Model Profile + Orchestrator Routing Abstraction

- Implement shared TS routing module and mirrored Python contract.
- Extend backend intent handling to include selected model profile and fallback.
- Add 4s local timeout policy.
- Add telemetry fields for routing decisions.

Acceptance:

- Routing tests cover all intent rows.
- Privacy/local-first cases block cloud fallback unless consent exists.

### Phase 2A: Shared Mobile Runtime Interface For On-Device LLM

- Define one product-facing mobile runtime interface:
  - `getAvailability()`
  - `initialize(modelId)`
  - `generate(request)`
  - `cancel()`
  - `getRuntimeStatus()`
- Normalize errors across iOS and Android.
- Keep platform-specific details inside adapters.

Acceptance:

- Product logic can call the same interface on both platforms.
- Mock runtime can be used in CI.

### Phase 2B: iOS LiteRT-LM Swift Runtime Wrapper For Gemma 4 E2B/E4B

- Keep existing Swift module.
- Add explicit Early Preview guardrails.
- Run E2B first.
- Prepare E4B support behind capability gates.
- Add timeout, memory pressure, init failure, missing model, and unsupported-device error states.
- Prefer model download/onboarding over bundling if package size is too large.

Acceptance:

- Simulator build succeeds.
- Real-device E2B smoke test passes or returns precise blocker.

### Phase 2C: Android LiteRT-LM Runtime Wrapper For Gemma 4 E2B/E4B

- Keep existing Kotlin module and downloader.
- Add shared runtime adapter layer.
- Run E2B first.
- Add E4B only behind high-memory and storage gating.
- Evaluate AICore / ML Kit as optional Android provider after baseline E2B is stable.
- Install/configure JDK before Gradle validation.

Acceptance:

- Emulator build succeeds after JDK setup.
- Real-device E2B smoke test passes or returns precise blocker.

### Phase 3: Daily Log Local Structuring + Fallback On Both Platforms

- Route `daily_log` to on-device E2B first.
- Validate complete JSON output.
- Use `null` for missing fields.
- Add confidence per field.
- Add `low_confidence_fields`.
- Route diagnostic-risk text into `notes_for_caregiver` with `diagnostic_risk: true`.
- Cloud fallback only when privacy policy allows.

Acceptance:

- Same JSON contract on iOS, Android, and backend.
- Diagnostic-risk fields are safely filtered or displayed.

### Phase 4: Follow-Up Summary Long-Context / Multimodal Backend Pipeline

- Build summary request from:
  - structured care logs
  - daily metrics
  - caregiver daily metrics trend
  - confirmed follow-up documents
  - document text/images when permitted
- Prompt must explicitly use the full selected 7/30 day window.
- Output 600-800 Chinese characters.
- Judgmental statements must use subjects like `家属记录`, `观察到`, or `描述`.
- Avoid `诊断`, `病情判断`, `恶化`, `好转` unless quoting source text.
- Add multimodal failure handling: unreadable images must produce "cannot reliably read" style output instead of inferred content.

Acceptance:

- Mock cloud adapter produces schema-valid 7/30 day summary.
- Safety post-check blocks diagnosis-like model output.

### Phase 5: Document Upload / Report Parsing Redesign

- Keep existing upload and confirmation UI.
- Add cloud multimodal parse only after user consent.
- Extract:
  - document type
  - date
  - title
  - 1-3 communication points
  - medical-term explanation candidates
  - parse quality
  - doctor-review-needed flag
- Add manual fallback for parse failure, no consent, or unsupported files.

Acceptance:

- Clear reports produce structured parse candidates.
- Blurry/incomplete reports are marked doctor-review-needed.
- No single-report diagnosis or disease-direction inference is allowed.

### Phase 6: Privacy / Local-First Mode UI + Data Policy Enforcement

- Add local-processing-priority toggle behavior.
- Logs, simple phrasing, basic crisis/boundary checks run locally when possible.
- Cloud summaries require explicit confirmation.
- Raw text/files are blocked from upload unless confirmed.
- Structured metrics can upload if policy permits.

Acceptance:

- Network calls are blocked for raw text/files in local-first mode without consent.
- Consent state is visible and auditable in telemetry without raw content.

### Phase 7: Cross-Platform Tests And Simulator / Emulator Validation

- Add shared unit tests.
- Add backend integration tests with mock cloud model.
- Add iOS simulator build validation.
- Add Android emulator build validation after JDK setup.
- Add mock model tests for CI and real model tests for local/manual validation.

Acceptance:

- Backend tests pass.
- Frontend typecheck passes.
- iOS simulator build passes.
- Android debug build passes after Java/JDK setup.

### Phase 8: iOS Archive + TestFlight Readiness

- Archive only after local tests and device smoke pass.
- Export IPA with existing export options or updated manual export config.
- Do not upload until App Store Connect credentials and signing are confirmed.

Acceptance:

- Archive succeeds or is blocked only by signing/account/manual credential steps.

### Phase 9: Android Release Build + Internal Testing Readiness

- Configure release keystore outside source control.
- Build signed APK/AAB.
- Validate app size and model distribution path.
- Do not upload until Play Console credentials are confirmed.

Acceptance:

- AAB succeeds or is blocked only by Java/JDK, signing, account, or manual credential steps.

## 6. Data Contracts

### Intent Enum

```ts
type Intent =
  | "daily_log"
  | "communication_simple"
  | "communication_complex"
  | "caregiver_support"
  | "follow_up_summary"
  | "followup_document"
  | "medical_boundary"
  | "crisis"
  | "offline_summary"
  | "android_system_prompt";
```

### ModelProfile Enum

```ts
type ModelProfile =
  | "on_device_e2b"
  | "on_device_e4b"
  | "cloud_26b"
  | "cloud_31b"
  | "cloud_31b_long_context"
  | "cloud_26b_multimodal"
  | "android_aicore_optional"
  | "deterministic_fallback";
```

### Platform Enum

```ts
type Platform = "ios" | "android" | "backend";
```

### Routing Decision Object

```json
{
  "intent": "daily_log",
  "platform": "ios",
  "selected_model_profile": "on_device_e2b",
  "fallback_model_profile": "cloud_26b",
  "timeout_ms": 4000,
  "requires_user_consent": false,
  "privacy_mode": "local_first",
  "network_required": false,
  "reason": "local model ready and intent supports on-device execution",
  "telemetry_id": "route_..."
}
```

### Structured Log Output JSON

```json
{
  "event_type": null,
  "event_time": null,
  "symptoms": [],
  "medications": [],
  "food": [],
  "sleep": null,
  "mood": null,
  "notes_for_caregiver": [],
  "diagnostic_risk": false,
  "field_confidence": {
    "event_type": 0.0,
    "event_time": 0.0,
    "symptoms": 0.0,
    "medications": 0.0,
    "food": 0.0,
    "sleep": 0.0,
    "mood": 0.0,
    "notes_for_caregiver": 0.0
  },
  "low_confidence_fields": []
}
```

Rules:

- Complete JSON only.
- Missing fields use `null` or empty arrays.
- No extra fields.
- Confidence <= 0.6 goes into `low_confidence_fields`.
- Diagnosis-like text must be isolated in `notes_for_caregiver` with `diagnostic_risk: true`.

### Follow-Up Summary Request / Response

```json
{
  "window_days": 30,
  "language": "zh-CN",
  "include_english_key_phrases": true,
  "care_logs": [],
  "daily_metrics": [],
  "caregiver_daily_metrics_trend": {},
  "confirmed_documents": [],
  "document_images": [],
  "privacy_consent": {
    "cloud_summary_allowed": true,
    "raw_text_upload_allowed": true,
    "document_upload_allowed": true
  }
}
```

```json
{
  "summary_zh": "",
  "english_key_phrases": [],
  "source_window_days": 30,
  "unreadable_documents": [],
  "safety_flags": [],
  "model_profile": "cloud_31b_long_context"
}
```

### Document Parsing Request / Response

```json
{
  "document_id": "doc_...",
  "mime_type": "image/png",
  "user_summary": "",
  "cloud_parse_allowed": true,
  "local_first_mode": false
}
```

```json
{
  "document_id": "doc_...",
  "document_type": null,
  "document_date": null,
  "title": null,
  "communication_points": [],
  "medical_term_candidates": [],
  "parse_quality": "unreadable",
  "doctor_review_needed": true,
  "requires_family_confirmation": true,
  "confidence": 0.0,
  "safety_flags": [],
  "model_profile": "cloud_26b_multimodal"
}
```

### Safety Result Object

```json
{
  "category": "medical_boundary",
  "severity": "medium",
  "allowed": false,
  "safe_message": "",
  "crisis_detected": false,
  "diagnostic_risk": true,
  "recommended_action": "ask_doctor"
}
```

### Local-First Privacy Config

```json
{
  "local_first_enabled": true,
  "cloud_fallback_allowed": false,
  "cloud_summary_allowed": false,
  "raw_text_upload_allowed": false,
  "document_cloud_parse_allowed": false,
  "structured_metrics_upload_allowed": true
}
```

### Mobile Model Availability Object

```json
{
  "platform": "android",
  "model_id": "gemma-4-E2B-it",
  "profile": "on_device_e2b",
  "installed": true,
  "downloadable": true,
  "runtime_supported": true,
  "memory_eligible": true,
  "recommended_backend": "gpu",
  "size_bytes": 2583000000
}
```

### Runtime Initialization Status Object

```json
{
  "status": "ready",
  "runtime": "litert_lm",
  "model_id": "gemma-4-E2B-it",
  "backend": "gpu",
  "error_code": null,
  "error_message": null,
  "initialized_at": "2026-06-12T00:00:00Z"
}
```

## 7. iOS Implementation Details To Plan

- Detect workspace: `frontend/ios/CareMind.xcworkspace`.
- Detect app scheme: `CareMind`.
- Keep integration in existing Expo native module.
- Treat LiteRT-LM Swift as Early Preview.
- Use Gemma 4 E2B first.
- Prepare E4B as optional and gated.
- Prefer model download/onboarding if bundle size is too large.
- Define model file locations:
  - app-private documents/cache directory for downloaded models
  - debug-only local path if needed
  - no direct bundle inclusion until size is validated
- Add device capability checks:
  - iOS version
  - available memory
  - available disk
  - Metal/GPU availability where applicable
  - thermal/memory pressure behavior
- Error states:
  - model missing
  - model checksum mismatch
  - runtime init failure
  - memory pressure
  - timeout
  - unsupported device
  - Early Preview API mismatch
- Simulator build:

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend
xcodebuild -workspace ios/CareMind.xcworkspace -scheme CareMind -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 16' build
```

- Device smoke test:
  - install debug build on iPhone
  - download or stage Gemma 4 E2B model
  - initialize runtime
  - run short structured-log prompt
  - validate schema, latency, memory, cancellation, and fallback

- Archive path:

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend
xcodebuild -workspace ios/CareMind.xcworkspace -scheme CareMind -configuration Release -sdk iphoneos -archivePath artifacts/ios/CareMind-0.2.1-ios-b8-20260612-1159.xcarchive archive
```

- Export/TestFlight:
  - build `0.2.1 (8)` was uploaded through `xcodebuild -exportArchive` with `destination=upload`
  - App Store Connect returned `Upload succeeded`; Apple-side processing and compliance prompts may still require manual App Store Connect review
  - future uploads must increment `CFBundleVersion` / `CURRENT_PROJECT_VERSION` / iOS `buildNumber`

## 8. Android Implementation Details To Plan

- Detect Android module: `frontend/android/app`.
- Install/configure Java/JDK before Gradle validation.
- Keep current Kotlin native module and downloader.
- Add shared runtime adapter above current module.
- Use Gemma 4 E2B first.
- Prepare E4B as optional only for high-memory devices.
- Evaluate AICore / ML Kit as optional Android-only provider:
  - check API availability
  - check supported device/system image
  - check task fit
  - verify safety and privacy behavior
  - fall back to LiteRT-LM provider if unavailable
- Model file strategy:
  - app-private downloaded model path
  - debug path `/data/local/tmp/llm/gemma.litertlm`
  - no direct app bundle inclusion until size is validated
- Device capability checks:
  - Android API level
  - RAM and available heap
  - disk space
  - GPU/backend support
  - thermal/memory pressure
  - AICore/ML Kit availability if optional provider is tested
- Error states:
  - Java/JDK build environment missing
  - model missing
  - checksum mismatch
  - runtime init failure
  - memory pressure
  - timeout
  - unsupported device
  - backend unavailable

- Emulator build:

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend/android
./gradlew :app:assembleDebug
```

- Physical Android smoke test:

```bash
adb shell mkdir -p /data/local/tmp/llm
adb push gemma-4-E2B-it.litertlm /data/local/tmp/llm/gemma.litertlm
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s CaremindGemma CaremindGemmaEngine CaremindGemmaModel
```

- Release APK/AAB:

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend/android
./gradlew :app:assembleRelease
./gradlew :app:bundleRelease
```

- Google Play internal testing:
  - requires release keystore
  - requires Play Console access
  - requires AAB validation
  - do not assume credentials exist

## 9. Test Plan

### Shared Unit Tests

- Intent classification maps to expected intent.
- Routing table returns expected model profile.
- Privacy mode blocks cloud fallback when required.
- Timeout policy works.
- Model availability affects routing.
- Local and cloud fallback reasons are telemetry-safe.

### Backend Integration Tests

- Mock cloud provider for 26B/31B.
- Follow-up summary accepts 7/30 day input bundle.
- Document parse handles clear, blurry, incomplete, unsupported.
- Safety post-check rewrites or blocks unsafe output.
- Multilingual input preserves original medical terms and outputs caregiver-friendly Chinese.

### Routing Tests

- iOS E2B available.
- Android E2B available.
- iOS runtime unavailable.
- Android runtime unavailable.
- Local-first cloud fallback denied.
- Cloud consent granted.
- Android optional AICore unavailable falls back to LiteRT-LM route.

### Structured Output Validation Tests

- Complete JSON.
- Missing fields become `null`.
- No extra fields.
- Confidence values present.
- Low-confidence fields are listed.
- Diagnostic-risk text is isolated.

### Safety Boundary Tests

- Crisis keywords.
- Medication/dosage advice.
- Diagnosis requests.
- Single-report disease-direction inference.
- Complex family communication phrasing.
- Follow-up summary forbidden wording.

### Privacy / Local-First Tests

- Raw notes not uploaded without consent.
- Files not uploaded without consent.
- Structured metrics upload follows config.
- Cloud summary requires confirmation.
- Telemetry excludes raw text and raw files.

### Multimodal Degraded-Image Tests

- Clear report image.
- Blurry screenshot.
- Cropped/incomplete screenshot.
- Unsupported file.
- PDF with low-quality scan.
- User manual fallback.

### iOS Validation

- TypeScript build remains green.
- iOS simulator build succeeds.
- Physical iPhone E2B smoke test passes or precise blocker is documented.
- Archive succeeds or signing/account blocker is documented.

### Android Validation

- JDK installed/configured.
- Gradle debug build succeeds.
- Emulator launch succeeds.
- Physical Android E2B smoke test passes or precise blocker is documented.
- Release APK/AAB succeeds or signing/account blocker is documented.

### CI Strategy

- Mock model tests run in CI.
- Real model tests remain local/manual because model files are large and hardware-dependent.
- Release-readiness checks run only after local build/test gates pass.

## 10. Risk List

- LiteRT-LM Swift API is Early Preview and may change.
- LiteRT-LM Android/Kotlin route is more stable but current project uses MediaPipe-style APIs that may need migration.
- Android AICore / ML Kit availability varies by device, API, and feature.
- Gemma 4 E2B/E4B model size may be too large for direct app bundling.
- E4B may exceed memory/latency budget on many phones.
- iOS memory pressure and startup latency may block real-device use.
- Android fragmentation may cause backend/device-specific failures.
- App bundle size/model distribution may block TestFlight or Play readiness.
- Cloud Gemma 4 26B/31B provider is not yet defined.
- Multimodal document parsing can hallucinate if image quality is poor.
- Medical safety/compliance risk remains high and requires conservative wording.
- iOS signing/provisioning may block TestFlight.
- Android signing/keystore/Play Console access may block internal testing.
- Existing worktree has many modified/untracked files; implementation should avoid unrelated rewrites.

## 11. Acceptance Criteria

### Phase-Level Pass / Fail

- Phase 0 passes when docs/contracts are reviewed and no product behavior changes are made.
- Phase 1 passes when routing decisions are typed, tested, and privacy-aware.
- Phase 2A passes when product logic can call one runtime interface on both platforms.
- Phase 2B passes when iOS simulator build succeeds and E2B device smoke either passes or returns a precise blocker.
- Phase 2C passes when Android Gradle build succeeds after JDK setup and E2B device smoke either passes or returns a precise blocker.
- Phase 3 passes when daily log local structuring returns schema-valid JSON on both platforms or falls back safely.
- Phase 4 passes when cloud follow-up summary produces safe 7/30 day output using the full input window.
- Phase 5 passes when document parsing safely handles clear, blurry, incomplete, unsupported, and manually entered documents.
- Phase 6 passes when local-first mode blocks raw text/file upload unless the user confirms.
- Phase 7 passes when shared, backend, iOS, and Android validation gates are green or have precise environment blockers.
- Phase 8 passes when iOS archive succeeds or is blocked only by signing/account/manual credential steps.
- Phase 9 passes when Android APK/AAB build succeeds or is blocked only by Java/JDK, signing, account, or manual credential steps.

### Exact Commands To Run

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo
python -m unittest tests.test_gemma4_phase3_5_contracts
python -m unittest
```

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend
npm run typecheck
```

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend
xcodebuild -workspace ios/CareMind.xcworkspace -scheme CareMind -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' build
```

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend/android
./gradlew :app:assembleDebug
```

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend
xcodebuild -workspace ios/CareMind.xcworkspace -scheme CareMind -configuration Release -sdk iphoneos -archivePath artifacts/ios/CareMind-0.2.1-ios-b8-20260612-1159.xcarchive archive
```

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend
xcodebuild -exportArchive -archivePath artifacts/ios/CareMind-0.2.1-ios-b8-20260612-1159.xcarchive -exportPath artifacts/ios/upload-b8-20260612-120330 -exportOptionsPlist artifacts/ios/ExportOptions-AppStoreConnectUpload.plist -allowProvisioningUpdates
```

```bash
cd /Users/lola/Desktop/caremind/CareMind_repo/frontend/android
./gradlew :app:bundleRelease
```

### Must Manually Verify On iPhone

- E2B model can be downloaded or staged.
- Runtime initializes.
- Local daily log prompt returns schema-valid output.
- 4s timeout/cancel works.
- Local-first mode prevents cloud upload.
- Cloud summary consent prompt appears before upload.
- App remains stable under memory pressure.

### Must Manually Verify On Android

- E2B model can be downloaded or staged.
- Runtime initializes.
- Local daily log prompt returns schema-valid output.
- 4s timeout/cancel works.
- Local-first mode prevents cloud upload.
- Cloud summary consent prompt appears before upload.
- Optional AICore/ML Kit provider, if evaluated, fails over cleanly when unavailable.

### Blocks TestFlight Upload

- Failed tests or simulator/device build.
- Failed E2B smoke test without accepted blocker.
- Missing signing/provisioning.
- Missing App Store Connect access.
- App size/model packaging issue.
- Privacy/local-first data policy failure.
- Medical-safety regression.

### Blocks Android Internal Testing

- Missing Java/JDK.
- Failed Gradle build.
- Failed E2B smoke test without accepted blocker.
- Missing release keystore.
- Missing Play Console access.
- AAB validation failure.
- App size/model packaging issue.
- Privacy/local-first data policy failure.
- Medical-safety regression.
