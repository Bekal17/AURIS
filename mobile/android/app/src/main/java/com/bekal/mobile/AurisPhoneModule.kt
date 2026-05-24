package com.bekal.mobile

import android.content.Context
import android.media.AudioManager
import android.app.NotificationManager
import android.os.Build
import android.telecom.TelecomManager
import com.facebook.react.bridge.*

class AurisPhoneModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AurisPhoneModule"

    private val audioManager by lazy {
        reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

    private val telecomManager by lazy {
        reactContext.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    }

    @ReactMethod
    fun answerCall(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                telecomManager.acceptRingingCall()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun rejectCall(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                telecomManager.endCall()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun answerWhatsAppCall(promise: Promise) {
        try {
            val notificationManager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notifications = notificationManager.activeNotifications
            for (notification in notifications) {
                if (notification.packageName == "com.whatsapp" || notification.packageName == "com.whatsapp.w4b") {
                    val actions = notification.notification.actions
                    for (action in actions ?: emptyArray()) {
                        val actionTitle = action.title?.toString()?.lowercase()
                        if (
                            actionTitle?.contains("terima") == true ||
                            actionTitle?.contains("answer") == true ||
                            actionTitle?.contains("angkat") == true
                        ) {
                            action.actionIntent.send()
                            promise.resolve(true)
                            return
                        }
                    }
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                telecomManager.acceptRingingCall()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun rejectWhatsAppCall(promise: Promise) {
        try {
            val notificationManager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notifications = notificationManager.activeNotifications
            for (notification in notifications) {
                if (notification.packageName == "com.whatsapp" || notification.packageName == "com.whatsapp.w4b") {
                    val actions = notification.notification.actions
                    for (action in actions ?: emptyArray()) {
                        val actionTitle = action.title?.toString()?.lowercase()
                        if (
                            actionTitle?.contains("tolak") == true ||
                            actionTitle?.contains("decline") == true ||
                            actionTitle?.contains("reject") == true
                        ) {
                            action.actionIntent.send()
                            promise.resolve(true)
                            return
                        }
                    }
                }
            }
            promise.resolve(false)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setSpeakerOn(enabled: Boolean, promise: Promise) {
        try {
            audioManager.isSpeakerphoneOn = enabled
            audioManager.mode = if (enabled) AudioManager.MODE_IN_CALL else AudioManager.MODE_NORMAL
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setMute(muted: Boolean, promise: Promise) {
        try {
            audioManager.isMicrophoneMute = muted
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setVolume(direction: String, promise: Promise) {
        try {
            when (direction) {
                "up" -> audioManager.adjustStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_RAISE,
                    AudioManager.FLAG_SHOW_UI
                )
                "down" -> audioManager.adjustStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_LOWER,
                    AudioManager.FLAG_SHOW_UI
                )
                "max" -> audioManager.setStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC),
                    AudioManager.FLAG_SHOW_UI
                )
                "min" -> audioManager.setStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    0,
                    AudioManager.FLAG_SHOW_UI
                )
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getAudioOutputDevice(promise: Promise) {
        try {
            val device = when {
                audioManager.isBluetoothScoOn -> "bluetooth"
                audioManager.isSpeakerphoneOn -> "speaker"
                else -> "earpiece"
            }
            promise.resolve(device)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setAudioToBluetoothHeadset(promise: Promise) {
        try {
            audioManager.startBluetoothSco()
            audioManager.isBluetoothScoOn = true
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setAudioToSpeaker(promise: Promise) {
        try {
            audioManager.stopBluetoothSco()
            audioManager.isBluetoothScoOn = false
            audioManager.isSpeakerphoneOn = true
            audioManager.mode = AudioManager.MODE_NORMAL
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setAudioToEarpiece(promise: Promise) {
        try {
            audioManager.stopBluetoothSco()
            audioManager.isBluetoothScoOn = false
            audioManager.isSpeakerphoneOn = false
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }
}
