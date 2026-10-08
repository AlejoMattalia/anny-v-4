package com.anonymous.annyv4.lenswifi

import android.os.SystemClock
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicReference

/** UDP JPEG transport adapted from Programacion; keep one bounded frame, never a backlog. */
internal object LocalLensUdp {
    private const val HEADER = 32
    private const val PAYLOAD = 1400
    private const val MAX_FRAME = 65536
    private val END = "ENDENDEND".toByteArray(Charsets.US_ASCII)

    fun receive(
        context: android.content.Context,
        target: String,
        secret: String,
        connectionRef: AtomicReference<HttpURLConnection?>,
        active: () -> Boolean,
        onFrame: (LocalLensVideoFrame) -> Unit,
    ) {
        val url = URL(target)
        require(url.protocol == "http" && url.userInfo == null && url.path == "/stream")
        val udp = DatagramSocket(0)
        var token: ByteArray? = null
        try {
            val network = LocalLensNetwork.route(context, url)
            network?.bindSocket(udp)
            udp.soTimeout = 40
            udp.receiveBufferSize = 256 * 1024
            // Bind first so the authenticated request advertises our actual receiving port.
            val deadline = SystemClock.elapsedRealtime() + 6000
            var reply: JSONObject? = null
            while (active() && reply == null) {
                val controlUrl = URL(url, "/api/stream/udp")
                val http = (network?.openConnection(controlUrl) ?: controlUrl.openConnection()) as HttpURLConnection
                connectionRef.set(http)
                try {
                    if (!active()) return
                    http.connectTimeout = 8000; http.readTimeout = 8000
                    http.instanceFollowRedirects = false; http.useCaches = false
                    http.requestMethod = "POST"; http.doOutput = true
                    http.setRequestProperty("Authorization", "Basic " + Base64.encodeToString("admin:$secret".toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
                    http.setRequestProperty("X-Lentes-Request", "1")
                    http.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    val body = "port=${udp.localPort}&partial=1&ack=0&fec=1&fec_group=2".toByteArray(Charsets.US_ASCII)
                    http.setFixedLengthStreamingMode(body.size)
                    http.outputStream.use { it.write(body) }
                    val code = http.responseCode
                    if (code == 409 && SystemClock.elapsedRealtime() < deadline) {
                        // Previous screen's lease may still be closing; don't immediately
                        // downgrade to TCP just because the same camera worker is busy.
                    } else {
                        if (code != 200) throw IOException("UDP negotiation HTTP $code")
                        val bytes = ByteArray(1025)
                        var count = 0
                        http.inputStream.use { input ->
                            while (count < bytes.size) {
                                val read = input.read(bytes, count, bytes.size - count)
                                if (read < 0) break
                                count += read
                            }
                        }
                        require(count in 1..1024)
                        reply = JSONObject(String(bytes, 0, count, Charsets.UTF_8))
                    }
                } finally {
                    http.disconnect(); connectionRef.compareAndSet(http, null)
                }
                if (reply == null) Thread.sleep(250)
            }
            if (!active()) return
            val config = reply ?: return
            require(config.getInt("version") == 1 && config.getInt("payload") == PAYLOAD && config.getInt("max_frame") == MAX_FRAME)
            val port = config.getInt("port")
            require(port in 1024..65535)
            val encoded = config.getString("token")
            require(encoded.matches(Regex("[0-9a-f]{32}")))
            val session = ByteArray(16) { encoded.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
            token = session
            val partial = config.optInt("partial", 0) == 1
            val acknowledge = config.optInt("ack", 0) == 1
            val fecGroup = config.optInt("fec", 0)
            require(fecGroup == 0 || fecGroup == 2 || fecGroup == 4)
            val fec = fecGroup != 0
            val groupSize = if (fec) fecGroup else 4
            udp.connect(network?.getByName(url.host) ?: InetAddress.getByName(url.host), port)
            Log.i("AnnyLensStream", "Using local UDP video; partial=$partial ack=$acknowledge fec=$fec group=$fecGroup")
            var heartbeat = 0L
            var lastPacket = SystemClock.elapsedRealtime()
            var lastUsable = lastPacket
            var framePacketAt = lastPacket
            val packetBytes = ByteArray(HEADER + PAYLOAD + 1)
            val packet = DatagramPacket(packetBytes, packetBytes.size)
            var current: LocalLensUdpFrame? = null
            var statsAt = SystemClock.elapsedRealtime()
            var completeFrames = 0
            var droppedFrames = 0
            var partialFrames = 0
            var repairedFragments = 0
            fun deliver(frame: LocalLensVideoFrame?) {
                if (!active()) return
                if (frame == null) { droppedFrames++; return }
                if (frame.partial) partialFrames++ else completeFrames++
                repairedFragments += frame.recoveredFragments
                lastUsable = SystemClock.elapsedRealtime()
                if (acknowledge && !frame.partial) current?.let { acknowledgeFrame(udp, session, it.id) }
                onFrame(frame)
            }
            while (active() && !Thread.currentThread().isInterrupted) {
                val now = SystemClock.elapsedRealtime()
                if (now - heartbeat >= 1000 || heartbeat == 0L) {
                    control(udp, session, 1); heartbeat = now
                }
                if (now - statsAt >= 2000) {
                    Log.i("AnnyLensStream", "UDP complete_frames=$completeFrames partial_candidates=$partialFrames recovered_fragments=$repairedFragments dropped_frames=$droppedFrames interval_ms=${now - statsAt}")
                    statsAt = now; completeFrames = 0; droppedFrames = 0; partialFrames = 0; repairedFragments = 0
                }
                if (now - lastPacket >= 5000) throw IOException("UDP has no packets")
                if (now - lastUsable >= 15000) throw IOException("UDP has no usable images")
                packet.length = packetBytes.size
                try { udp.receive(packet) } catch (_: SocketTimeoutException) {
                    // Hotspot firmware can spend 120 ms sending/retrying a frame.
                    // Give its tail/parity time to arrive before closing a partial JPEG.
                    // A newer frame still releases the previous image immediately.
                    if (SystemClock.elapsedRealtime() - framePacketAt >= 250) {
                        current?.takeUnless { it.finished }?.let { deliver(it.finish()) }
                    }
                    continue
                }
                val receivedAt = SystemClock.elapsedRealtime()
                val size = packet.length
                if (size <= HEADER || size > HEADER + PAYLOAD ||
                    packetBytes[0] != 65.toByte() || packetBytes[1] != 76.toByte() ||
                    packetBytes[2] != 86.toByte() || packetBytes[3] != 49.toByte()) continue
                if ((0 until 16).any { packetBytes[4 + it] != session[it] }) continue
                val metadata = ByteBuffer.wrap(packetBytes).order(ByteOrder.BIG_ENDIAN)
                val id = metadata.getInt(20)
                val length = metadata.getInt(24)
                val index = metadata.getShort(28).toInt() and 0xffff
                val count = metadata.getShort(30).toInt() and 0xffff
                if (length !in 4..MAX_FRAME || count != (length + PAYLOAD - 1) / PAYLOAD) continue
                val isEnd = partial && index == 0xffff && size - HEADER == END.size &&
                    END.indices.all { packetBytes[HEADER + it] == END[it] }
                val isParity = fec && index in 0x8000 until (0x8000 + (count + groupSize - 1) / groupSize) && size - HEADER == PAYLOAD
                if (!isEnd && !isParity && (index >= count || size - HEADER != minOf(PAYLOAD, length - index * PAYLOAD))) continue
                lastPacket = receivedAt
                val newest = current
                if (newest == null || id - newest.id > 0) {
                    // Publish the best recoverable part immediately when the next image arrives.
                    newest?.takeUnless { it.finished }?.let { deliver(it.finish()) }
                    current = LocalLensUdpFrame(id, length, count, groupSize)
                    framePacketAt = receivedAt
                } else if (id != newest.id) continue
                val assembling = current ?: continue
                if (assembling.length != length || assembling.count != count) continue
                framePacketAt = receivedAt
                // END does not discard late repair packets. The next frame or short gap releases it.
                val ready = when {
                    isEnd -> null
                    isParity -> assembling.addParity(index - 0x8000, packetBytes, HEADER, size - HEADER)
                    else -> assembling.add(index, packetBytes, HEADER, size - HEADER)
                }
                if (ready != null) deliver(ready)

            }
        } finally {
            try { token?.let { if (udp.isConnected) control(udp, it, 2) } } catch (_: Exception) { }
            udp.close()
        }
    }

    private fun acknowledgeFrame(socket: DatagramSocket, token: ByteArray, frame: Int) {
        val data = ByteBuffer.allocate(25).order(ByteOrder.BIG_ENDIAN)
            .put("ALC1".toByteArray(Charsets.US_ASCII)).put(token).put(3.toByte()).putInt(frame).array()
        socket.send(DatagramPacket(data, data.size))
    }

    private fun control(socket: DatagramSocket, token: ByteArray, command: Int) {
        val data = ByteArray(21)
        data[0] = 65; data[1] = 76; data[2] = 67; data[3] = 49 // ALC1
        System.arraycopy(token, 0, data, 4, token.size); data[20] = command.toByte()
        socket.send(DatagramPacket(data, data.size))
    }
}
