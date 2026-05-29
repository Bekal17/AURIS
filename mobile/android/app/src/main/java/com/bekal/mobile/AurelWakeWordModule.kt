package com.bekal.mobile

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

class AurelWakeWordModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AurelWakeWordModule"

    private var interpreter: Interpreter? = null
    private var audioRecord: AudioRecord? = null
    private var isListening = false
    private var listeningThread: Thread? = null

    private val SAMPLE_RATE = 44100
    private val BUFFER_SIZE = AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT
    )
    private val MODEL_INPUT_SIZE = 44032 // Input sample count, not byte count (~1 second at 44100Hz)

    @ReactMethod
    fun initialize(promise: Promise) {
        try {
            val model = loadModelFile()
            interpreter = Interpreter(model)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to load model: ${e.message}")
        }
    }

    @ReactMethod
    fun startWakeWordListening(promise: Promise) {
        try {
            if (interpreter == null) {
                val model = loadModelFile()
                interpreter = Interpreter(model)
            }

            if (isListening) {
                promise.resolve(true)
                return
            }

            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                BUFFER_SIZE * 4
            )

            isListening = true
            audioRecord?.startRecording()

            listeningThread = Thread {
                val audioBuffer = ShortArray(MODEL_INPUT_SIZE)
                val tempBuffer = ShortArray(BUFFER_SIZE)
                var bufferIndex = 0

                while (isListening) {
                    val read = audioRecord?.read(tempBuffer, 0, tempBuffer.size) ?: 0
                    if (read > 0) {
                        for (i in 0 until read) {
                            if (bufferIndex < MODEL_INPUT_SIZE) {
                                audioBuffer[bufferIndex++] = tempBuffer[i]
                            }
                        }

                        if (bufferIndex >= MODEL_INPUT_SIZE) {
                            val result = runInference(audioBuffer)
                            bufferIndex = MODEL_INPUT_SIZE / 2
                            System.arraycopy(audioBuffer, MODEL_INPUT_SIZE / 2, audioBuffer, 0, MODEL_INPUT_SIZE / 2)

                            when {
                                result.aurelConfidence > 0.85f -> {
                                    sendEvent("onWakeWordDetected", "AUREL:${result.aurelConfidence}")
                                }
                                result.stopConfidence > 0.85f -> {
                                    sendEvent("onWakeWordDetected", "STOP")
                                }
                            }
                        }
                    }
                }
            }
            listeningThread?.start()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopWakeWordListening(promise: Promise) {
        try {
            stopListening()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    private data class InferenceResult(
        val aurelConfidence: Float,
        val backgroundConfidence: Float,
        val stopConfidence: Float
    )

    private fun runInference(audioBuffer: ShortArray): InferenceResult {
        // Model expects float32, so convert Short (-32768..32767) to Float (-1.0..1.0).
        val inputBuffer = ByteBuffer.allocateDirect(MODEL_INPUT_SIZE * 4)
            .order(ByteOrder.nativeOrder())

        for (sample in audioBuffer) {
            inputBuffer.putFloat(sample / 32768.0f)
        }
        inputBuffer.rewind()

        val outputBuffer = Array(1) { FloatArray(3) }
        interpreter?.run(inputBuffer, outputBuffer)

        return InferenceResult(
            aurelConfidence = outputBuffer[0][0],
            backgroundConfidence = outputBuffer[0][1],
            stopConfidence = outputBuffer[0][2]
        )
    }

    private fun loadModelFile(): MappedByteBuffer {
        val assetManager = reactContext.assets
        val fileDescriptor = assetManager.openFd("soundclassifier_with_metadata.tflite")
        val inputStream = FileInputStream(fileDescriptor.fileDescriptor)
        val fileChannel = inputStream.channel
        return fileChannel.map(
            FileChannel.MapMode.READ_ONLY,
            fileDescriptor.startOffset,
            fileDescriptor.declaredLength
        )
    }

    private fun sendEvent(eventName: String, data: String) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(eventName, data)
    }

    private fun stopListening() {
        isListening = false
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

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        stopListening()
        interpreter?.close()
        interpreter = null
    }
}
