package com.anonymous.annyv4.lenswifi

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Base64
import android.util.Log
import android.os.SystemClock
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

private class LensStreamEvent(surfaceId: Int, viewId: Int, private val name: String) :
    Event<LensStreamEvent>(surfaceId, viewId) {
    override fun getEventName() = name
    override fun getEventData(): WritableMap = Arguments.createMap()
}

/** Drain the MJPEG socket independently of decoding and display only the latest frame. */
class LocalLensStreamView(context: ThemedReactContext) : FrameLayout(context) {
    var endpoint = ""
    var credential = ""
    private var activeConfig = ""
    @Volatile private var generation = 0
    private var activeSocket: AtomicReference<HttpURLConnection?>? = null
    private var worker: Thread? = null
    private var decoder: Thread? = null
    private var framesOwner: Any? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val image = LocalLensSurface(context)
    private val status = TextView(context).apply { setTextColor(Color.WHITE); setBackgroundColor(0x99000000.toInt()); setPadding(18, 10, 18, 10); text = "Conectando video…" }
    init {
        addView(image, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(status, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START))
    }
    private fun emitStreamEvent(name: String) {
        val reactContext = context as ThemedReactContext
        UIManagerHelper.getEventDispatcher(reactContext)?.dispatchEvent(
            LensStreamEvent(UIManagerHelper.getSurfaceId(this), id, name))
    }
    fun stop() {
        generation++
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        activeSocket?.getAndSet(null)?.disconnect()
        activeSocket = null
        worker?.interrupt()
        worker = null
        decoder?.interrupt()
        decoder = null
        framesOwner?.let { LocalLensFrames.clear(it) }
        framesOwner = null
        activeConfig = ""
    }
    fun refresh() {
        if (!isAttachedToWindow || endpoint.isEmpty() || credential.isEmpty()) return
        val config = "$endpoint\n$credential"
        if (config == activeConfig) return
        stop()
        activeConfig = config
        // Keep the receiving radio responsive while video is visible. CPU wake
        // locks alone do not prevent Wi-Fi power-save buffering on a hotspot.
        try {
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
            wifiLock = wifi.createWifiLock(mode, "Anny:LensVideo").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (error: RuntimeException) {
            Log.w("AnnyLensStream", "Wi-Fi latency lock unavailable: ${error.javaClass.simpleName}")
        }
        val token = generation
        val target = endpoint
        val secret = credential
        val socketRef = AtomicReference<HttpURLConnection?>(null)
        activeSocket = socketRef
        val owner = Any()
        framesOwner = owner
        LocalLensFrames.begin(owner, target, secret)
        val frameMonitor = Object()
        val pendingFrames = LocalLensFrameQueue()
        val lastDecodedAt = AtomicLong(0)
        val noticePending = AtomicBoolean(false)
        var announcedReady = false // Accessed only by posted UI callbacks.
        var lastFrameNotice = 0L // Decoder-owned; throttle UI notices, not the video.
        var displayStatsAt = 0L
        var displayedFrames = 0
        var displayedPartials = 0
        var lastDisplayedAt = 0L
        var maxDisplayGap = 0L
        var maxDrawMs = 0L
        var maxBufferMs = 0L
        status.text = "Conectando video…"

        decoder = Thread {
            var lastDecodeWarning = 0L
            fun decode(jpeg: ByteArray): Bitmap? = try {
                BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
            } catch (_: IllegalArgumentException) { null }
            try {
                while (generation == token && !Thread.currentThread().isInterrupted) {
                    val frame = synchronized(frameMonitor) {
                        var next: LocalLensVideoFrame? = null
                        while (generation == token && next == null) {
                            val now = SystemClock.elapsedRealtime()
                            next = pendingFrames.poll(now)
                            if (next == null) frameMonitor.wait(pendingFrames.waitMs(now))
                        }
                        maxBufferMs = maxOf(maxBufferMs, pendingFrames.lastAgeMs)
                        next
                    } ?: break
                    if (generation != token) break
                    if (!LocalLensFramePolicy.shouldDecode(frame)) continue
                    var readableJpeg = frame.jpeg
                    val bitmap = decode(readableJpeg) ?: frame.prefix?.let { prefix ->
                        readableJpeg = prefix
                        decode(prefix)
                    }
                    if (bitmap == null) {
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastDecodeWarning >= 1000) {
                            lastDecodeWarning = now
                            Log.w("AnnyLensStream", "JPEG decoder could not read frame; partial=${frame.partial}")
                        }
                        continue
                    }
                    if (generation != token) { bitmap.recycle(); break }
                    lastDecodedAt.set(SystemClock.elapsedRealtime())
                    LocalLensFrames.publish(owner, readableJpeg, frame.partial || readableJpeg !== frame.jpeg)
                    val drawAt = SystemClock.elapsedRealtime()
                    // SurfaceView has its own buffer queue. No per-frame work is
                    // posted to React's main thread, even while AI updates the UI.
                    // Hardware Canvas owns bitmap references until GPU work ends;
                    // do not recycle a bitmap that has been submitted to it.
                    if (!image.display(bitmap) { generation == token }) continue
                    val now = SystemClock.elapsedRealtime()
                    maxDrawMs = maxOf(maxDrawMs, now - drawAt)
                    if (displayStatsAt == 0L) displayStatsAt = now
                    if (lastDisplayedAt != 0L) maxDisplayGap = maxOf(maxDisplayGap, now - lastDisplayedAt)
                    lastDisplayedAt = now
                    displayedFrames++
                    if (frame.partial) displayedPartials++
                    if (now - displayStatsAt >= 2000) {
                        Log.i("AnnyLensStream", "DISPLAY frames=$displayedFrames interval_ms=${now - displayStatsAt} partial_frames=$displayedPartials max_gap_ms=$maxDisplayGap max_draw_ms=$maxDrawMs max_buffer_ms=$maxBufferMs renderer=surface")
                        displayedFrames = 0
                        displayedPartials = 0
                        displayStatsAt = now
                        maxDisplayGap = 0
                        maxDrawMs = 0
                        maxBufferMs = 0
                    }
                    if ((lastFrameNotice == 0L || now - lastFrameNotice >= 2000) && noticePending.compareAndSet(false, true)) {
                        lastFrameNotice = now
                        post {
                            noticePending.set(false)
                            if (generation == token) {
                                if (status.text != "En vivo") status.text = "En vivo"
                                emitStreamEvent("topStreamFrame")
                                if (!announcedReady) {
                                    announcedReady = true
                                    emitStreamEvent("topStreamReady")
                                }
                            }
                        }
                    }
                }
            } catch (_: InterruptedException) {
                // Closing the screen interrupts a decoder waiting for a frame.
            } finally {
                synchronized(frameMonitor) { pendingFrames.clear() }
            }
        }.apply { name = "AnnyLensDecode"; start() }

        val deliver: (LocalLensVideoFrame) -> Unit = { frame ->
            if (generation == token) {
                synchronized(frameMonitor) {
                    pendingFrames.offer(frame, SystemClock.elapsedRealtime())
                    frameMonitor.notifyAll()
                }
            }
        }
        worker = Thread {
            try {
                LocalLensUdp.receive(context, target, secret, socketRef,
                    { generation == token && !Thread.currentThread().isInterrupted }, { lastDecodedAt.get() }, deliver)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (error: Exception) {
                if (generation == token) {
                    LocalLensFrames.invalidate(owner)
                    synchronized(frameMonitor) { pendingFrames.clear() }
                    post { if (generation == token) status.text = "Reconectando video…" }
                    Log.w("AnnyLensStream", "UDP unavailable; falling back to MJPEG: ${error.javaClass.simpleName}")
                }
            }
            while (generation == token && !Thread.currentThread().isInterrupted) {
                var socket: HttpURLConnection? = null
                try {
                    val url = URL(target)
                    require(url.protocol == "http" && url.userInfo == null && url.path == "/stream")
                    socket = LocalLensNetwork.open(context, url)
                    socketRef.set(socket)
                    if (generation != token) break
                    socket.connectTimeout = 10000
                    socket.readTimeout = 8000
                    socket.instanceFollowRedirects = false
                    socket.useCaches = false
                    socket.setRequestProperty("Authorization", "Basic " + Base64.encodeToString("admin:$secret".toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
                    require(socket.responseCode == 200)
                    require(socket.contentType?.startsWith("multipart/x-mixed-replace") == true)
                    BufferedInputStream(socket.inputStream, 16384).use { input ->
                        fun line(): String {
                            val bytes = StringBuilder()
                            while (bytes.length < 1024) {
                                val next = input.read()
                                if (next == -1) throw java.io.EOFException()
                                if (next == 10) return bytes.toString().trimEnd('\r')
                                bytes.append(next.toChar())
                            }
                            throw java.io.IOException("Invalid frame header")
                        }
                        var invalidFrames = 0
                        while (generation == token) {
                            var length = 0
                            var headerCount = 0
                            while (true) {
                                val header = line()
                                if (header.isEmpty() && length > 0) break
                                if (++headerCount > 32) throw java.io.IOException("Invalid frame")
                                if (header.startsWith("Content-Length:", true)) length = header.substringAfter(':').trim().toInt()
                            }
                            require(length in 4..1048576)
                            val frame = ByteArray(length)
                            var offset = 0
                            while (offset < length) {
                                val count = input.read(frame, offset, length - offset)
                                if (count < 0) throw java.io.EOFException()
                                offset += count
                            }
                            if (generation != token) break
                            val validJpeg = frame[0] == 0xff.toByte() && frame[1] == 0xd8.toByte() && frame[length - 2] == 0xff.toByte() && frame[length - 1] == 0xd9.toByte()
                            if (!validJpeg) {
                                LocalLensFrames.invalidate(owner)
                                if (++invalidFrames >= 5) throw java.io.IOException("Repeated invalid JPEGs")
                                Log.w("AnnyLensStream", "Discarding incomplete JPEG; keeping stream connection")
                                continue // Content-Length preserves alignment with the next frame.
                            }
                            invalidFrames = 0
                            deliver(LocalLensVideoFrame(frame, false))
                        }
                    }
                } catch (error: Exception) {
                    if (generation == token) {
                        LocalLensFrames.invalidate(owner)
                        synchronized(frameMonitor) { pendingFrames.clear() }
                        Log.w("AnnyLensStream", "Stream interrupted: ${error.javaClass.simpleName}")
                        post { if (generation == token) status.text = "Reconectando video…" }
                    }
                } finally {
                    socket?.disconnect()
                    socketRef.compareAndSet(socket, null)
                }
                // Release the old HTTP connection before the retry pause.
                if (generation != token) break
                try { Thread.sleep(750) } catch (_: InterruptedException) { break }
            }
        }.apply { name = "AnnyLensStream"; start() }
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); refresh() }
    override fun onDetachedFromWindow() { stop(); super.onDetachedFromWindow() }
}
class LocalLensStreamManager : SimpleViewManager<LocalLensStreamView>() {
    override fun getName() = "LocalLensStream"
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
        mutableMapOf(
            "topStreamReady" to mapOf("registrationName" to "onStreamReady"),
            "topStreamFrame" to mapOf("registrationName" to "onStreamFrame")
        )
    override fun createViewInstance(context: ThemedReactContext) = LocalLensStreamView(context)
    @ReactProp(name = "endpoint") fun setEndpoint(view: LocalLensStreamView, value: String?) { view.endpoint = value ?: "" }
    @ReactProp(name = "credential") fun setCredential(view: LocalLensStreamView, value: String?) { view.credential = value ?: "" }
    override fun onAfterUpdateTransaction(view: LocalLensStreamView) { super.onAfterUpdateTransaction(view); view.refresh() }
    override fun onDropViewInstance(view: LocalLensStreamView) { view.stop(); super.onDropViewInstance(view) }
}
