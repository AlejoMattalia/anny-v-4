package com.anonymous.annyv4.lenswifi

import android.graphics.Bitmap
import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.voximplant.sdk.Voximplant
import com.voximplant.sdk.call.ICall
import com.voximplant.sdk.hardware.ICustomVideoSourceListener
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Feed the actual displayed lens frames into the call's WebRTC video track. */
internal object LocalLensCallVideo {
    @Volatile private var session: Session? = null

    @Synchronized fun setSource(context: Context, call: ICall, glasses: Boolean) {
        var current = session
        if (current != null && current.call.callId != call.callId) {
            current.close()
            session = null
            current = null
        }
        val selected = current ?: Session(context, call).also {
            session = it
            // Set once, before enabling the call's first outgoing video track.
            // The SDK setter does not replace an already-created video track.
            call.useCustomVideoSource(it.source)
        }
        selected.select(glasses)
    }

    // Called only for successfully displayed bitmaps, including decoded partials.
    // AI capture retains its separate policy of accepting complete JPEGs only.
    fun offer(bitmap: Bitmap) {
        val current = session ?: return
        if (current.glasses && current.started && !current.closed) current.frames.offer(bitmap)
    }

    @Synchronized fun stop(callId: String? = null) {
        val current = session ?: return
        if (callId != null && current.call.callId != callId) return
        session = null
        current.close()
    }

    private class Session(val context: Context, val call: ICall) : ICustomVideoSourceListener {
        val source = Voximplant.getCustomVideoSource()
        val frames = LocalLensLatestFrame<Bitmap>()
        @Volatile var glasses = true
        @Volatile var started = false
        @Volatile var closed = false
        private var captureStopped = false
        private val sourceLock = Object()
        private var released = false
        private val cameraControl = Executors.newSingleThreadExecutor { Thread(it, "AnnyCallCameraControl") }
        private var phone: LocalLensPhoneVideo? = null // Only accessed on cameraControl.
        private val worker = Thread({
            var pixels = IntArray(0)
            var sent = 0
            var statsAt = SystemClock.elapsedRealtime()
            try {
                while (!closed) {
                    val bitmap = frames.take() ?: break
                    if (closed || !glasses || !started) continue
                    // Cameras use even dimensions; crop one edge pixel if needed.
                    val width = bitmap.width and -2
                    val height = bitmap.height and -2
                    if (width == 0 || height == 0) continue
                    if (pixels.size != width * height) pixels = IntArray(width * height)
                    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
                    val data = LocalLensI420.convert(pixels, width, height)
                    synchronized(sourceLock) {
                        if (!closed && glasses && started) {
                            source.sendFrame(data, width, height)
                            sent++
                        }
                    }
                    val now = SystemClock.elapsedRealtime()
                    if (now - statsAt >= 2000) {
                        Log.i("AnnyLensStream", "CALL frames=$sent interval_ms=${now - statsAt} transport=webrtc")
                        sent = 0; statsAt = now
                    }
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (error: Exception) {
                Log.e("AnnyLensStream", "Lens call video stopped", error)
            }
        }, "AnnyLensCallVideo")

        init {
            source.setCustomVideoSourceListener(this)
            worker.start()
        }
        fun select(next: Boolean) {
            glasses = next
            frames.clear()
            updateCamera()
        }
        private fun updateCamera() {
            try { cameraControl.execute {
                try {
                    if (!closed && started && !glasses) {
                        if (phone == null) phone = LocalLensPhoneVideo(context) { data, width, height ->
                            synchronized(sourceLock) {
                                if (!closed && !glasses && started) source.sendFrame(data, width, height)
                            }
                        }
                    } else {
                        val previous = phone; phone = null; previous?.close()
                    }
                } catch (error: Exception) {
                    Log.e("AnnyLensStream", "Could not switch the phone camera", error)
                }
                if (closed) cameraControl.shutdown()
            } } catch (_: RejectedExecutionException) { /* A late SDK callback after cleanup. */ }
        }
        override fun onStarted() {
            synchronized(sourceLock) { started = true; captureStopped = false }
            updateCamera()
        }
        override fun onStopped() = synchronized(sourceLock) {
            started = false
            captureStopped = true
            frames.clear()
            updateCamera()
            if (closed) release()
        }
        fun close() = synchronized(sourceLock) {
            closed = true
            frames.close()
            worker.interrupt()
            updateCamera()
            if (captureStopped) release()
            // The SDK owns the capturer until onStopped. Do not dispose it
            // while a queued source change or hangup still uses it.
        }
        private fun release() {
            if (released) return
            released = true
            source.setCustomVideoSourceListener(null)
            source.release()
        }
    }
}
