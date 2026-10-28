package com.anonymous.annyv4.lenswifi

/** Packed I420 (Y, U, V), the byte format used by Voximplant's custom source. */
internal object LocalLensI420 {
    fun convert(argb: IntArray, width: Int, height: Int): ByteArray {
        require(width > 0 && height > 0 && width % 2 == 0 && height % 2 == 0)
        require(argb.size >= width * height)
        val size = width * height
        val result = ByteArray(size * 3 / 2)
        fun channel(value: Int) = value.coerceIn(0, 255).toByte()
        for (row in 0 until height step 2) {
            for (col in 0 until width step 2) {
                var red = 0; var green = 0; var blue = 0
                for (y in row..row + 1) for (x in col..col + 1) {
                    val color = argb[y * width + x]
                    val r = (color shr 16) and 255
                    val g = (color shr 8) and 255
                    val b = color and 255
                    result[y * width + x] = channel(((66 * r + 129 * g + 25 * b + 128) shr 8) + 16)
                    red += r; green += g; blue += b
                }
                red /= 4; green /= 4; blue /= 4
                val chroma = row / 2 * (width / 2) + col / 2
                result[size + chroma] = channel(((-38 * red - 74 * green + 112 * blue + 128) shr 8) + 128)
                result[size + size / 4 + chroma] = channel(((112 * red - 94 * green - 18 * blue + 128) shr 8) + 128)
            }
        }
        return result
    }
}

/** A slow encoder may replace one pending frame, never delay the local preview. */
internal class LocalLensLatestFrame<T : Any> {
    private val monitor = Object()
    private var pending: T? = null
    private var closed = false
    fun offer(frame: T) = synchronized(monitor) {
        if (!closed) { pending = frame; monitor.notifyAll() }
    }
    fun take(): T? = synchronized(monitor) {
        while (!closed && pending == null) monitor.wait()
        val frame = pending
        pending = null
        frame
    }
    fun clear() = synchronized(monitor) { pending = null }
    fun close() = synchronized(monitor) {
        closed = true; pending = null; monitor.notifyAll()
    }
}
