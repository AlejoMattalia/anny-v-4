package com.anonymous.annyv4.lenswifi

internal object LocalLensPartialDeadline {
    fun expired(now: Long, lastPacketAt: Long, endAt: Long?): Boolean =
        if (endAt != null) now - endAt >= 12 else now - lastPacketAt >= 60
}
