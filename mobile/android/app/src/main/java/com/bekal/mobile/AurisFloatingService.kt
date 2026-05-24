package com.bekal.mobile

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView

class AurisFloatingService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var floatingView: View
    private lateinit var logoView: ImageView
    private var pulseAnimator: AnimatorSet? = null
    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f

    companion object {
        const val ACTION_STATE_UPDATE = "AURIS_STATE_UPDATE"
        const val STATE_IDLE = "idle"
        const val STATE_LISTENING = "listening"
        const val STATE_SPEAKING = "speaking"
        const val STATE_ACTIVE = "active"
        var isRunning = false
        var currentState = STATE_IDLE // idle, listening, speaking, active
    }

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_STATE_UPDATE) {
                updateState(intent.getStringExtra("state") ?: STATE_IDLE)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val params = WindowManager.LayoutParams(
            120, 120,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = 0
            y = 200
        }

        floatingView = LayoutInflater.from(this).inflate(R.layout.floating_auris, null)
        logoView = floatingView.findViewById(R.id.floating_logo)

        floatingView.setOnTouchListener { view, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = initialX + (initialTouchX - event.rawX).toInt()
                    params.y = initialY + (event.rawY - initialTouchY).toInt()
                    windowManager.updateViewLayout(floatingView, params)
                    true
                }
                else -> false
            }
        }

        windowManager.addView(floatingView, params)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stateReceiver, IntentFilter(ACTION_STATE_UPDATE), RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(stateReceiver, IntentFilter(ACTION_STATE_UPDATE))
        }
        updateState(currentState)
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        pulseAnimator?.cancel()
        unregisterReceiver(stateReceiver)
        if (::floatingView.isInitialized) {
            windowManager.removeView(floatingView)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    fun updateState(state: String) {
        currentState = state
        if (!::logoView.isInitialized) return

        pulseAnimator?.cancel()
        pulseAnimator = null
        logoView.scaleX = 1.0f
        logoView.scaleY = 1.0f
        logoView.clearColorFilter()
        floatingView.background = null

        when (state) {
            STATE_LISTENING -> {
                logoView.alpha = 1.0f
                startPulseAnimation(1.2f, 900L)
            }
            STATE_SPEAKING -> {
                logoView.alpha = 1.0f
                logoView.setColorFilter(Color.GREEN, PorterDuff.Mode.SRC_ATOP)
                startPulseAnimation(1.3f, 450L)
            }
            STATE_ACTIVE -> {
                logoView.alpha = 1.0f
                floatingView.background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.argb(45, 0, 255, 80))
                    setStroke(4, Color.argb(180, 0, 255, 80))
                }
            }
            else -> {
                logoView.alpha = 0.5f
            }
        }
    }

    private fun startPulseAnimation(targetScale: Float, duration: Long) {
        val scaleX = ObjectAnimator.ofFloat(logoView, View.SCALE_X, 1.0f, targetScale).apply {
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            this.duration = duration
        }
        val scaleY = ObjectAnimator.ofFloat(logoView, View.SCALE_Y, 1.0f, targetScale).apply {
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            this.duration = duration
        }
        pulseAnimator = AnimatorSet().apply {
            playTogether(scaleX, scaleY)
            start()
        }
    }
}
