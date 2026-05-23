package com.bekal.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

class AurisAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        val info = AccessibilityServiceInfo()
        info.eventTypes = AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED
        info.packageNames = arrayOf("com.whatsapp")
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        serviceInfo = info
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.packageName == "com.whatsapp" && 
            event.eventType == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
            val notification = event.parcelableData
            val sender = event.text.firstOrNull()?.toString() ?: "Unknown"
            val message = event.text.getOrNull(1)?.toString() ?: ""
            AurisEventEmitter.sendEvent("onWhatsAppMessage", "$sender: $message")
        }
    }

    override fun onInterrupt() {}

    fun replyToNotification(message: String) {
        val root = rootInActiveWindow ?: return
        val replyField = root.findAccessibilityNodeInfosByViewId("com.whatsapp:id/entry").firstOrNull()
        replyField?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, message)
        })
        val sendBtn = root.findAccessibilityNodeInfosByViewId("com.whatsapp:id/send").firstOrNull()
        sendBtn?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }
}
