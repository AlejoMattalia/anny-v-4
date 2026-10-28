package com.anonymous.annyv4.lenswifi

import java.nio.ByteBuffer
import java.nio.ByteOrder

fun main() {
    testCallVideoFrames()
    val clean = LocalLensVideoFrame(byteArrayOf(1), false)
    val newer = LocalLensVideoFrame(byteArrayOf(2), false)
    val partial = LocalLensVideoFrame(byteArrayOf(3), true, intactRatio = 0.95f)
    check(LocalLensFramePolicy.shouldDecode(clean))
    check(LocalLensFramePolicy.shouldDecode(partial))
    check(LocalLensFramePolicy.shouldDecode(partial.copy(intactRatio = 0.2f)))
    check(!LocalLensFramePolicy.isUsable(null))
    check(!LocalLensFramePolicy.shouldDecode(partial.copy(jpeg = byteArrayOf())))
    check(!LocalLensPartialDeadline.expired(59, 0, null))
    check(LocalLensPartialDeadline.expired(60, 0, null))
    check(!LocalLensPartialDeadline.expired(111, 100, 100))
    check(LocalLensPartialDeadline.expired(112, 111, 100)) // Tail packets cannot extend END forever.

    val bytes = ByteArray(4200) { (it % 251).toByte() }
    bytes[0] = 0xff.toByte(); bytes[1] = 0xd8.toByte()
    bytes[4198] = 0xff.toByte(); bytes[4199] = 0xd9.toByte()
    val truncated = LocalLensUdpFrame(1, bytes.size, 3, 2)
    truncated.add(0, bytes, 0, 1400)
    truncated.add(2, bytes, 2800, 1400)
    val prefix = checkNotNull(truncated.finish())
    check(prefix.partial && prefix.intactRatio < 0.34f)
    check(LocalLensFramePolicy.shouldDecode(prefix))

    val repaired = LocalLensUdpFrame(2, bytes.size, 3, 2)
    repaired.add(0, bytes, 0, 1400)
    repaired.add(2, bytes, 2800, 1400)
    val parity = ByteArray(1400) { (bytes[it].toInt() xor bytes[1400 + it].toInt()).toByte() }
    val full = checkNotNull(repaired.addParity(0, parity, 0, parity.size))
    check(!full.partial && full.jpeg.contentEquals(bytes) && full.recoveredFragments == 1)
    check(LocalLensFramePolicy.shouldDecode(full))
    val feedback = LocalLensReceptionFeedback(100)
    val token = ByteArray(16) { it.toByte() }
    feedback.record(full, 150)
    feedback.record(prefix, 160)
    feedback.record(null, 170)
    feedback.skipped(3)
    val report = feedback.packet(token, 1150)
    check(report.size == 29 && String(report, 0, 4, Charsets.US_ASCII) == "ALC1")
    check(report.copyOfRange(4, 20).contentEquals(token) && report[20] == 4.toByte())
    val metadata = ByteBuffer.wrap(report).order(ByteOrder.BIG_ENDIAN)
    check(metadata.getShort(21).toInt() == 1)
    check(metadata.getShort(23).toInt() == 5)
    check(metadata.getInt(25) == 1000)
    feedback.resetWindow()
    val empty = ByteBuffer.wrap(feedback.packet(token, 2150)).order(ByteOrder.BIG_ENDIAN)
    check(empty.getShort(21).toInt() == 0 && empty.getShort(23).toInt() == 0)
    check(empty.getInt(25) == 2000) // A silent link must still report a stale image.
    feedback.skipped(Int.MAX_VALUE)
    val saturated = ByteBuffer.wrap(feedback.packet(token, 2150)).order(ByteOrder.BIG_ENDIAN)
    check((saturated.getShort(23).toInt() and 0xffff) == 65535)
    feedback.record(full, 2150)
    val recovered = ByteBuffer.wrap(feedback.packet(token, 2150)).order(ByteOrder.BIG_ENDIAN)
    check(recovered.getInt(25) == 0)
    check(runCatching { feedback.packet(ByteArray(15), 2150) }.isFailure)
    val stalled = LocalLensReceptionFeedback(0)
    stalled.record(prefix, 14999) // Receiving a partial alone must not hide a frozen decoder.
    check(stalled.hasUsableImage(14999, 0) && !stalled.hasUsableImage(15000, 0))
    check(stalled.hasUsableImage(30000, 15001)) // Any successfully decoded image keeps the preview live.
    check(stalled.hasUsableImage(44999, 30000) && !stalled.hasUsableImage(45000, 30000))
    val queue = LocalLensFrameQueue()
    val paced = clean.copy(playoutIntervalMs = 50)
    val pacedNewer = newer.copy(playoutIntervalMs = 50)
    queue.offer(paced, 0)
    queue.offer(pacedNewer, 1) // Two frames arrived together over the hotspot.
    check(queue.poll(99) == null)
    check(queue.poll(100) === paced)
    check(queue.poll(149) == null)
    check(queue.poll(150) === pacedNewer)
    check(queue.poll(200) == null && queue.waitMs(200) == 0L)
    queue.offer(paced, 250)
    check(queue.poll(250) === paced) // No new startup wait after underflow.
    repeat(5) { queue.offer(paced.copy(jpeg = byteArrayOf(it.toByte())), 300) }
    check(queue.poll(300)?.jpeg?.get(0) == 1.toByte()) // Drop oldest above four frames.
    check(queue.poll(700) == null) // Expire even a full queue after a stall.
    queue.offer(paced, 701)
    val pacedPartial = prefix.copy(playoutIntervalMs = 50)
    queue.offer(pacedPartial, 702)
    check(queue.poll(702) === paced)
    check(queue.poll(752) === pacedPartial) // A short prefix advances video after a complete frame.
    queue.offer(paced, 703)
    queue.clear()
    check(queue.poll(900) == null)
    val direct = LocalLensFrameQueue()
    direct.offer(clean, 0)
    direct.offer(newer, 1)
    check(direct.poll(1) === newer) // Router/MJPEG/legacy firmware keep latest-only behavior.
    check(direct.poll(2) == null)
    direct.offer(clean, 3)
    direct.offer(prefix, 4)
    check(direct.poll(4) === prefix) // Fresh partial replaces older complete immediately.
    val slower = LocalLensFrameQueue()
    slower.offer(paced, 0)
    repeat(10) { slower.offer(paced, (it + 1) * 100L) }
    check(slower.poll(1000) != null)
    check(slower.waitMs(1000) == 75L) // Smooth a sustained 10 FPS arrival rate toward 100 ms.
    check(slower.poll(1074) == null)
    check(slower.poll(1075) != null)
    // Recovery never exceeds the sender's nominal 20 FPS.
    repeat(40) { slower.offer(paced, 1050L + it * 50) }
    check(slower.poll(3000) != null && slower.waitMs(3000) in 50L..75L)
    // A decoder resuming after a scheduling pause must skip stale images,
    // while keeping enough recent frames to resume evenly, without a burst.
    val delayed = LocalLensFrameQueue()
    val timeline = (0..4).map { paced.copy(jpeg = byteArrayOf(it.toByte())) }
    timeline.take(4).forEachIndexed { index, frame -> delayed.offer(frame, index * 50L) }
    check(delayed.poll(200) === timeline[1]) // Skip the 200-ms-old image.
    check(delayed.lastAgeMs == 150L)
    delayed.offer(timeline[4], 200)
    check(delayed.poll(201) == null) // Do not catch up by displaying a burst.
    check(delayed.poll(250) === timeline[2])
    check(delayed.lastAgeMs <= 150L)
    check(delayed.poll(500) == null) // No stale picture after a longer outage.
    delayed.offer(paced, 501)
    check(delayed.poll(501) === paced) // Resume without another startup buffer.
    println("Frame selection, partial fallback, FEC, feedback and bounded hotspot playout passed")
}
