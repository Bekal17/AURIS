package com.bekal.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

class AurisAccessibilityService : AccessibilityService() {

    companion object {
        private var currentService: AurisAccessibilityService? = null

        fun replyToLatestNotification(message: String): Boolean {
            return currentService?.replyToNotification(message) ?: false
        }
    }

    override fun onServiceConnected() {
        currentService = this
        val info = AccessibilityServiceInfo()
        info.eventTypes = AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED
        info.packageNames = arrayOf("com.whatsapp", "com.whatsapp.w4b")
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        serviceInfo = info
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        if (event.eventType == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
            val packageName = event.packageName?.toString() ?: return
            if (packageName == "com.whatsapp" || packageName == "com.whatsapp.w4b") {
                val notification = event.parcelableData
                if (notification is android.app.Notification) {
                    val extras = notification.extras
                    val title = extras?.getString(android.app.Notification.EXTRA_TITLE) ?: ""
                    val text = extras?.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString() ?: ""

                    if (isIncomingWhatsAppCall(packageName, title)) {
                        AurisEventEmitter.sendEvent("onWhatsAppCall", title)
                        return
                    }

                    if (title.isNotEmpty() && text.isNotEmpty()) {
                        AurisEventEmitter.sendEvent("onWhatsAppMessage", "$title: $text")
                    }
                }
            }
        }
    }

    private fun isIncomingWhatsAppCall(packageName: String, title: String): Boolean {
        if (packageName != "com.whatsapp" && packageName != "com.whatsapp.w4b") {
            return false
        }

        val normalizedTitle = title.lowercase()
        return normalizedTitle.contains("panggilan masuk") ||
            normalizedTitle.contains("incoming call") ||
            normalizedTitle.contains("incoming video call")
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (currentService == this) {
            currentService = null
        }
        super.onDestroy()
    }

    fun replyToNotification(message: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val replyField = root.findAccessibilityNodeInfosByViewId("com.whatsapp:id/entry").firstOrNull()
        replyField?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, message)
        })
        val sendBtn = root.findAccessibilityNodeInfosByViewId("com.whatsapp:id/send").firstOrNull()
        sendBtn?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        return replyField != null && sendBtn != null
    }
}
