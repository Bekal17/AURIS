package com.bekal.mobile

import android.app.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.os.IBinder
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class AurisForegroundService : Service() {
    private lateinit var wakeLock: PowerManager.WakeLock
    private lateinit var windowManager: WindowManager
    private var keepScreenOnView: View? = null
    private var keepScreenOnEnabled = false

    companion object {
        const val CHANNEL_ID = "auris_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_KEEP_SCREEN_ON = "AURIS_KEEP_SCREEN_ON"
        var isRunning = false
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    ensureWakeLock()
                    sendBroadcast(Intent("AURIS_STATE_UPDATE").putExtra("state", "listening"))
                    sendBroadcast(Intent("AURIS_RESTART_LISTENING"))
                    AurisEventEmitter.sendEvent("onRestartListening", "screen_off")
                }
                Intent.ACTION_SCREEN_ON -> {
                    ensureWakeLock()
                    sendBroadcast(Intent("AURIS_STATE_UPDATE").putExtra("state", "active"))
                    AurisEventEmitter.sendEvent("onScreenOn", "screen_on")
                }
                ACTION_KEEP_SCREEN_ON -> {
                    setKeepScreenOn(intent.getBooleanExtra("enabled", false))
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createWakeLock()
        ensureWakeLock()
        registerScreenReceiver()
        createNotificationChannel()
        startAurisForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        unregisterReceiver(screenReceiver)
        setKeepScreenOn(false)
        if (::wakeLock.isInitialized && wakeLock.isHeld) {
            wakeLock.release()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AURIS::WakeLock"
        )
        wakeLock.setReferenceCounted(false)
    }

    private fun ensureWakeLock() {
        if (!wakeLock.isHeld) {
            wakeLock.acquire()
        }
    }

    private fun registerScreenReceiver() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(ACTION_KEEP_SCREEN_ON)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenReceiver, filter)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "AURIS Voice Assistant",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "AURIS is listening in background"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun startAurisForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun setKeepScreenOn(enabled: Boolean) {
        keepScreenOnEnabled = enabled

        if (!enabled) {
            keepScreenOnView?.let {
                windowManager.removeView(it)
                keepScreenOnView = null
            }
            return
        }

        if (keepScreenOnView != null) return

        try {
            keepScreenOnView = View(this).also { view ->
                val params = WindowManager.LayoutParams(
                    1,
                    1,
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    else
                        WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                    PixelFormat.TRANSLUCENT
                ).apply {
                    gravity = Gravity.TOP or Gravity.START
                    x = 0
                    y = 0
                }
                windowManager.addView(view, params)
            }
        } catch (e: Exception) {
            keepScreenOnView = null
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AURIS is active")
            .setContentText("AURIS aktif - Mendengarkan di background")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .build()
    }
}
