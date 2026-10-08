package com.anonymous.annyv4.lenswifi

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.IOException
import java.io.ByteArrayOutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Share fresh authenticated JPEGs between preview and still capture without a second socket. */
internal object LocalLensFrames {
    private data class Stream(
        val owner: Any,
        val endpoint: String,
        val credential: String,
        val jpeg: ByteArray? = null,
        val partial: Boolean = false,
        val receivedAt: Long = 0,
    )
    private val monitor = Object()
    private var stream: Stream? = null

    fun begin(owner: Any, endpoint: String, credential: String) = synchronized(monitor) {
        stream = Stream(owner, endpoint, credential)
        monitor.notifyAll()
    }
    fun publish(owner: Any, jpeg: ByteArray, partial: Boolean = false) = synchronized(monitor) {
        val current = stream
        if (current?.owner === owner && !partial) {
            // Keep clean frames for AI even while the preview displays a partial.
            stream = current.copy(jpeg = jpeg, partial = false, receivedAt = SystemClock.elapsedRealtime())
            monitor.notifyAll()
        }
    }
    fun invalidate(owner: Any) = synchronized(monitor) {
        val current = stream
        if (current?.owner === owner) {
            stream = current.copy(jpeg = null, receivedAt = 0)
            monitor.notifyAll()
        }
    }
    fun clear(owner: Any) = synchronized(monitor) {
        if (stream?.owner === owner) {stream = null; monitor.notifyAll()}
    }
    fun latest(endpoint: String, credential: String): String? {
        val current = synchronized(monitor) {stream} ?: return null
        if (current.endpoint != endpoint || current.credential != credential) return null
        if (current.jpeg == null) return null
        if (SystemClock.elapsedRealtime() - current.receivedAt > 500) return null
        return encode(current)
    }
    fun capture(endpoint: String, credential: String): String? {
        val snapshot: Stream
        synchronized(monitor) {
            val initial = stream ?: return null // No preview: allow a standalone /capture.
            if (initial.endpoint != endpoint || initial.credential != credential) return null
            val deadline = SystemClock.elapsedRealtime() + 2000
            while (true) {
                val current = stream
                if (current == null || current.owner !== initial.owner) {
                    throw IOException("La cámara se cerró. Volvé a abrirla para capturar.")
                }
                val now = SystemClock.elapsedRealtime()
                val frame = current.jpeg
                if (frame != null && now - current.receivedAt <= 500) {snapshot = current; break}
                val remaining = deadline - now
                if (remaining <= 0) throw IOException("La cámara está demorada. Esperá una imagen nueva y reintentá.")
                monitor.wait(remaining) // Releases lock: the reader keeps receiving video.
            }
        }
        return encode(snapshot)
    }

    private fun encode(snapshot: Stream): String {
        var jpeg = snapshot.jpeg ?: throw IOException("La cámara todavía no tiene una imagen.")
        // Preview only decodes. Normalize a readable partial JPEG on demand,
        // outside the monitor, so Scan/AI cannot stall the decoder or receiver.
        if (snapshot.partial) {
            val bitmap = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
                ?: throw IOException("La imagen llegó incompleta. Reintentá con la siguiente.")
            try {
                val normalized = ByteArrayOutputStream(jpeg.size)
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 90, normalized)) {
                    throw IOException("No se pudo preparar la imagen de los lentes.")
                }
                jpeg = normalized.toByteArray()
            } finally { bitmap.recycle() }
        }
        if (Thread.currentThread().isInterrupted) throw InterruptedException()
        synchronized(monitor) {
            if (stream?.owner !== snapshot.owner) throw IOException("La cámara se cerró. Volvé a abrirla para capturar.")
        }
        return Base64.encodeToString(jpeg, Base64.NO_WRAP)
    }
}

class LocalLensFramesModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val captures = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(1))
    override fun getName() = "LocalLensFrames"

    @ReactMethod
    fun getLatestFrame(endpoint: String, credential: String, promise: Promise) {
        enqueue(promise) { LocalLensFrames.latest(endpoint, credential) }
    }
    @ReactMethod
    fun captureStreamFrame(endpoint: String, credential: String, promise: Promise) {
        enqueue(promise) { LocalLensFrames.capture(endpoint, credential) }
    }
    private fun enqueue(promise: Promise, capture: () -> String?) {
        try {
            captures.execute {
                try {promise.resolve(capture())}
                catch (_: InterruptedException) {Thread.currentThread().interrupt(); promise.reject("E_LENS_CANCELLED", "Captura cancelada.")}
                catch (error: IOException) {promise.reject("E_LENS_FRAME", error.message)}
                catch (_: Exception) {promise.reject("E_LENS_FRAME", "No se pudo obtener la imagen de los lentes.")}
            }
        } catch (_: RejectedExecutionException) {promise.reject("E_LENS_BUSY", "Ya hay una captura en curso.")}
    }
    override fun invalidate() {
        captures.shutdownNow()
        super.invalidate()
    }
}
