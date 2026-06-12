package com.caremind.app.gemma

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import android.util.Log
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/**
 * Lazy, thread-safe holder around a single MediaPipe LlmInference engine.
 *
 * Sessions are created per-request inside the module. The engine itself is
 * expensive to build (loads the .litertlm / .task into memory), so we keep
 * one instance per process. When the user switches models from the picker,
 * we release the old engine and instantiate a new one against the new path.
 *
 * Generations across the JS bridge are serialised via a lock because the
 * underlying MediaPipe Session is not safe to drive concurrently.
 */
object GemmaEngineHolder {

    private const val TAG = "CaremindGemmaEngine"
    private const val MAX_ENGINE_TOKENS = 768
    private const val MAX_LOADABLE_MODEL_BYTES = 2_800_000_000L
    private const val MIN_AVAILABLE_MEMORY_BYTES = 1_800_000_000L

    /** Backend preference passed in from JS. */
    enum class BackendPref { AUTO, CPU, GPU }

    private val lock = Any()
    private val engineRef = AtomicReference<LlmInference?>(null)
    /** Absolute path of the model currently loaded into engineRef, if any. */
    private val loadedPathRef = AtomicReference<String?>(null)
    /** Backend the loaded engine was built against. */
    private val loadedBackendRef = AtomicReference<BackendPref?>(null)
    /** Actual MediaPipe backend selected after AUTO / fallback resolution. */
    private val loadedRuntimeBackendRef = AtomicReference<String?>(null)
    /** Max tokens the loaded engine was built with. */
    private val loadedMaxTokensRef = AtomicReference<Int?>(null)
    private val generationLock = Any()

    fun isLoaded(): Boolean = engineRef.get() != null

    fun loadedPath(): String? = loadedPathRef.get()

    fun loadedBackend(): BackendPref? = loadedBackendRef.get()

    /**
     * Ensure an engine instance loaded with [modelPath] (and matching options) is available.
     * If a different model OR a different backend / maxTokens is currently loaded,
     * releases the old one first.
     */
    fun ensureEngine(
        context: Context,
        modelPath: String,
        backend: BackendPref = BackendPref.AUTO,
        maxTokens: Int = MAX_ENGINE_TOKENS
    ): LlmInference {
        val effectiveMaxTokens = maxTokens.coerceIn(1, MAX_ENGINE_TOKENS)
        val current = engineRef.get()
        val loadedPath = loadedPathRef.get()
        val loadedBackend = loadedBackendRef.get()
        val loadedMaxTokens = loadedMaxTokensRef.get()
        if (current != null &&
            loadedPath == modelPath &&
            loadedBackend == backend &&
            loadedMaxTokens == effectiveMaxTokens
        ) {
            return current
        }

        synchronized(lock) {
            val currentInLock = engineRef.get()
            val loadedInLock = loadedPathRef.get()
            val backendInLock = loadedBackendRef.get()
            val tokensInLock = loadedMaxTokensRef.get()
            if (currentInLock != null &&
                loadedInLock == modelPath &&
                backendInLock == backend &&
                tokensInLock == effectiveMaxTokens
            ) return currentInLock

            // A different model / config is loaded — release the old one first.
            if (currentInLock != null) {
                Log.i(TAG, "Releasing previous engine (path=$loadedInLock backend=$backendInLock).")
                try {
                    currentInLock.close()
                } catch (t: Throwable) {
                    Log.w(TAG, "Closing previous engine threw — swallowing.", t)
                }
                engineRef.set(null)
                loadedPathRef.set(null)
                loadedBackendRef.set(null)
                loadedRuntimeBackendRef.set(null)
                loadedMaxTokensRef.set(null)
                // Give the JVM a hint; native side controls its own heap, but
                // releasing the JNI handle helps reclaim the off-heap arena sooner.
                Runtime.getRuntime().gc()
            }

            val file = File(modelPath)
            if (!file.exists() || file.length() <= 0) {
                throw IllegalStateException("模型文件不存在或为空：$modelPath")
            }
            validateModelFile(file)
            assertCanLoadModel(context.applicationContext, file)
            val fileSizeMb = file.length() / (1024 * 1024)
            Log.i(
                TAG,
                "Model file resolved: path=${file.absolutePath} size=${fileSizeMb}MB readable=${file.canRead()} format=${file.extension}"
            )
            logMemorySnapshot(context, "Pre-load model=${file.name} size=${fileSizeMb}MB")

            Log.i(
                TAG,
                "Creating LlmInference engine: path=$modelPath requestedBackend=$backend maxTokens=$effectiveMaxTokens"
            )

            val startMs = System.currentTimeMillis()
            val (engine, runtimeBackend) = createEngineWithFallback(
                context = context.applicationContext,
                modelPath = modelPath,
                maxTokens = effectiveMaxTokens,
                candidates = backendCandidates(backend, fileSizeMb)
            )
            val elapsedMs = System.currentTimeMillis() - startMs
            Log.i(TAG, "LlmInference engine ready in ${elapsedMs}ms (runtimeBackend=$runtimeBackend requestedBackend=$backend).")
            logMemorySnapshot(context, "Post-load engine ready")

            engineRef.set(engine)
            loadedPathRef.set(modelPath)
            loadedBackendRef.set(backend)
            loadedRuntimeBackendRef.set(runtimeBackend.name)
            loadedMaxTokensRef.set(effectiveMaxTokens)
            return engine
        }
    }

    private fun validateModelFile(file: File) {
        val extension = file.extension.lowercase()
        if (extension !in setOf("litertlm", "task")) {
            throw IllegalArgumentException("模型格式不支持：.${file.extension}。Android 端当前只接受 .litertlm 或 .task。")
        }
        if (!file.canRead()) {
            throw IllegalStateException("模型文件不可读：${file.absolutePath}")
        }
    }

    private fun backendCandidates(
        backend: BackendPref,
        fileSizeMb: Long
    ): List<LlmInference.Backend> =
        when (backend) {
            BackendPref.CPU -> listOf(LlmInference.Backend.CPU)
            BackendPref.GPU -> listOf(LlmInference.Backend.GPU, LlmInference.Backend.CPU)
            BackendPref.AUTO -> if (fileSizeMb > 1500L) {
                Log.i(TAG, "AUTO backend -> CPU (model size ${fileSizeMb}MB > 1500MB heuristic).")
                listOf(LlmInference.Backend.CPU)
            } else {
                Log.i(TAG, "AUTO backend -> GPU first, CPU fallback (model size ${fileSizeMb}MB).")
                listOf(LlmInference.Backend.GPU, LlmInference.Backend.CPU)
            }
        }

    private fun createEngineWithFallback(
        context: Context,
        modelPath: String,
        maxTokens: Int,
        candidates: List<LlmInference.Backend>
    ): Pair<LlmInference, LlmInference.Backend> {
        var lastError: Throwable? = null

        for ((index, candidate) in candidates.withIndex()) {
            val canRetry = index < candidates.lastIndex
            val options = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(modelPath)
                .setMaxTokens(maxTokens)
                .setMaxTopK(64)
                .setPreferredBackend(candidate)
                .build()

            try {
                Log.i(TAG, "LlmInference.createFromOptions begin backend=$candidate path=$modelPath")
                return LlmInference.createFromOptions(context, options) to candidate
            } catch (error: OutOfMemoryError) {
                lastError = error
                Log.e(TAG, "LlmInference.createFromOptions OOM backend=$candidate", error)
                logMemorySnapshot(context, "Post-oom backend=$candidate")
                if (canRetry) {
                    Log.w(TAG, "Retrying LlmInference on fallback backend=${candidates[index + 1]} after OOM.")
                    continue
                }
                clearLoadedState()
                throw IllegalStateException("端侧模型加载内存不足。请关闭其他应用后重试，或保持云端模式。", error)
            } catch (error: UnsatisfiedLinkError) {
                Log.e(TAG, "LlmInference native library missing or ABI mismatch backend=$candidate", error)
                clearLoadedState()
                throw IllegalStateException("端侧推理运行库缺失或 ABI 不匹配，请重新安装 arm64-v8a 包。", error)
            } catch (error: IllegalArgumentException) {
                lastError = error
                Log.e(TAG, "LlmInference rejected model/options backend=$candidate", error)
                if (canRetry && candidate == LlmInference.Backend.GPU) {
                    Log.w(TAG, "Retrying LlmInference on CPU after GPU argument/runtime failure.")
                    continue
                }
                clearLoadedState()
                throw IllegalStateException("模型格式或推理参数不兼容：${error.message ?: error.javaClass.simpleName}", error)
            } catch (error: Throwable) {
                lastError = error
                Log.e(TAG, "LlmInference.createFromOptions failed backend=$candidate", error)
                logMemorySnapshot(context, "Post-failure backend=$candidate")
                if (canRetry && candidate == LlmInference.Backend.GPU) {
                    Log.w(TAG, "Retrying LlmInference on CPU after GPU failure.")
                    continue
                }
                clearLoadedState()
                val reason = error.message ?: error.javaClass.simpleName
                throw IllegalStateException("端侧模型加载失败：$reason", error)
            }
        }

        clearLoadedState()
        val reason = lastError?.message ?: lastError?.javaClass?.simpleName ?: "unknown"
        throw IllegalStateException("端侧模型加载失败：$reason", lastError)
    }

    private fun assertCanLoadModel(context: Context, file: File) {
        if (file.length() > MAX_LOADABLE_MODEL_BYTES) {
            throw IllegalStateException(
                "当前端侧演示支持 Gemma 4 E2B。${file.name} 超出本机安全加载上限，请切换到 Gemma 4 E2B 或 Gemma 3 1B。"
            )
        }

        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return
        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memoryInfo)
        if (memoryInfo.lowMemory || memoryInfo.availMem < MIN_AVAILABLE_MEMORY_BYTES) {
            throw IllegalStateException("当前手机可用内存不足，暂时无法加载本地模型。请关闭其他应用后重试，或保持使用云端模式。")
        }
    }

    fun release() {
        synchronized(lock) {
            Log.i(TAG, "release() called; current path=${loadedPathRef.get()}")
            engineRef.getAndSet(null)?.close()
            clearLoadedState()
        }
    }

    private fun clearLoadedState() {
        engineRef.set(null)
        loadedPathRef.set(null)
        loadedBackendRef.set(null)
        loadedRuntimeBackendRef.set(null)
        loadedMaxTokensRef.set(null)
    }

    /**
     * Run [block] under the global generation lock so only one inference is
     * in flight at a time. MediaPipe sessions are NOT safely concurrent.
     */
    fun <T> runExclusive(block: () -> T): T {
        synchronized(generationLock) {
            return block()
        }
    }

    fun newSession(
        engine: LlmInference,
        topK: Int,
        temperature: Float,
        enableAudio: Boolean
    ): LlmInferenceSession {
        Log.i(
            TAG,
            "Creating LlmInferenceSession runtimeBackend=${loadedRuntimeBackendRef.get()} topK=$topK temperature=$temperature audio=$enableAudio"
        )
        val graphOptionsBuilder = com.google.mediapipe.tasks.genai.llminference.GraphOptions
            .builder()
        if (enableAudio) {
            graphOptionsBuilder.setEnableAudioModality(true)
        }
        val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
            .setTopK(topK)
            .setTemperature(temperature)
            .setGraphOptions(graphOptionsBuilder.build())
            .build()
        return LlmInferenceSession.createFromOptions(engine, sessionOptions)
    }

    /**
     * Emit a snapshot of Java + native heap and the device's available memory
     * to logcat. Useful when triaging mid-load crashes — pair with
     * `adb logcat -s CaremindGemmaEngine` to follow the load timeline, and
     * `adb shell dumpsys meminfo com.caremind.app` to see what the kernel sees.
     */
    fun logMemorySnapshot(context: Context, tag: String) {
        try {
            val runtime = Runtime.getRuntime()
            val javaUsedMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
            val javaMaxMb = runtime.maxMemory() / (1024 * 1024)
            val nativeUsedMb = Debug.getNativeHeapAllocatedSize() / (1024 * 1024)
            val nativeTotalMb = Debug.getNativeHeapSize() / (1024 * 1024)

            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            val memInfo = ActivityManager.MemoryInfo()
            am?.getMemoryInfo(memInfo)
            val availMb = memInfo.availMem / (1024 * 1024)
            val totalMb = memInfo.totalMem / (1024 * 1024)
            val thresholdMb = memInfo.threshold / (1024 * 1024)
            val largeHeapMb = am?.largeMemoryClass ?: -1

            Log.i(
                TAG,
                "MEM[$tag] java=${javaUsedMb}/${javaMaxMb}MB " +
                    "native=${nativeUsedMb}/${nativeTotalMb}MB " +
                    "device.avail=${availMb}/${totalMb}MB lowmemThreshold=${thresholdMb}MB " +
                    "largeHeapClass=${largeHeapMb}MB lowMemory=${memInfo.lowMemory}"
            )
        } catch (t: Throwable) {
            Log.w(TAG, "logMemorySnapshot failed", t)
        }
    }
}
