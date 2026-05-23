package com.bekal.mobile

import com.facebook.react.bridge.ReactApplicationContext

object AurisEventEmitter {
    private var reactContext: ReactApplicationContext? = null

    fun init(context: ReactApplicationContext) {
        reactContext = context
    }

    fun sendEvent(eventName: String, data: String) {
        reactContext?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(eventName, data)
    }
}
