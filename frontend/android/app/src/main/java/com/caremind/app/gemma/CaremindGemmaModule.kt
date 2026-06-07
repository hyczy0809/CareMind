package com.caremind.app.gemma

import android.util.Log
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
 * React Native bridge for on-device Gemma inference (MediaPipe LLM Inference API).
 *
 * Methods are exposed unchanged to JS as NativeModules.CaremindGemma. All long
 * work runs off the JS thread via a dedicated CoroutineScope; cancellation is
 * cooperative through per-request flags. The actual MediaPipe engine lives in
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
    fun downloadModel(filename: String?, url: String, promise: Promise) {
        val safeName = try {
            requireFilename(filename)
        } catch (t: Throwable) {
            promise.reject("DOWNLOAD_BAD_ARG", t)
            return
        }

        if (stubMode.get()) {
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
                val file = downloader.download(safeName, url) { bytes, total ->
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
    fun initEngine(filename: String?, promise: Promise) {
        if (stubMode.get()) {
            promise.resolve(null)
            return
        }
        scope.launch {
            try {
                val safeName = requireFilename(filename)
                GemmaEngineHolder.ensureEngine(
                    reactApplicationContext,
                    downloader.targetFile(safeName).absolutePath
                )
                promise.resolve(null)
            } catch (t: Throwable) {
                Log.w(tag, "initEngine failed", t)
                promise.reject("INIT_ENGINE_FAILED", t.message ?: "init engine failed", t)
            }
        }
    }

    // ----- Generation --------------------------------------------------------

    @ReactMethod
    fun generate(prompt: String, options: ReadableMap, promise: Promise) {
        val filename = options.getStringOrNull("filename")
        val requestId = options.getStringOrNull("requestId") ?: "req_${System.currentTimeMillis()}"
        val temperature = options.getDoubleOrDefault("temperature", 0.4).toFloat()
        val topK = options.getIntOrDefault("topK", 40)

        val job = scope.launch {
            val started = System.currentTimeMillis()
            try {
                if (stubMode.get()) {
                    val text = GemmaStub.respond(prompt)
                    promise.resolve(buildGenerationResult(text, null, System.currentTimeMillis() - started))
                    return@launch
                }

                val safeName = requireFilename(filename)
                val text = withContext(Dispatchers.IO) {
                    GemmaEngineHolder.runExclusive {
                        val engine = GemmaEngineHolder.ensureEngine(
                            reactApplicationContext,
                            downloader.targetFile(safeName).absolutePath
                        )
                        val session = GemmaEngineHolder.newSession(engine, topK, temperature, enableAudio = false)
                        session.use {
                            it.addQueryChunk(prompt)
                            it.generateResponse() ?: ""
                        }
                    }
                }
                promise.resolve(buildGenerationResult(text, null, System.currentTimeMillis() - started))
            } catch (t: Throwable) {
                Log.w(tag, "generate failed", t)
                promise.reject("GENERATE_FAILED", t.message ?: "generate failed", t)
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
        val temperature = options.getDoubleOrDefault("temperature", 0.4).toFloat()
        val topK = options.getIntOrDefault("topK", 40)

        val job = scope.launch {
            val started = System.currentTimeMillis()
            try {
                if (stubMode.get()) {
                    val text = GemmaStub.respond(prompt)
                    promise.resolve(buildGenerationResult(text, null, System.currentTimeMillis() - started))
                    return@launch
                }

                val safeName = requireFilename(filename)
                val audioBytes = readAudioFile(audioFilePath)
                val text = withContext(Dispatchers.IO) {
                    GemmaEngineHolder.runExclusive {
                        val engine = GemmaEngineHolder.ensureEngine(
                            reactApplicationContext,
                            downloader.targetFile(safeName).absolutePath
                        )
                        val session = GemmaEngineHolder.newSession(engine, topK, temperature, enableAudio = true)
                        session.use {
                            it.addQueryChunk(prompt)
                            it.addAudio(audioBytes)
                            it.generateResponse() ?: ""
                        }
                    }
                }
                promise.resolve(buildGenerationResult(text, null, System.currentTimeMillis() - started))
            } catch (t: Throwable) {
                Log.w(tag, "generateWithAudio failed", t)
                promise.reject("GENERATE_AUDIO_FAILED", t.message ?: "audio generate failed", t)
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

    private fun buildGenerationResult(text: String, tokenCount: Int?, elapsedMs: Long): WritableMap =
        Arguments.createMap().apply {
            putString("text", text)
            if (tokenCount != null) putInt("tokenCount", tokenCount)
            putDouble("elapsedMs", elapsedMs.toDouble())
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

    private fun ReadableMap.getDoubleOrDefault(key: String, defaultValue: Double): Double =
        if (hasKey(key) && !isNull(key)) getDouble(key) else defaultValue
}
