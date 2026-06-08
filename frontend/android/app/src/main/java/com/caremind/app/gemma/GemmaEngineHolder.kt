package com.caremind.app.gemma

import android.app.ActivityManager
import android.content.Context
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

    private const val MAX_ENGINE_TOKENS = 768
    private const val MAX_LOADABLE_MODEL_BYTES = 1_500_000_000L
    private const val MIN_AVAILABLE_MEMORY_BYTES = 700_000_000L

    private val lock = Any()
    private val engineRef = AtomicReference<LlmInference?>(null)
    /** Absolute path of the model currently loaded into engineRef, if any. */
    private val loadedPathRef = AtomicReference<String?>(null)
    private val generationLock = Any()

    fun isLoaded(): Boolean = engineRef.get() != null

    fun loadedPath(): String? = loadedPathRef.get()

    /**
     * Ensure an engine instance loaded with [modelPath] is available. If a
     * different model is currently loaded, releases it first.
     */
    fun ensureEngine(context: Context, modelPath: String): LlmInference {
        val current = engineRef.get()
        val loadedPath = loadedPathRef.get()
        if (current != null && loadedPath == modelPath) return current

        synchronized(lock) {
            val currentInLock = engineRef.get()
            val loadedInLock = loadedPathRef.get()
            if (currentInLock != null && loadedInLock == modelPath) return currentInLock

            // A different model is loaded — release the old one before swapping.
            if (currentInLock != null) {
                try {
                    currentInLock.close()
                } catch (_: Throwable) {
                    // swallow; we are tearing down anyway
                }
                engineRef.set(null)
                loadedPathRef.set(null)
            }

            val file = File(modelPath)
            if (!file.exists() || file.length() <= 0) {
                throw IllegalStateException("模型文件不存在或为空：$modelPath")
            }
            assertCanLoadModel(context.applicationContext, file)

            val options = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(modelPath)
                .setMaxTokens(MAX_ENGINE_TOKENS)
                .setMaxTopK(64)
                .build()

            val engine = try {
                LlmInference.createFromOptions(context.applicationContext, options)
            } catch (error: OutOfMemoryError) {
                engineRef.set(null)
                loadedPathRef.set(null)
                throw IllegalStateException("端侧模型加载内存不足。请关闭其他应用后重试，或在隐私模式里切换到 Gemma 3 1B。", error)
            } catch (error: Throwable) {
                engineRef.set(null)
                loadedPathRef.set(null)
                val reason = error.message ?: error.javaClass.simpleName
                throw IllegalStateException("端侧模型加载失败：$reason", error)
            }
            engineRef.set(engine)
            loadedPathRef.set(modelPath)
            return engine
        }
    }

    private fun assertCanLoadModel(context: Context, file: File) {
        if (file.length() > MAX_LOADABLE_MODEL_BYTES) {
            throw IllegalStateException(
                "当前端侧演示默认使用 Gemma 3 1B。${file.name} 体积较大，容易导致手机内存不足或闪退，请在隐私模式里切换到 Gemma 3 1B。"
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
            engineRef.getAndSet(null)?.close()
            loadedPathRef.set(null)
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
}
