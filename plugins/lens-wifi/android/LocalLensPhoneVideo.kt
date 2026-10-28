package com.anonymous.annyv4.lenswifi

import android.content.Context
import com.voximplant.webrtc.Camera1Enumerator
import com.voximplant.webrtc.Camera2Enumerator
import com.voximplant.webrtc.CameraEnumerator
import com.voximplant.webrtc.CapturerObserver
import com.voximplant.webrtc.EglBase
import com.voximplant.webrtc.SurfaceTextureHelper
import com.voximplant.webrtc.VideoFrame
import com.voximplant.webrtc.YuvHelper
import java.nio.ByteBuffer

/** The SDK camera capturer feeds the same custom track when Celular is selected. */
internal class LocalLensPhoneVideo(context: Context, onFrame: (ByteArray, Int, Int) -> Unit) {
    private val enumerator: CameraEnumerator = if (Camera2Enumerator.isSupported(context)) Camera2Enumerator(context) else Camera1Enumerator(true)
    private val device = enumerator.deviceNames.firstOrNull { enumerator.isBackFacing(it) }
        ?: enumerator.deviceNames.firstOrNull() ?: throw IllegalStateException("No hay cámara disponible.")
    private val capturer = enumerator.createCapturer(device, null)
        ?: throw IllegalStateException("No se pudo abrir la cámara del celular.")
    private val egl = EglBase.create()
    private val texture = SurfaceTextureHelper.create("AnnyCallCamera", egl.eglBaseContext)

    init {
        capturer.initialize(texture, context, object : CapturerObserver {
            private var rotated = ByteBuffer.allocateDirect(0)
            override fun onCapturerStarted(success: Boolean) {}
            override fun onCapturerStopped() {}
            override fun onFrameCaptured(frame: VideoFrame) {
                val buffer = frame.buffer.toI420() ?: return
                try {
                    val size = buffer.width * buffer.height * 3 / 2
                    if (rotated.capacity() != size) rotated = ByteBuffer.allocateDirect(size)
                    rotated.clear()
                    // sendFrame(byte[]) has no rotation argument. Apply the camera's
                    // orientation to the pixels before supplying its packed I420.
                    YuvHelper.I420Rotate(buffer.dataY, buffer.strideY, buffer.dataU, buffer.strideU,
                        buffer.dataV, buffer.strideV, rotated, buffer.width, buffer.height, frame.rotation)
                    val data = ByteArray(size)
                    rotated.position(0); rotated.get(data)
                    val portrait = frame.rotation % 180 != 0
                    onFrame(data, if (portrait) buffer.height else buffer.width, if (portrait) buffer.width else buffer.height)
                } finally { buffer.release() }
            }
        })
        capturer.useOrientationListener(true)
        capturer.startCapture(640, 480, 30)
    }
    fun close() {
        try { capturer.stopCapture() } finally {
            capturer.dispose()
            texture.dispose()
            egl.release()
        }
    }
}
