package com.anonymous.annyv4.lenswifi

internal data class LocalLensVideoFrame(
    val jpeg: ByteArray, val partial: Boolean, val prefix: ByteArray? = null,
    val recoveredFragments: Int = 0,
    val intactRatio: Float = 1f,
)

/** Recover one lost fragment per XOR group; otherwise decode only the intact prefix. */
internal class LocalLensUdpFrame(val id: Int, val length: Int, val count: Int, private val groupSize: Int = 4) {
    init { require(groupSize == 2 || groupSize == 4) }
    companion object { const val PAYLOAD = 1400 }
    private val jpeg = ByteArray(length)
    private val present = BooleanArray(count)
    private val parity = arrayOfNulls<ByteArray>((count + groupSize - 1) / groupSize)
    private var received = 0
    private var recovered = 0
    var finished = false
        private set

    fun add(index: Int, bytes: ByteArray, start: Int, size: Int): LocalLensVideoFrame? {
        if (finished || index !in present.indices || present[index] || size != minOf(PAYLOAD, length - index * PAYLOAD)) return null
        System.arraycopy(bytes, start, jpeg, index * PAYLOAD, size)
        present[index] = true; received++
        recover(index / groupSize)
        return if (received == count) finish() else null
    }

    fun addParity(group: Int, bytes: ByteArray, start: Int, size: Int): LocalLensVideoFrame? {
        if (finished || group !in parity.indices || parity[group] != null || size != PAYLOAD) return null
        parity[group] = bytes.copyOfRange(start, start + size)
        recover(group)
        return if (received == count) finish() else null
    }

    private fun recover(group: Int) {
        val repair = parity[group] ?: return
        val first = group * groupSize
        val end = minOf(first + groupSize, count)
        var missing = -1
        for (index in first until end) if (!present[index]) {
            if (missing != -1) return
            missing = index
        }
        if (missing < 0) return
        for (index in first until end) if (index != missing) {
            val offset = index * PAYLOAD
            for (i in 0 until minOf(PAYLOAD, length - offset)) {
                repair[i] = (repair[i].toInt() xor jpeg[offset + i].toInt()).toByte()
            }
        }
        System.arraycopy(repair, 0, jpeg, missing * PAYLOAD, minOf(PAYLOAD, length - missing * PAYLOAD))
        present[missing] = true; received++; recovered++
        parity[group] = null
    }

    fun finish(): LocalLensVideoFrame? {
        if (finished) return null
        finished = true
        if (!present[0] || jpeg[0] != 0xff.toByte() || jpeg[1] != 0xd8.toByte()) return null
        if (received == count && jpeg[length - 2] == 0xff.toByte() && jpeg[length - 1] == 0xd9.toByte()) {
            return LocalLensVideoFrame(jpeg, false, recoveredFragments = recovered)
        }
        val firstMissing = present.indexOfFirst { !it }
        val intactBytes = if (firstMissing < 0) length else firstMissing * PAYLOAD
        if (intactBytes < 4) return null
        // Never concatenate entropy data across a hole: that corrupts subsequent colors/blocks.
        val prefix = jpeg.copyOf(intactBytes + 2)
        prefix[intactBytes] = 0xff.toByte(); prefix[intactBytes + 1] = 0xd9.toByte()
        return LocalLensVideoFrame(prefix, true, recoveredFragments = recovered,
            intactRatio = intactBytes.toFloat() / length)
    }
}
