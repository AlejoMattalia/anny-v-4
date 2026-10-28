// CallManager exposes call lookup to this package in the installed RN SDK.
package com.voximplant.reactnative

import com.anonymous.annyv4.lenswifi.LocalLensCallVideo
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LocalLensCallModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "LocalLensCallVideo"

    @ReactMethod fun setSource(callId: String, glasses: Boolean, promise: Promise) {
        try {
            val call = CallManager.getInstance().getCallById(callId)
                ?: throw IllegalStateException("La llamada ya terminó.")
            LocalLensCallVideo.setSource(reactApplicationContext, call, glasses)
            promise.resolve(null)
        } catch (error: Exception) { promise.reject("E_LENS_CALL", error.message, error) }
    }
    @ReactMethod fun stop(callId: String, promise: Promise) {
        LocalLensCallVideo.stop(callId)
        promise.resolve(null)
    }
    override fun invalidate() {
        LocalLensCallVideo.stop()
        super.invalidate()
    }
}
