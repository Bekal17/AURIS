package com.bekal.mobile

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.*

class AurisModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AurisModule"

    init {
        AurisEventEmitter.init(reactContext)
    }

    @ReactMethod
    fun isAccessibilityEnabled(promise: Promise) {
        val enabledServices = Settings.Secure.getString(
            reactContext.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""

        val isEnabled = enabledServices.contains(
            reactContext.packageName, ignoreCase = true
        )
        promise.resolve(isEnabled)
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        val intent = android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(intent)
    }

    @ReactMethod
    fun startForegroundService() {
        val intent = android.content.Intent(reactContext, AurisForegroundService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    @ReactMethod
    fun stopForegroundService() {
        val intent = android.content.Intent(reactContext, AurisForegroundService::class.java)
        reactContext.stopService(intent)
    }

    @ReactMethod
    fun updateNotificationState(state: String) {
        val intent = Intent(AurisForegroundService.ACTION_NOTIFICATION_STATE)
        intent.putExtra(AurisForegroundService.EXTRA_NOTIFICATION_STATE, state)
        reactContext.sendBroadcast(intent)
    }

    @ReactMethod
    fun setKeepScreenOn(enabled: Boolean) {
        val intent = android.content.Intent(AurisForegroundService.ACTION_KEEP_SCREEN_ON)
        intent.putExtra("enabled", enabled)
        reactContext.sendBroadcast(intent)
    }

    @ReactMethod
    fun requestBatteryOptimizationExemption() {
        try {
            val pm = reactContext.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(reactContext.packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                intent.data = Uri.parse("package:${reactContext.packageName}")
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
            }
        } catch (e: Exception) {
            // ignore
        }
    }

    @ReactMethod
    fun isBatteryOptimizationExempted(promise: Promise) {
        try {
            val pm = reactContext.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
            promise.resolve(pm.isIgnoringBatteryOptimizations(reactContext.packageName))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
}
