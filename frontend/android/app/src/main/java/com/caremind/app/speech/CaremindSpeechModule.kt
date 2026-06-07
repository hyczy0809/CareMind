package com.caremind.app.speech

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

class CaremindSpeechModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    RecognitionListener {

    private val tag = "CaremindSpeech"
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var stopRequested = false

    override fun getName(): String = "CaremindSpeech"

    @ReactMethod
    fun isAvailable(promise: Promise) {
        try {
            promise.resolve(SpeechRecognizer.isRecognitionAvailable(reactContext))
        } catch (t: Throwable) {
            promise.reject("SPEECH_AVAILABLE_FAILED", t.message ?: "speech availability failed", t)
        }
    }

    @ReactMethod
    fun start(locale: String?, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                if (!SpeechRecognizer.isRecognitionAvailable(reactContext)) {
                    promise.reject("SPEECH_UNAVAILABLE", "当前手机没有可用的系统语音识别服务。")
                    return@runOnUiThread
                }

                destroyRecognizer()
                stopRequested = false

                recognizer = SpeechRecognizer.createSpeechRecognizer(reactContext).also {
                    it.setRecognitionListener(this)
                }

                val language = normalizeLocale(locale)
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, reactContext.packageName)
                }

                listening = true
                recognizer?.startListening(intent)
                emitState("listening")
                promise.resolve(null)
            } catch (t: Throwable) {
                Log.w(tag, "start failed", t)
                cleanup()
                promise.reject("SPEECH_START_FAILED", t.message ?: "语音识别启动失败。", t)
            }
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                stopRequested = true
                if (!listening || recognizer == null) {
                    promise.resolve(null)
                    return@runOnUiThread
                }
                recognizer?.stopListening()
                emitState("transcribing")
                promise.resolve(null)
            } catch (t: Throwable) {
                Log.w(tag, "stop failed", t)
                cleanup()
                promise.reject("SPEECH_STOP_FAILED", t.message ?: "语音识别停止失败。", t)
            }
        }
    }

    @ReactMethod
    fun cancel(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                recognizer?.cancel()
                cleanup()
                promise.resolve(null)
            } catch (t: Throwable) {
                cleanup()
                promise.reject("SPEECH_CANCEL_FAILED", t.message ?: "语音识别取消失败。", t)
            }
        }
    }

    override fun onReadyForSpeech(params: Bundle?) {
        emitState("ready")
    }

    override fun onBeginningOfSpeech() {
        emitState("listening")
    }

    override fun onRmsChanged(rmsdB: Float) = Unit

    override fun onBufferReceived(buffer: ByteArray?) = Unit

    override fun onEndOfSpeech() {
        emitState("transcribing")
    }

    override fun onError(error: Int) {
        val message = errorMessage(error)
        val shouldTreatAsSoftStop =
            stopRequested && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
        cleanup()
        if (shouldTreatAsSoftStop) {
            emitError("没有听到清楚内容，可以靠近一点再试。", error)
            return
        }
        emitError(message, error)
    }

    override fun onResults(results: Bundle?) {
        val transcript = extractTranscript(results)
        cleanup()
        if (transcript.isBlank()) {
            emitError("没有听到清楚内容，可以靠近一点再试。", SpeechRecognizer.ERROR_NO_MATCH)
            return
        }
        emitResult(transcript, true)
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val transcript = extractTranscript(partialResults)
        if (transcript.isNotBlank()) {
            emitResult(transcript, false)
        }
    }

    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    override fun invalidate() {
        super.invalidate()
        UiThreadUtil.runOnUiThread {
            destroyRecognizer()
        }
    }

    private fun normalizeLocale(locale: String?): String {
        val raw = locale?.trim().orEmpty()
        if (raw.isBlank()) return "zh-CN"
        if (raw.equals("zh", ignoreCase = true)) return "zh-CN"
        return raw.replace('_', '-')
    }

    private fun extractTranscript(bundle: Bundle?): String {
        val matches = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        return matches?.firstOrNull()?.trim().orEmpty()
    }

    private fun emitResult(transcript: String, isFinal: Boolean) {
        val payload = Arguments.createMap().apply {
            putString("transcript", transcript)
            putBoolean("isFinal", isFinal)
        }
        emit("CaremindSpeech_Result", payload)
    }

    private fun emitError(message: String, code: Int) {
        val payload = Arguments.createMap().apply {
            putString("message", message)
            putInt("code", code)
        }
        emit("CaremindSpeech_Error", payload)
    }

    private fun emitState(state: String) {
        val payload = Arguments.createMap().apply {
            putString("state", state)
        }
        emit("CaremindSpeech_State", payload)
    }

    private fun emit(eventName: String, payload: WritableMap) {
        try {
            if (!reactContext.hasActiveReactInstance()) return
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, payload)
        } catch (t: Throwable) {
            Log.w(tag, "emit failed: $eventName", t)
        }
    }

    private fun cleanup() {
        listening = false
        stopRequested = false
        destroyRecognizer()
        emitState("idle")
    }

    private fun destroyRecognizer() {
        try {
            recognizer?.destroy()
        } catch (t: Throwable) {
            Log.w(tag, "destroy recognizer failed", t)
        } finally {
            recognizer = null
        }
    }

    private fun errorMessage(error: Int): String =
        when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "麦克风录音失败，可以检查权限后再试。"
            SpeechRecognizer.ERROR_CLIENT -> "语音识别暂时不可用，可以稍后再试。"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "没有麦克风权限，请在系统设置里允许 CareMind 使用麦克风。"
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "语音识别网络暂时不可用，可以先手动输入。"
            SpeechRecognizer.ERROR_NO_MATCH -> "没有听到清楚内容，可以靠近一点再试。"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "语音识别正在忙，请稍等一下再试。"
            SpeechRecognizer.ERROR_SERVER -> "系统语音识别服务暂时不可用。"
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "没有听到声音，可以再按住说一次。"
            else -> "这次没有成功转成文字，可以再试一次或手动输入。"
        }
}
