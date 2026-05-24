package com.bekal.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
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
        const val ACTION_NOTIFICATION_STATE = "AURIS_NOTIFICATION_STATE"
        const val EXTRA_NOTIFICATION_STATE = "state"
        const val STATE_IDLE = "idle"
        const val STATE_LISTENING = "listening"
        const val STATE_SPEAKING = "speaking"
        const val STATE_ACTIVE = "active"
        var isRunning = false
    }

    private var notificationState = STATE_IDLE

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    ensureWakeLock()
                    updateNotificationState(STATE_LISTENING)
                    sendBroadcast(Intent("AURIS_RESTART_LISTENING"))
                    AurisEventEmitter.sendEvent("onRestartListening", "screen_off")
                }
                Intent.ACTION_SCREEN_ON -> {
                    ensureWakeLock()
                    updateNotificationState(STATE_ACTIVE)
                    AurisEventEmitter.sendEvent("onScreenOn", "screen_on")
                }
                ACTION_KEEP_SCREEN_ON -> {
                    setKeepScreenOn(intent.getBooleanExtra("enabled", false))
                }
                ACTION_NOTIFICATION_STATE -> {
                    updateNotificationState(
                        intent.getStringExtra(EXTRA_NOTIFICATION_STATE) ?: STATE_IDLE
                    )
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
        if (intent?.action == ACTION_NOTIFICATION_STATE) {
            updateNotificationState(intent.getStringExtra(EXTRA_NOTIFICATION_STATE) ?: STATE_IDLE)
        }
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
            addAction(ACTION_NOTIFICATION_STATE)
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
                NotificationManager.IMPORTANCE_DEFAULT
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

    private fun updateNotificationState(state: String) {
        notificationState = state
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification())
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
        val openAppPendingIntent = createOpenAppPendingIntent()
        val notificationText = when (notificationState) {
            STATE_IDLE -> "Mendengarkan... Ucapkan 'Auris'"
            STATE_LISTENING -> "Mendengarkan kamu..."
            STATE_SPEAKING -> "AURIS sedang berbicara..."
            STATE_ACTIVE -> "AURIS aktif"
            else -> "AURIS aktif"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AURIS Aktif")
            .setContentText(notificationText)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setLargeIcon(BitmapFactory.decodeResource(resources, R.drawable.auris_logo))
            .setContentIntent(openAppPendingIntent)
            .addAction(android.R.drawable.ic_menu_view, "Buka AURIS", openAppPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOngoing(true)
            .build()
    }

    private fun createOpenAppPendingIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE
            } else {
                0
            }
        return PendingIntent.getActivity(this, 0, intent, flags)
    }
}
