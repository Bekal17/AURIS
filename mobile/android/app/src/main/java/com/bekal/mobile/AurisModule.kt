package com.bekal.mobile

import com.facebook.react.bridge.*

class AurisModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AurisModule"

    init {
        AurisEventEmitter.init(reactContext)
    }

    @ReactMethod
    fun isAccessibilityEnabled(promise: Promise) {
        val enabled = android.provider.Settings.Secure.getString(
            reactContext.contentResolver,
            android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )?.contains("com.bekal.mobile/.AurisAccessibilityService") ?: false
        promise.resolve(enabled)
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
}
