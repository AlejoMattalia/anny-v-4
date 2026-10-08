package com.anonymous.annyv4.lenswifi

fun main() {
    val clean = LocalLensVideoFrame(byteArrayOf(1), false)
    val newer = LocalLensVideoFrame(byteArrayOf(2), false)
    val partial = LocalLensVideoFrame(byteArrayOf(3), true, intactRatio = 0.95f)
    check(LocalLensFramePolicy.next(clean, partial) === clean)
    check(LocalLensFramePolicy.next(clean, newer) === newer)
    check(LocalLensFramePolicy.next(partial, clean) === clean)
    check(LocalLensFramePolicy.next(null, partial) === partial)
    check(LocalLensFramePolicy.shouldDecode(clean, 101, 100))
    check(!LocalLensFramePolicy.shouldDecode(partial, 399, 100))
    check(LocalLensFramePolicy.shouldDecode(partial, 400, 100))
    check(LocalLensFramePolicy.shouldDecode(partial, 0, null))
    check(!LocalLensFramePolicy.shouldDecode(partial.copy(intactRatio = 0.8f), 2000, null))

    val bytes = ByteArray(4200) { (it % 251).toByte() }
    bytes[0] = 0xff.toByte(); bytes[1] = 0xd8.toByte()
    bytes[4198] = 0xff.toByte(); bytes[4199] = 0xd9.toByte()
    val truncated = LocalLensUdpFrame(1, bytes.size, 3, 2)
    truncated.add(0, bytes, 0, 1400)
    truncated.add(2, bytes, 2800, 1400)
    val prefix = checkNotNull(truncated.finish())
    check(prefix.partial && prefix.intactRatio < 0.34f)
    check(!LocalLensFramePolicy.shouldDecode(prefix, 2000, null))

    val repaired = LocalLensUdpFrame(2, bytes.size, 3, 2)
    repaired.add(0, bytes, 0, 1400)
    repaired.add(2, bytes, 2800, 1400)
    val parity = ByteArray(1400) { (bytes[it].toInt() xor bytes[1400 + it].toInt()).toByte() }
    val full = checkNotNull(repaired.addParity(0, parity, 0, parity.size))
    check(!full.partial && full.jpeg.contentEquals(bytes) && full.recoveredFragments == 1)
    check(LocalLensFramePolicy.shouldDecode(full, 101, 100))
    println("Frame selection, bounded partial fallback and FEC recovery passed")
}
