package com.anonymous.annyv4.lenswifi

/** Small hotspot jitter buffer. Call under the reader/decoder's shared monitor. */
internal class LocalLensFrameQueue {
    private data class Entry(val frame: LocalLensVideoFrame, val receivedAt: Long)
    private val frames = ArrayDeque<Entry>()
    private var started = false
    private var nextAt = 0L
    private var intervalMs = 0L
    private var rateAt = 0L
    private var rateFrames = 0
    var lastAgeMs = 0L
        private set

    fun offer(frame: LocalLensVideoFrame, now: Long) {
        if (!LocalLensFramePolicy.isUsable(frame)) return
        expire(now)
        if (frame.playoutIntervalMs == 0) {
            frames.clear()
            intervalMs = 0
            nextAt = now
        } else {
            val nominal = frame.playoutIntervalMs.toLong().coerceIn(40, 100)
            if (!started || intervalMs == 0L) {
                intervalMs = nominal
                nextAt = now + 100
                rateAt = now
                rateFrames = 0
            } else {
                rateFrames++
                if (now - rateAt >= 1000) {
                    // A 17 FPS link must not continually drain a 20 FPS buffer.
                    // Measure across a full second so packet bursts cannot speed
                    // up playback, and ease back toward nominal when it recovers.
                    val measured = ((now - rateAt) / rateFrames).coerceIn(nominal, 100)
                    intervalMs = ((intervalMs + measured + 1) / 2).coerceIn(nominal, 100)
                    rateAt = now
                    rateFrames = 0
                }
            }
            while (frames.size >= 4) frames.removeFirst()
        }
        started = true
        frames.addLast(Entry(frame, now))
    }

    fun poll(now: Long): LocalLensVideoFrame? {
        expire(now)
        if (frames.isEmpty() || now < nextAt) return null
        val entry = frames.removeFirst()
        lastAgeMs = now - entry.receivedAt
        // Do not catch up with a burst after a scheduling pause.
        nextAt = now + intervalMs
        return entry.frame
    }

    // Object.wait(0) sleeps until a frame arrives or stop interrupts the decoder.
    fun waitMs(now: Long): Long = if (frames.isEmpty()) 0 else (nextAt - now).coerceAtLeast(1)
    fun clear() { frames.clear() }
    private fun expire(now: Long) {
        // Keep the startup cushion and even playback, but do not carry a
        // quarter-second backlog after a burst or a delayed decoder.
        while (frames.isNotEmpty() && now - frames.first().receivedAt > 150) frames.removeFirst()
    }
}
