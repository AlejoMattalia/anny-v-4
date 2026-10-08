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
import android.widget.ImageView
import android.widget.TextView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

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
    private var queuedBitmap: AtomicReference<Bitmap?>? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val image = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER; setBackgroundColor(Color.BLACK) }
    private val status = TextView(context).apply { setTextColor(Color.WHITE); setBackgroundColor(0x99000000.toInt()); setPadding(18, 10, 18, 10); text = "Conectando video…" }
    init {
        addView(image, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(status, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START))
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
        queuedBitmap?.getAndSet(null)?.recycle()
        queuedBitmap = null
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
        val pendingFrame = AtomicReference<LocalLensVideoFrame?>(null)
        val pendingBitmap = AtomicReference<Bitmap?>(null)
        queuedBitmap = pendingBitmap
        val available = Semaphore(0)
        val drawing = AtomicBoolean(false)
        var announcedReady = false // Accessed only by posted UI callbacks.
        var lastFrameNotice = 0L // Throttle bridge events, not the video.
        var displayStatsAt = 0L
        var displayedFrames = 0
        status.text = "Conectando video…"

        decoder = Thread {
            var lastDecodeWarning = 0L
            var lastCompleteAt: Long? = null
            fun decode(jpeg: ByteArray): Bitmap? = try {
                BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
            } catch (_: IllegalArgumentException) { null }
            try {
                while (generation == token && !Thread.currentThread().isInterrupted) {
                    available.acquire()
                    available.drainPermits()
                    val frame = pendingFrame.getAndSet(null) ?: continue
                    if (generation != token) break
                    if (!LocalLensFramePolicy.shouldDecode(frame, SystemClock.elapsedRealtime(), lastCompleteAt)) continue
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
                    if (!frame.partial && readableJpeg === frame.jpeg) lastCompleteAt = SystemClock.elapsedRealtime()
                    LocalLensFrames.publish(owner, readableJpeg, frame.partial || readableJpeg !== frame.jpeg)
                    // Replaced pending bitmaps have never reached the ImageView.
                    pendingBitmap.getAndSet(bitmap)?.recycle()
                    if (generation != token) { pendingBitmap.getAndSet(null)?.recycle(); break }
                    if (drawing.compareAndSet(false, true)) {
                        postOnAnimation {
                            drawing.set(false)
                            val latest = pendingBitmap.getAndSet(null)
                            if (latest != null) {
                                if (generation == token) {
                                    image.setImageBitmap(latest)
                                    if (status.text != "En vivo") status.text = "En vivo"
                                    val now = SystemClock.elapsedRealtime()
                                    if (displayStatsAt == 0L) displayStatsAt = now
                                    displayedFrames++
                                    if (now - displayStatsAt >= 2000) {
                                        Log.i("AnnyLensStream", "DISPLAY frames=$displayedFrames interval_ms=${now - displayStatsAt}")
                                        displayedFrames = 0
                                        displayStatsAt = now
                                    }
                                    if (!announcedReady || now - lastFrameNotice >= 2000) {
                                        lastFrameNotice = now
                                        (context as ThemedReactContext).getJSModule(RCTEventEmitter::class.java)
                                            .receiveEvent(id, "topStreamFrame", null)
                                    }
                                    if (!announcedReady) {
                                        announcedReady = true
                                        (context as ThemedReactContext).getJSModule(RCTEventEmitter::class.java)
                                            .receiveEvent(id, "topStreamReady", null)
                                    }
                                } else latest.recycle()
                            }
                        }
                    }
                }
            } catch (_: InterruptedException) {
                // Closing the screen interrupts a decoder waiting for a frame.
            } finally {
                pendingFrame.set(null)
                if (generation != token) pendingBitmap.getAndSet(null)?.recycle()
            }
        }.apply { name = "AnnyLensDecode"; start() }

        val deliver: (LocalLensVideoFrame) -> Unit = { frame ->
            if (generation == token) {
                val previous = pendingFrame.getAndUpdate { queued -> LocalLensFramePolicy.next(queued, frame) }
                if (previous == null) available.release()
            }
        }
        worker = Thread {
            try {
                LocalLensUdp.receive(context, target, secret, socketRef,
                    { generation == token && !Thread.currentThread().isInterrupted }, deliver)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (error: Exception) {
                if (generation == token) {
                    LocalLensFrames.invalidate(owner)
                    pendingFrame.set(null)
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
                        pendingFrame.set(null)
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
