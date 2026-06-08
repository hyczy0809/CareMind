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

    /** Backend preference passed in from JS. */
    enum class BackendPref { AUTO, CPU, GPU }

    private val lock = Any()
    private val engineRef = AtomicReference<LlmInference?>(null)
    /** Absolute path of the model currently loaded into engineRef, if any. */
    private val loadedPathRef = AtomicReference<String?>(null)
    /** Backend the loaded engine was built against. */
    private val loadedBackendRef = AtomicReference<BackendPref?>(null)
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
        maxTokens: Int = 2048
    ): LlmInference {
        val current = engineRef.get()
        val loadedPath = loadedPathRef.get()
        val loadedBackend = loadedBackendRef.get()
        val loadedMaxTokens = loadedMaxTokensRef.get()
        if (current != null &&
            loadedPath == modelPath &&
            loadedBackend == backend &&
            loadedMaxTokens == maxTokens
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
                tokensInLock == maxTokens
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
                loadedMaxTokensRef.set(null)
                // Give the JVM a hint; native side controls its own heap, but
                // releasing the JNI handle helps reclaim the off-heap arena sooner.
                Runtime.getRuntime().gc()
            }

            val file = File(modelPath)
            if (!file.exists() || file.length() <= 0) {
                throw IllegalStateException("模型文件不存在或为空：$modelPath")
            }
            val fileSizeMb = file.length() / (1024 * 1024)
            logMemorySnapshot(context, "Pre-load model=${file.name} size=${fileSizeMb}MB")

            // Resolve backend. AUTO uses CPU for known-large models (>1.5 GB on disk)
            // because GPU delegate on most phones cannot fit the full model in VRAM
            // and will fall back / OOM mid-graph. Small models default to GPU.
            val effectiveBackend = when (backend) {
                BackendPref.CPU -> LlmInference.Backend.CPU
                BackendPref.GPU -> LlmInference.Backend.GPU
                BackendPref.AUTO -> if (fileSizeMb > 1500L) {
                    Log.i(TAG, "AUTO backend → CPU (model size ${fileSizeMb}MB > 1500MB heuristic).")
                    LlmInference.Backend.CPU
                } else {
                    Log.i(TAG, "AUTO backend → GPU (small model).")
                    LlmInference.Backend.GPU
                }
            }
            Log.i(
                TAG,
                "Creating LlmInference engine: path=$modelPath backend=$effectiveBackend maxTokens=$maxTokens"
            )

            val options = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(modelPath)
                .setMaxTokens(maxTokens)
                .setMaxTopK(64)
                .setPreferredBackend(effectiveBackend)
                .build()

            val startMs = System.currentTimeMillis()
            val engine = try {
                LlmInference.createFromOptions(context.applicationContext, options)
            } catch (t: Throwable) {
                // MediaPipe wraps native errors — log everything we have so the
                // logcat capture lets us tell OOM from "model format unsupported"
                // from "GPU delegate failed to compile".
                Log.e(TAG, "LlmInference.createFromOptions failed — backend=$effectiveBackend", t)
                logMemorySnapshot(context, "Post-failure")
                throw t
            }
            val elapsedMs = System.currentTimeMillis() - startMs
            Log.i(TAG, "LlmInference engine ready in ${elapsedMs}ms (backend=$effectiveBackend).")
            logMemorySnapshot(context, "Post-load engine ready")

            engineRef.set(engine)
            loadedPathRef.set(modelPath)
            loadedBackendRef.set(backend)
            loadedMaxTokensRef.set(maxTokens)
            return engine
        }
    }

    fun release() {
        synchronized(lock) {
            Log.i(TAG, "release() called; current path=${loadedPathRef.get()}")
            engineRef.getAndSet(null)?.close()
            loadedPathRef.set(null)
            loadedBackendRef.set(null)
            loadedMaxTokensRef.set(null)
        }
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
