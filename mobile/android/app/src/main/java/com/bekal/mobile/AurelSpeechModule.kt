package com.bekal.mobile

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream

class AurelSpeechModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AurelSpeechModule"

    private var audioRecord: AudioRecord? = null
    private var isRecording = false
    private var recordingThread: Thread? = null

    private val SAMPLE_RATE = 16000
    private val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
    private val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
    private val BUFFER_SIZE = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)

    @ReactMethod
    fun startListening(language: String, promise: Promise) {
        try {
            if (isRecording) {
                stopRecording()
            }
            startRecording()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopListening(promise: Promise) {
        try {
            stopRecording()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun startRecordingChunk(promise: Promise) {
        startRecordingChunkForDuration(3000, promise)
    }

    @ReactMethod
    fun startRecordingChunkWithDuration(durationMs: Int, promise: Promise) {
        startRecordingChunkForDuration(durationMs, promise)
    }

    private fun startRecordingChunkForDuration(durationMs: Int, promise: Promise) {
        try {
            if (isRecording) stopRecording()

            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                BUFFER_SIZE * 4
            )

            val outputStream = ByteArrayOutputStream()
            isRecording = true
            audioRecord?.startRecording()

            recordingThread = Thread {
                val buffer = ByteArray(BUFFER_SIZE)
                val startTime = System.currentTimeMillis()

                while (isRecording && System.currentTimeMillis() - startTime < durationMs) {
                    val read = audioRecord?.read(buffer, 0, buffer.size) ?: 0
                    if (read > 0) {
                        outputStream.write(buffer, 0, read)
                    }
                }

                isRecording = false
                audioRecord?.stop()
                audioRecord?.release()
                audioRecord = null

                val audioData = outputStream.toByteArray()
                val base64Audio = Base64.encodeToString(audioData, Base64.DEFAULT)
                sendEvent("onRecordingComplete", base64Audio)
            }
            recordingThread?.start()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopRecordingChunk(promise: Promise) {
        try {
            isRecording = false
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun destroyRecognizer() {
        stopRecording()
    }

    private fun startRecording() {
        // Keep for compatibility
    }

    private fun stopRecording() {
        isRecording = false
        try {
            audioRecord?.stop()
        } catch (e: Exception) {
            // ignore
        }
        try {
            audioRecord?.release()
        } catch (e: Exception) {
            // ignore
        }
        audioRecord = null
    }

    private fun sendEvent(eventName: String, data: String) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(eventName, data)
    }
}
