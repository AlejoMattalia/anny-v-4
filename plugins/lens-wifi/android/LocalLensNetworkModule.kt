package com.anonymous.annyv4.lenswifi

import android.content.Context
import android.net.ConnectivityManager
import android.net.IpPrefix
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Base64
import com.facebook.react.bridge.*
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Route only lens traffic through its LAN; leave cloud/AI on Android's default route. */
internal object LocalLensNetwork {
    fun route(context: Context, url: URL): Network? {
        // Stream/status addresses normally come from the lens's authenticated IP.
        if (!url.host.matches(Regex("[0-9.]+"))) return null
        val address = InetAddress.getByName(url.host)
        val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        return connectivity.allNetworks.firstOrNull { network ->
            val capabilities = connectivity.getNetworkCapabilities(network)
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true &&
                connectivity.getLinkProperties(network)?.linkAddresses?.any { link ->
                    IpPrefix(link.address, link.prefixLength).contains(address)
                } == true
        }
    }
    fun open(context: Context, url: URL): HttpURLConnection =
        (route(context, url)?.openConnection(url) ?: url.openConnection()) as HttpURLConnection
}

class LocalLensNetworkModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "LocalLensNetwork"
    private class Request {
        val cancelled = AtomicBoolean(false)
        @Volatile var connection: HttpURLConnection? = null
        fun cancel() {cancelled.set(true); connection?.disconnect()}
    }
    private val requests = ConcurrentHashMap<String, Request>()
    private val executor = Executors.newFixedThreadPool(2)

    @ReactMethod fun cancel(id: String) {requests[id]?.cancel()}

    @ReactMethod fun request(id: String, target: String, secret: String, body: String?, timeout: Double, promise: Promise) {
        val pending = Request()
        if (requests.putIfAbsent(id, pending) != null) {promise.reject("LENS_REQUEST", "Solicitud duplicada"); return}
        try {
            executor.execute {
                try {
                    val url = URL(target)
                    val octets = url.host.split('.').mapNotNull { it.toIntOrNull() }
                    val privateIp = url.host.matches(Regex("[0-9.]+")) && octets.size == 4 && octets.all { it in 0..255 } &&
                        (octets[0] == 10 || (octets[0] == 192 && octets[1] == 168) ||
                            (octets[0] == 172 && octets[1] in 16..31))
                    val localName = url.host.matches(Regex("[a-zA-Z0-9][a-zA-Z0-9-]*\\.local"))
                    require(url.protocol == "http" && url.userInfo == null && (privateIp || localName))
                    require(url.path.startsWith("/api/") || url.path == "/capture")
                    require(body == null || body.toByteArray(Charsets.UTF_8).size <= 16384)
                    if (pending.cancelled.get()) throw InterruptedException()
                    val connection = LocalLensNetwork.open(reactApplicationContext, url)
                    pending.connection = connection
                    if (pending.cancelled.get()) throw InterruptedException()
                    connection.connectTimeout = timeout.toInt().coerceIn(1000, 30000)
                    connection.readTimeout = connection.connectTimeout
                    connection.instanceFollowRedirects = false
                    connection.useCaches = false
                    connection.setRequestProperty("Authorization", "Basic " + Base64.encodeToString("admin:$secret".toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
                    connection.setRequestProperty("X-Lentes-Request", "1")
                    if (body != null) {
                        connection.requestMethod = "POST"; connection.doOutput = true
                        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                        val bytes = body.toByteArray(Charsets.UTF_8)
                        connection.setFixedLengthStreamingMode(bytes.size)
                        connection.outputStream.use {it.write(bytes)}
                    }
                    val code = connection.responseCode
                    val limit = if (url.path == "/capture") 1048576 else 16384
                    val output = java.io.ByteArrayOutputStream()
                    val input = if (code in 200..299) connection.inputStream else connection.errorStream
                    input?.use {
                        val buffer = ByteArray(4096)
                        while (!pending.cancelled.get()) {
                            val read = it.read(buffer)
                            if (read < 0) break
                            require(output.size() + read <= limit)
                            output.write(buffer, 0, read)
                        }
                    }
                    if (pending.cancelled.get()) throw InterruptedException()
                    val bytes = output.toByteArray()
                    promise.resolve(Arguments.createMap().apply {
                        putInt("status", code)
                        putString("contentType", connection.contentType ?: "")
                        putString("body", if (url.path == "/capture") Base64.encodeToString(bytes, Base64.NO_WRAP) else String(bytes, Charsets.UTF_8))
                    })
                } catch (_: Exception) {
                    promise.reject("LENS_NETWORK", if (pending.cancelled.get()) "Conexión cancelada." else "No se pudo acceder a los lentes en esta red.")
                } finally {pending.connection?.disconnect(); requests.remove(id, pending)}
            }
        } catch (_: Exception) {requests.remove(id, pending); promise.reject("LENS_NETWORK", "Conexión no disponible.")}
    }
    override fun invalidate() {
        requests.values.forEach {it.cancel()}
        executor.shutdownNow()
        super.invalidate()
    }
}
