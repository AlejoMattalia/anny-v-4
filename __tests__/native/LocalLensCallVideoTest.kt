package com.anonymous.annyv4.lenswifi

internal fun testCallVideoFrames() {
    fun solid(color: Int) = LocalLensI420.convert(IntArray(4) { color }, 2, 2).map { it.toInt() and 255 }
    check(solid(0xff000000.toInt()) == listOf(16, 16, 16, 16, 128, 128))
    check(solid(0xffffffff.toInt()) == listOf(235, 235, 235, 235, 128, 128))
    check(solid(0xffff0000.toInt()) == listOf(82, 82, 82, 82, 90, 240))
    check(solid(0xff0000ff.toInt()) == listOf(41, 41, 41, 41, 240, 110))
    val mixed = LocalLensI420.convert(intArrayOf(0xff000000.toInt(), 0xffffffff.toInt(),
        0xffff0000.toInt(), 0xff0000ff.toInt()), 2, 2).map { it.toInt() and 255 }
    check(mixed.take(4) == listOf(16, 235, 82, 41)) // Preserve display order, no mirror/rotation.
    check(runCatching { LocalLensI420.convert(IntArray(6), 3, 2) }.isFailure)
    check(runCatching { LocalLensI420.convert(IntArray(3), 2, 2) }.isFailure)
    val frames = LocalLensLatestFrame<Int>()
    frames.offer(1); frames.offer(2); frames.offer(3)
    check(frames.take() == 3) // Slow encoder gets the current displayed image, never a backlog.
    frames.offer(4); frames.clear(); frames.offer(5)
    check(frames.take() == 5)
    val consumer = Thread { check(frames.take() == null) }
    consumer.start()
    frames.close()
    consumer.join(1000)
    check(!consumer.isAlive) // Hangup unblocks the worker even without another frame.
    frames.offer(6)
    check(frames.take() == null)
    // Exercise full camera dimensions and the format's exact plane lengths.
    check(LocalLensI420.convert(IntArray(640 * 480), 640, 480).size == 640 * 480 * 3 / 2)
    println("Call video: I420 colors/planes, display order, latest-only delivery and cleanup passed")
}
