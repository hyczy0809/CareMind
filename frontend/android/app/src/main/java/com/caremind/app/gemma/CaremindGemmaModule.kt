package com.caremind.app.gemma

import android.app.ActivityManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.caremind.app.BuildConfig
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * React Native bridge for on-device Gemma inference (LiteRT-LM Kotlin API).
 *
 * Methods are exposed unchanged to JS as NativeModules.CaremindGemma. All long
 * work runs off the JS thread via a dedicated CoroutineScope; cancellation is
 * cooperative through per-request flags. The actual LiteRT-LM engine lives in
 * [GemmaEngineHolder].
 *
 * Every method that touches a model on disk takes an explicit `filename`
 * parameter so multiple models can coexist and the JS side can switch at
 * runtime via the privacy-mode picker.
 */
class CaremindGemmaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val tag = "CaremindGemma"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val downloader = GemmaModelDownloader(reactContext)
    private val stubMode = AtomicBoolean(false)
    private val activeJobs = ConcurrentHashMap<String, Job>()

    override fun getName(): String = "CaremindGemma"

    private fun requireFilename(filename: String?): String {
        val name = filename ?: throw IllegalArgumentException("缺少模型文件名 (filename)")
        if (!GemmaModelDownloader.isSafeFilename(name)) {
            throw IllegalArgumentException("非法的模型文件名：$name")
        }
        return name
    }

    private fun isStubModeEnabled(): Boolean = BuildConfig.DEBUG && stubMode.get()

    // ----- Model lifecycle ---------------------------------------------------

    @ReactMethod
    fun isModelReady(filename: String?, promise: Promise) {
        try {
            promise.resolve(downloader.isReady(requireFilename(filename)))
        } catch (t: Throwable) {
            promise.reject("MODEL_READY_FAILED", t)
        }
    }

    @ReactMethod
    fun getModelPath(filename: String?, promise: Promise) {
        try {
            promise.resolve(downloader.targetFile(requireFilename(filename)).absolutePath)
        } catch (t: Throwable) {
            promise.reject("MODEL_PATH_FAILED", t)
        }
    }

    @ReactMethod
    fun getModelFileInfo(filename: String?, promise: Promise) {
        try {
            val safeName = requireFilename(filename)
            val file = downloader.targetFile(safeName)
            val result = Arguments.createMap().apply {
                putString("filename", safeName)
                putString("path", file.absolutePath)
                putBoolean("exists", file.exists())
                putBoolean("readable", file.exists() && file.canRead())
                putDouble("bytes", (file.takeIf { it.exists() }?.length() ?: 0L).toDouble())
                putString("extension", file.extension.lowercase())
                putBoolean("debugTmp", downloader.isDebugTmpModel(file))
            }
            promise.resolve(result)
        } catch (t: Throwable) {
            promise.reject("MODEL_FILE_INFO_FAILED", describeThrowable(t), t)
        }
    }

    @ReactMethod
    fun validateModelFile(filename: String?, expectedBytesArg: Double?, checksumSha256: String?, promise: Promise) {
        scope.launch {
            try {
                val safeName = requireFilename(filename)
                val expectedBytes = expectedBytesArg?.toLong()?.takeIf { it > 0L }
                val file = downloader.targetFile(safeName)
                val reasons = mutableListOf<String>()
                if (!file.exists()) reasons.add("not_downloaded")
                if (file.exists() && !file.canRead()) reasons.add("not_readable")
                if (file.exists() && file.extension.lowercase() != "litertlm") reasons.add("wrong_extension:${file.extension}")
                if (file.exists() && file.length() <= 0L) reasons.add("empty_file")
                if (file.exists() && expectedBytes != null && file.length() != expectedBytes) {
                    reasons.add("size_mismatch:${file.length()}/$expectedBytes")
                }

                var actualSha: String? = null
                val expectedSha = checksumSha256?.trim()?.lowercase().orEmpty()
                if (file.exists() && expectedSha.isNotBlank()) {
                    if (!expectedSha.matches(Regex("^[0-9a-f]{64}$"))) {
                        reasons.add("bad_expected_sha256")
                    } else {
                        actualSha = downloader.sha256(file)
                        if (actualSha != expectedSha) {
                            reasons.add("hash_mismatch")
                        }
                    }
                }

                val ok = reasons.isEmpty()
                Log.i(tag, "validateModelFile name=$safeName ok=$ok bytes=${if (file.exists()) file.length() else 0L} reasons=${reasons.joinToString("|")}")
                val result = Arguments.createMap().apply {
                    putString("filename", safeName)
                    putString("path", file.absolutePath)
                    putBoolean("ok", ok)
                    putBoolean("exists", file.exists())
                    putBoolean("readable", file.exists() && file.canRead())
                    putDouble("bytes", (file.takeIf { it.exists() }?.length() ?: 0L).toDouble())
                    putString("extension", file.extension.lowercase())
                    putString("sha256", actualSha)
                    putString("reason", reasons.joinToString(","))
                    putBoolean("debugTmp", downloader.isDebugTmpModel(file))
                }
                promise.resolve(result)
            } catch (t: Throwable) {
                promise.reject("MODEL_VALIDATE_FAILED", describeThrowable(t), t)
            }
        }
    }

    @ReactMethod
    fun importDebugModel(filename: String?, promise: Promise) {
        scope.launch {
            try {
                val safeName = requireFilename(filename)
                val file = downloader.copyDebugModelIntoAppPrivate(safeName)
                val result = Arguments.createMap().apply {
                    putString("path", file.absolutePath)
                    putString("filename", safeName)
                    putDouble("bytes", file.length().toDouble())
                }
                promise.resolve(result)
            } catch (t: Throwable) {
                promise.reject("IMPORT_DEBUG_MODEL_FAILED", describeThrowable(t), t)
            }
        }
    }

    @ReactMethod
    fun downloadModel(filename: String?, url: String, checksumSha256: String?, expectedBytesArg: Double?, promise: Promise) {
        val safeName = try {
            requireFilename(filename)
        } catch (t: Throwable) {
            promise.reject("DOWNLOAD_BAD_ARG", t)
            return
        }

        if (isStubModeEnabled()) {
            // Stub mode: write a 1-byte sentinel so isModelReady() returns true.
            scope.launch {
                try {
                    GemmaStub.writeSentinel(downloader.targetFile(safeName))
                    val result = Arguments.createMap().apply {
                        putString("path", downloader.targetFile(safeName).absolutePath)
                        putString("filename", safeName)
                        putDouble("bytes", 1.0)
                    }
                    promise.resolve(result)
                } catch (t: Throwable) {
                    promise.reject("STUB_WRITE_FAILED", t)
                }
            }
            return
        }

        scope.launch {
            try {
                val expectedBytes = expectedBytesArg?.toLong()?.takeIf { it > 0L }
                Log.i(tag, "downloadModel model=$safeName host=${urlHost(url)} checksum=${!checksumSha256.isNullOrBlank()} expectedBytes=${expectedBytes ?: 0L}")
                val file = downloader.download(safeName, url, checksumSha256, expectedBytes) { bytes, total ->
                    emitProgress(safeName, bytes, total)
                }
                val result = Arguments.createMap().apply {
                    putString("path", file.absolutePath)
                    putString("filename", safeName)
                    putDouble("bytes", file.length().toDouble())
                }
                promise.resolve(result)
            } catch (t: Throwable) {
                Log.w(tag, "downloadModel failed", t)
                promise.reject("DOWNLOAD_FAILED", t.message ?: "download failed", t)
            }
        }
    }

    @ReactMethod
    fun cancelDownload(filename: String?, promise: Promise) {
        try {
            downloader.cancel(requireFilename(filename))
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("CANCEL_DOWNLOAD_FAILED", t)
        }
    }

    @ReactMethod
    fun deleteModel(filename: String?, promise: Promise) {
        try {
            val safeName = requireFilename(filename)
            // If the engine currently has this file loaded, release first.
            val targetPath = downloader.targetFile(safeName).absolutePath
            if (GemmaEngineHolder.loadedPath() == targetPath) {
                GemmaEngineHolder.release()
            }
            downloader.delete(safeName)
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("DELETE_MODEL_FAILED", t)
        }
    }

    @ReactMethod
    fun initEngine(filename: String?, options: ReadableMap?, promise: Promise) {
        if (isStubModeEnabled()) {
            promise.resolve(null)
            return
        }
        scope.launch {
            try {
                val safeName = requireFilename(filename)
                val backend = parseBackend(options?.getStringOrNull("backend"))
                val engineTokens = resolveEngineTokens(options)
                val modelPath = downloader.targetFile(safeName).absolutePath
                Log.i(tag, "initEngine name=$safeName path=$modelPath backend=$backend engineTokens=$engineTokens")
                GemmaEngineHolder.ensureEngine(
                    reactApplicationContext,
                    modelPath,
                    backend,
                    engineTokens
                )
                promise.resolve(null)
            } catch (t: Throwable) {
                Log.e(tag, "initEngine failed", t)
                promise.reject("INIT_ENGINE_FAILED", describeThrowable(t), t)
            }
        }
    }

    @ReactMethod
    fun releaseEngine(promise: Promise) {
        try {
            GemmaEngineHolder.release()
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("RELEASE_ENGINE_FAILED", describeThrowable(t), t)
        }
    }

    @ReactMethod
    fun logMemorySnapshot(label: String?, promise: Promise) {
        try {
            GemmaEngineHolder.logMemorySnapshot(reactApplicationContext, label ?: "manual")
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("MEMORY_SNAPSHOT_FAILED", describeThrowable(t), t)
        }
    }

    @ReactMethod
    fun getRuntimeInfo(promise: Promise) {
        try {
            val activityManager = reactApplicationContext.getSystemService(ReactApplicationContext.ACTIVITY_SERVICE) as? ActivityManager
            val memoryInfo = ActivityManager.MemoryInfo()
            activityManager?.getMemoryInfo(memoryInfo)
            val loadedPath = GemmaEngineHolder.loadedPath()
            val loadedFile = loadedPath?.let { File(it) }

            val systemInfo = Arguments.createMap().apply {
                putString("manufacturer", Build.MANUFACTURER)
                putString("brand", Build.BRAND)
                putString("model", Build.MODEL)
                putString("device", Build.DEVICE)
                putString("hardware", Build.HARDWARE)
                putString("androidVersion", Build.VERSION.RELEASE ?: "unknown")
                putInt("sdkInt", Build.VERSION.SDK_INT)
                putDouble("totalMemoryMb", (memoryInfo.totalMem / (1024 * 1024)).toDouble())
                putDouble("availableMemoryMb", (memoryInfo.availMem / (1024 * 1024)).toDouble())
                putDouble("lowMemoryThresholdMb", (memoryInfo.threshold / (1024 * 1024)).toDouble())
                putBoolean("lowMemory", memoryInfo.lowMemory)
                putInt("largeHeapClassMb", activityManager?.largeMemoryClass ?: -1)
                putBoolean(
                    "airplaneMode",
                    Settings.Global.getInt(reactApplicationContext.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) == 1
                )
            }

            val result = Arguments.createMap().apply {
                putString("platform", "android")
                putString("runtime", "litert-lm")
                putString("runtimeDependency", "com.google.ai.edge.litertlm:litertlm-android:0.13.1")
                putString("accelerator", GemmaEngineHolder.loadedRuntimeBackend() ?: "AUTO")
                putBoolean("supportsAudio", false)
                putString("loadedModelId", loadedFile?.name)
                putString("loadedModelPath", loadedPath)
                putString("modelFormat", loadedFile?.extension?.lowercase() ?: "unknown")
                putDouble("loadedModelBytes", (loadedFile?.takeIf { it.exists() }?.length() ?: 0L).toDouble())
                putBoolean("engineInitialized", GemmaEngineHolder.isLoaded())
                putMap("systemInfo", systemInfo)
            }
            promise.resolve(result)
        } catch (t: Throwable) {
            promise.reject("RUNTIME_INFO_FAILED", describeThrowable(t), t)
        }
    }

    // ----- Generation --------------------------------------------------------

    @ReactMethod
    fun generate(prompt: String, options: ReadableMap, promise: Promise) {
        val filename = options.getStringOrNull("filename")
        val requestId = options.getStringOrNull("requestId") ?: "req_${System.currentTimeMillis()}"
        val temperature = options.getDoubleOrDefault("temperature", 0.4).toFloat()
        val topK = options.getIntOrDefault("topK", 40)
        val backend = parseBackend(options.getStringOrNull("backend"))
        val engineTokens = resolveEngineTokens(options)

        val job = scope.launch {
            val started = System.currentTimeMillis()
            try {
                if (isStubModeEnabled()) {
                    val text = GemmaStub.respond(prompt)
                    promise.resolve(buildGenerationResult(text, null, System.currentTimeMillis() - started, "stub_debug", "stub", "stub", false))
                    return@launch
                }

                val safeName = requireFilename(filename)
                val modelPath = downloader.targetFile(safeName).absolutePath
                Log.i(tag, "generate requestId=$requestId name=$safeName path=$modelPath promptLen=${prompt.length} backend=$backend engineTokens=$engineTokens")
                val text = withContext(Dispatchers.IO) {
                    GemmaEngineHolder.runExclusive {
                        val engine = GemmaEngineHolder.ensureEngine(
                            reactApplicationContext,
                            modelPath,
                            backend,
                            engineTokens
                        )
                        GemmaEngineHolder.generateText(
                            engine,
                            prompt,
                            GemmaEngineHolder.GenerationOptions(topK = topK, temperature = temperature)
                        )
                    }
                }
                val elapsed = System.currentTimeMillis() - started
                Log.i(tag, "generate done requestId=$requestId elapsedMs=$elapsed outLen=${text.length}")
                // Dump first 400 chars of model output to logcat so we can
                // verify whether the model produced parseable JSON / XML.
                // Trim newlines since logcat splits messages on \n.
                val preview = text.replace("\n", " \\n ").take(400)
                Log.i(tag, "generate output preview requestId=$requestId | $preview")
                promise.resolve(buildGenerationResult(text, null, elapsed, "native_litertlm_success", safeName, GemmaEngineHolder.loadedRuntimeBackend() ?: backend.name, true))
            } catch (t: Throwable) {
                Log.e(tag, "generate failed requestId=$requestId", t)
                promise.reject("GENERATE_FAILED", describeThrowable(t), t)
            } finally {
                activeJobs.remove(requestId)
            }
        }
        activeJobs[requestId] = job
    }

    @ReactMethod
    fun generateWithAudio(prompt: String, audioFilePath: String, options: ReadableMap, promise: Promise) {
        val filename = options.getStringOrNull("filename")
        val requestId = options.getStringOrNull("requestId") ?: "audio_${System.currentTimeMillis()}"
        val backend = parseBackend(options.getStringOrNull("backend"))
        val engineTokens = resolveEngineTokens(options)

        val job = scope.launch {
            val started = System.currentTimeMillis()
            try {
                if (isStubModeEnabled()) {
                    val text = GemmaStub.respond(prompt)
                    promise.resolve(buildGenerationResult(text, null, System.currentTimeMillis() - started, "stub_debug", "stub", "stub", false))
                    return@launch
                }

                val safeName = requireFilename(filename)
                Log.i(tag, "generateWithAudio rejected requestId=$requestId name=$safeName audioPathProvided=${audioFilePath.isNotBlank()} backend=$backend engineTokens=$engineTokens")
                throw UnsupportedOperationException("Gemma 4 E2B Android 本地模式当前只启用文本推理；语音请先使用系统语音转文字后再交给本地模型。")
            } catch (t: Throwable) {
                Log.e(tag, "generateWithAudio failed requestId=$requestId", t)
                promise.reject("GENERATE_AUDIO_FAILED", describeThrowable(t), t)
            } finally {
                activeJobs.remove(requestId)
            }
        }
        activeJobs[requestId] = job
    }

    @ReactMethod
    fun cancelGeneration(requestId: String, promise: Promise) {
        try {
            activeJobs.remove(requestId)?.cancel()
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("CANCEL_GENERATION_FAILED", t)
        }
    }

    @ReactMethod
    fun setStubMode(enabled: Boolean, promise: Promise) {
        try {
            if (enabled && !BuildConfig.DEBUG) {
                stubMode.set(false)
                Log.w(tag, "stub mode is disabled in non-debug builds")
                promise.resolve(null)
                return
            }
            stubMode.set(enabled)
            if (enabled) {
                // Release the real engine so the next initEngine() is a no-op.
                GemmaEngineHolder.release()
            }
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("SET_STUB_FAILED", t)
        }
    }

    // ----- Event helpers -----------------------------------------------------

    private fun emitProgress(filename: String, bytes: Long, totalBytes: Long) {
        val ratio = if (totalBytes > 0) bytes.toDouble() / totalBytes.toDouble() else 0.0
        val payload: WritableMap = Arguments.createMap().apply {
            putString("filename", filename)
            putDouble("bytesDownloaded", bytes.toDouble())
            putDouble("totalBytes", totalBytes.toDouble())
            putDouble("ratio", ratio.coerceIn(0.0, 1.0))
        }
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("CaremindGemma_DownloadProgress", payload)
        } catch (t: Throwable) {
            Log.w(tag, "emitProgress failed", t)
        }
    }

    private fun buildGenerationResult(
        text: String,
        tokenCount: Int?,
        elapsedMs: Long,
        source: String,
        modelId: String,
        backend: String,
        engineInitialized: Boolean
    ): WritableMap =
        Arguments.createMap().apply {
            putString("text", text)
            if (tokenCount != null) putInt("tokenCount", tokenCount)
            putDouble("elapsedMs", elapsedMs.toDouble())
            putString("source", source)
            putString("modelId", modelId)
            putString("backend", backend)
            putBoolean("engineInitialized", engineInitialized)
        }

    private fun readAudioFile(path: String): ByteArray {
        val normalised = if (path.startsWith("file://")) path.removePrefix("file://") else path
        val file = File(normalised)
        if (!file.exists()) {
            throw IllegalArgumentException("音频文件不存在：$normalised")
        }
        return file.readBytes()
    }

    // ----- ReadableMap convenience -------------------------------------------

    private fun ReadableMap.getStringOrNull(key: String): String? =
        if (hasKey(key) && !isNull(key)) getString(key) else null

    private fun ReadableMap.getIntOrDefault(key: String, defaultValue: Int): Int =
        if (hasKey(key) && !isNull(key)) getInt(key) else defaultValue

    private fun ReadableMap.getPositiveIntOrNull(key: String): Int? =
        if (hasKey(key) && !isNull(key)) getInt(key).takeIf { it > 0 } else null

    private fun ReadableMap.getDoubleOrDefault(key: String, defaultValue: Double): Double =
        if (hasKey(key) && !isNull(key)) getDouble(key) else defaultValue

    private fun resolveEngineTokens(options: ReadableMap?): Int =
        options?.getPositiveIntOrNull("contextTokens")
            ?: options?.getPositiveIntOrNull("maxTokens")
            ?: 2048

    // ----- Backend & error helpers -------------------------------------------

    private fun parseBackend(value: String?): GemmaEngineHolder.BackendPref =
        when (value?.uppercase()) {
            "CPU" -> GemmaEngineHolder.BackendPref.CPU
            "GPU" -> GemmaEngineHolder.BackendPref.GPU
            else -> GemmaEngineHolder.BackendPref.AUTO
        }

    /**
     * Build a short, human-readable error message that includes the root cause
     * chain. Native LiteRT-LM errors can surface as a generic bridge failure;
     * walking the cause chain recovers the original OOM, missing library, or
     * GPU-compilation message for the JS side.
     */
    private fun describeThrowable(t: Throwable): String {
        val sb = StringBuilder(t.message ?: t.javaClass.simpleName)
        var cause = t.cause
        var depth = 0
        while (cause != null && depth < 4) {
            sb.append(" ← ").append(cause.message ?: cause.javaClass.simpleName)
            cause = cause.cause
            depth++
        }
        return sb.toString()
    }

    private fun urlHost(url: String): String =
        try {
            java.net.URL(url).host ?: "unknown"
        } catch (_: Throwable) {
            "unknown"
        }
}
