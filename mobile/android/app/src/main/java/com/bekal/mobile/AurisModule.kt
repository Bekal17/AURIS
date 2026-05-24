package com.bekal.mobile

import android.content.Intent
import android.net.Uri
import android.os.Build
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
    fun isOverlayPermissionGranted(promise: Promise) {
        val granted = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            android.provider.Settings.canDrawOverlays(reactContext)
        } else {
            true
        }
        promise.resolve(granted)
    }

    @ReactMethod
    fun requestOverlayPermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            val intent = android.content.Intent(
                android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:${reactContext.packageName}")
            )
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
        }
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
    fun startFloatingService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(reactContext)) {
                return
            }
        }

        val intent = Intent(reactContext, AurisFloatingService::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    @ReactMethod
    fun stopFloatingService() {
        val intent = android.content.Intent(reactContext, AurisFloatingService::class.java)
        reactContext.stopService(intent)
    }

    @ReactMethod
    fun updateFloatingState(state: String) {
        val intent = android.content.Intent("AURIS_STATE_UPDATE")
        intent.putExtra("state", state)
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
