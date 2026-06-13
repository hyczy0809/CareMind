package com.caremind.app.gemma

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import android.util.Log
import com.caremind.litertlmbridge.LiteRtLmBridge
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/**
 * Lazy, thread-safe holder around one LiteRT-LM Engine.
 *
 * Gemma 4 `.litertlm` bundles include LiteRT-LM-specific modules that the older
 * MediaPipe LlmInference runtime cannot decode. Keep the public React Native
 * bridge stable, but run `.litertlm` weights through Google's LiteRT-LM runtime.
 */
object GemmaEngineHolder {

    private const val TAG = "CaremindGemmaEngine"
    private const val MAX_ENGINE_TOKENS = 4096
    private const val MAX_LOADABLE_MODEL_BYTES = 2_900_000_000L
    private const val MIN_AVAILABLE_MEMORY_BYTES = 1_400_000_000L

    enum class BackendPref { AUTO, CPU, GPU }

    data class GenerationOptions(
        val topK: Int,
        val temperature: Float
    )

    private data class RuntimeHandle(
        val engine: LiteRtLmBridge,
        val backendName: String
    )

    private val lock = Any()
    private val engineRef = AtomicReference<RuntimeHandle?>(null)
    private val loadedPathRef = AtomicReference<String?>(null)
    private val loadedBackendRef = AtomicReference<BackendPref?>(null)
    private val loadedRuntimeBackendRef = AtomicReference<String?>(null)
    private val loadedMaxTokensRef = AtomicReference<Int?>(null)
    private val generationLock = Any()

    fun isLoaded(): Boolean = engineRef.get() != null

    fun loadedPath(): String? = loadedPathRef.get()

    fun loadedBackend(): BackendPref? = loadedBackendRef.get()

    fun loadedRuntimeBackend(): String? = loadedRuntimeBackendRef.get()

    fun ensureEngine(
        context: Context,
        modelPath: String,
        backend: BackendPref = BackendPref.AUTO,
        maxTokens: Int = MAX_ENGINE_TOKENS
    ): LiteRtLmBridge {
        val effectiveMaxTokens = maxTokens.coerceIn(1, MAX_ENGINE_TOKENS)
        val current = engineRef.get()
        if (current != null &&
            loadedPathRef.get() == modelPath &&
            loadedBackendRef.get() == backend &&
            loadedMaxTokensRef.get() == effectiveMaxTokens
        ) {
            return current.engine
        }

        synchronized(lock) {
            val currentInLock = engineRef.get()
            if (currentInLock != null &&
                loadedPathRef.get() == modelPath &&
                loadedBackendRef.get() == backend &&
                loadedMaxTokensRef.get() == effectiveMaxTokens
            ) {
                return currentInLock.engine
            }

            releaseLocked()

            val file = File(modelPath)
            if (!file.exists() || file.length() <= 0) {
                throw IllegalStateException("模型文件不存在或为空：$modelPath")
            }
            validateModelFile(file)
            assertCanLoadModel(context.applicationContext, file)

            val fileSizeMb = file.length() / (1024 * 1024)
            Log.i(
                TAG,
                "LiteRT-LM model resolved path=${file.absolutePath} size=${fileSizeMb}MB readable=${file.canRead()}"
            )
            logMemorySnapshot(context, "Pre-load model=${file.name} size=${fileSizeMb}MB")

            val startMs = System.currentTimeMillis()
            val handle = createEngineWithFallback(
                context = context.applicationContext,
                modelPath = modelPath,
                maxTokens = effectiveMaxTokens,
                candidates = backendCandidates(backend)
            )
            val elapsedMs = System.currentTimeMillis() - startMs
            Log.i(
                TAG,
                "LiteRT-LM engine ready elapsedMs=$elapsedMs runtimeBackend=${handle.backendName} requestedBackend=$backend maxTokens=$effectiveMaxTokens"
            )
            logMemorySnapshot(context, "Post-load litert-lm ready")

            engineRef.set(handle)
            loadedPathRef.set(modelPath)
            loadedBackendRef.set(backend)
            loadedRuntimeBackendRef.set(handle.backendName)
            loadedMaxTokensRef.set(effectiveMaxTokens)
            return handle.engine
        }
    }

    private fun validateModelFile(file: File) {
        if (file.extension.lowercase() != "litertlm") {
            throw IllegalArgumentException("模型格式不支持：.${file.extension}。Android Gemma 4 端侧路径只接受 .litertlm。")
        }
        if (!file.canRead()) {
            throw IllegalStateException("模型文件不可读：${file.absolutePath}")
        }
    }

    private fun backendCandidates(backend: BackendPref): List<String> =
        when (backend) {
            BackendPref.CPU -> listOf("CPU")
            BackendPref.GPU -> listOf("GPU", "CPU")
            BackendPref.AUTO -> listOf("GPU", "CPU")
        }

    private fun createEngineWithFallback(
        context: Context,
        modelPath: String,
        maxTokens: Int,
        candidates: List<String>
    ): RuntimeHandle {
        val cacheDir = File(context.cacheDir, "litert-lm-cache").apply { mkdirs() }

        for ((index, backendName) in candidates.withIndex()) {
            val canRetry = index < candidates.lastIndex

            try {
                Log.i(TAG, "LiteRT-LM Engine.initialize begin backend=$backendName path=$modelPath cacheDir=${cacheDir.absolutePath}")
                val engine = LiteRtLmBridge.create(
                    modelPath,
                    backendName,
                    cacheDir.absolutePath,
                    maxTokens
                )
                return RuntimeHandle(engine = engine, backendName = engine.backendName())
            } catch (error: OutOfMemoryError) {
                Log.e(TAG, "LiteRT-LM OOM backend=$backendName", error)
                logMemorySnapshot(context, "Post-oom backend=$backendName")
                if (canRetry) continue
                throwUserFacingLoadError("端侧模型加载内存不足。请关闭其他应用后重试，或保持云端模式。", error)
            } catch (error: UnsatisfiedLinkError) {
                Log.e(TAG, "LiteRT-LM native library missing or ABI mismatch backend=$backendName", error)
                throwUserFacingLoadError("端侧推理运行库缺失或 ABI 不匹配，请重新安装最新版 arm64-v8a 安装包。", error)
            } catch (error: Throwable) {
                Log.e(TAG, "LiteRT-LM Engine.initialize failed backend=$backendName", error)
                if (canRetry && backendName == "GPU") {
                    Log.w(TAG, "Retrying LiteRT-LM on CPU after GPU failure.")
                    continue
                }
                throwUserFacingLoadError("端侧模型加载失败：${rootReason(error)}", error)
            }
        }

        throwUserFacingLoadError("端侧模型加载失败：没有可用的 LiteRT-LM 后端。", null)
    }

    private fun throwUserFacingLoadError(message: String, cause: Throwable?): Nothing {
        clearLoadedState()
        throw IllegalStateException(message, cause)
    }

    private fun assertCanLoadModel(context: Context, file: File) {
        if (file.length() > MAX_LOADABLE_MODEL_BYTES) {
            throw IllegalStateException("当前端侧演示支持 Gemma 4 E2B。${file.name} 超出本机安全加载上限，请切换到 Gemma 4 E2B。")
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
            releaseLocked()
        }
    }

    private fun releaseLocked() {
        val current = engineRef.getAndSet(null)
        if (current != null) {
            Log.i(TAG, "release engine path=${loadedPathRef.get()} backend=${current.backendName}")
            try {
                current.engine.close()
            } catch (t: Throwable) {
                Log.w(TAG, "Closing LiteRT-LM engine threw; swallowing.", t)
            }
        }
        clearLoadedState()
        Runtime.getRuntime().gc()
    }

    private fun clearLoadedState() {
        loadedPathRef.set(null)
        loadedBackendRef.set(null)
        loadedRuntimeBackendRef.set(null)
        loadedMaxTokensRef.set(null)
    }

    fun <T> runExclusive(block: () -> T): T {
        synchronized(generationLock) {
            return block()
        }
    }

    fun generateText(
        engine: LiteRtLmBridge,
        prompt: String,
        options: GenerationOptions
    ): String {
        return engine.generate(
            prompt,
            options.topK.coerceIn(1, 128),
            0.95,
            options.temperature.coerceIn(0.0f, 1.5f).toDouble()
        )
    }

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

    private fun rootReason(error: Throwable?): String {
        if (error == null) return "unknown"
        var cursor: Throwable = error
        var depth = 0
        while (cursor.cause != null && depth < 4) {
            cursor = cursor.cause!!
            depth++
        }
        return cursor.message ?: cursor.javaClass.simpleName
    }
}
