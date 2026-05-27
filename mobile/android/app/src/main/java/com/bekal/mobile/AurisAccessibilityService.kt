package com.bekal.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class AurisAccessibilityService : AccessibilityService() {
    private var latestWhatsAppNotification: android.app.Notification? = null

    companion object {
        var instance: AurisAccessibilityService? = null
        private var currentService: AurisAccessibilityService? = null

        fun replyToLatestNotification(message: String): Boolean {
            return currentService?.replyViaNotificationAction(message) ?: false
        }
    }

    override fun onServiceConnected() {
        instance = this
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
                    latestWhatsAppNotification = notification
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
        if (instance == this) {
            instance = null
        }
        if (currentService == this) {
            currentService = null
        }
        super.onDestroy()
    }

    override fun onUnbind(intent: Intent?): Boolean {
        if (instance == this) {
            instance = null
        }
        if (currentService == this) {
            currentService = null
        }
        return super.onUnbind(intent)
    }

    fun replyViaNotificationAction(message: String): Boolean {
        latestWhatsAppNotification?.let { notification ->
            if (replyViaNotificationActions(notification, message)) {
                return true
            }
        }

        val notificationManager = getSystemService(NOTIFICATION_SERVICE)
            as? android.app.NotificationManager ?: return false
        val notifications = notificationManager.activeNotifications
        for (sbn in notifications) {
            if (sbn.packageName == "com.whatsapp" || sbn.packageName == "com.whatsapp.w4b") {
                if (replyViaNotificationActions(sbn.notification, message)) {
                    return true
                }
            }
        }
        return replyToNotification(message)
    }

    private fun replyViaNotificationActions(
        notification: android.app.Notification,
        message: String
    ): Boolean {
        val actions = notification.actions ?: return false
        for (action in actions) {
            val actionTitle = action.title?.toString()?.lowercase() ?: continue
            if (actionTitle.contains("balas") || actionTitle.contains("reply")) {
                val remoteInputs = action.remoteInputs ?: continue
                val intent = android.content.Intent()
                val bundle = android.os.Bundle()
                for (remoteInput in remoteInputs) {
                    bundle.putCharSequence(remoteInput.resultKey, message)
                }
                android.app.RemoteInput.addResultsToIntent(remoteInputs, intent, bundle)
                action.actionIntent.send(this, 0, intent)
                return true
            }
        }
        return false
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
