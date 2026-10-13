package com.anonymous.annyv4.lenswifi

/** Live preview favors motion, including a fresh decodable JPEG prefix. */
internal object LocalLensFramePolicy {
    fun isUsable(frame: LocalLensVideoFrame?): Boolean =
        frame != null && frame.jpeg.isNotEmpty()

    fun shouldDecode(frame: LocalLensVideoFrame): Boolean = isUsable(frame)
}
