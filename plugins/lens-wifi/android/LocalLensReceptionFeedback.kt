package com.anonymous.annyv4.lenswifi

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** One reception window, including images for which every UDP packet was lost. */
internal class LocalLensReceptionFeedback(private val startedAt: Long) {
    private var complete = 0
    private var incomplete = 0
    private var lastCompleteAt = startedAt

    fun record(frame: LocalLensVideoFrame?, now: Long) {
        if (frame == null || frame.partial) skipped(1)
        else {
            complete = minOf(65535, complete + 1)
            lastCompleteAt = now
        }
    }

    fun skipped(count: Int) {
        incomplete = (incomplete.toLong() + count.coerceAtLeast(0)).coerceAtMost(65535).toInt()
    }

    fun packet(token: ByteArray, now: Long): ByteArray {
        require(token.size == 16)
        return ByteBuffer.allocate(29).order(ByteOrder.BIG_ENDIAN)
            .put("ALC1".toByteArray(Charsets.US_ASCII)).put(token).put(4.toByte())
            .putShort(complete.toShort()).putShort(incomplete.toShort())
            .putInt((now - lastCompleteAt).coerceIn(0, 0xffffffffL).toInt()).array()
    }

    fun resetWindow() { complete = 0; incomplete = 0 }

    // Receiving a prefix does not guarantee Android can decode it. A corrupt
    // packet stream must not keep a frozen preview alive indefinitely.
    fun hasUsableImage(now: Long, lastDecodedAt: Long): Boolean =
        now - maxOf(startedAt, lastDecodedAt) < 15000
}
