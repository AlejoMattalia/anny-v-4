package com.anonymous.annyv4.lenswifi

/** Prefer fresh complete images, without waiting for retransmission or building a queue. */
internal object LocalLensFramePolicy {
    fun next(queued: LocalLensVideoFrame?, incoming: LocalLensVideoFrame): LocalLensVideoFrame =
        if (incoming.partial && queued != null && !queued.partial) queued else incoming

    fun shouldDecode(frame: LocalLensVideoFrame, now: Long, lastCompleteAt: Long?): Boolean {
        if (!frame.partial) return true
        // This ratio describes intact JPEG bytes, not a percentage of image pixels.
        // Do not replace a fresh clean picture with a short prefix and a gray tail.
        return frame.intactRatio >= 0.9f &&
            (lastCompleteAt == null || now - lastCompleteAt >= 300)
    }
}
