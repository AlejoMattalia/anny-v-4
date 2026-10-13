package com.anonymous.annyv4.lenswifi

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView

/** The decoder draws directly to a separate surface; React's UI cannot queue video frames. */
internal class LocalLensSurface(context: Context) : SurfaceView(context), SurfaceHolder.Callback {
    private val rendering = Any()
    private var ready = false
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val destination = RectF()

    init { holder.addCallback(this) }

    override fun surfaceCreated(holder: SurfaceHolder) = synchronized(rendering) { ready = true }
    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit
    override fun surfaceDestroyed(holder: SurfaceHolder) {
        // Finish an in-progress draw before Android destroys the surface.
        synchronized(rendering) { ready = false }
    }

    fun display(bitmap: Bitmap, active: () -> Boolean): Boolean = synchronized(rendering) {
        if (!ready || !active() || !holder.surface.isValid) return false
        try {
            val canvas = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                holder.lockHardwareCanvas() else holder.lockCanvas()) ?: return false
            try {
                canvas.drawColor(Color.BLACK)
                if (!active()) return false
                val scale = minOf(canvas.width.toFloat() / bitmap.width, canvas.height.toFloat() / bitmap.height)
                val width = bitmap.width * scale
                val height = bitmap.height * scale
                val left = (canvas.width - width) / 2f
                val top = (canvas.height - height) / 2f
                destination.set(left, top, left + width, top + height)
                canvas.drawBitmap(bitmap, null, destination, paint)
            } finally {
                holder.unlockCanvasAndPost(canvas)
            }
            true
        } catch (error: RuntimeException) {
            // Window transitions can invalidate the surface between callbacks.
            Log.w("AnnyLensStream", "Surface temporarily unavailable: ${error.javaClass.simpleName}")
            false
        }
    }
}
