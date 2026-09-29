package com.chethan616.dex.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * A photo or file the user attached on the phone, copied into the app's
 * cache first — share and picker grants can expire, a local copy can't —
 * and photos shrunk to what an agent actually needs.
 */
data class PendingAttachment(
  val file: File,
  val name: String,
  val mime: String,
  val size: Long,
) {
  val isImage: Boolean get() = mime.startsWith("image/")
}

/**
 * Same limits as the desktop (desktop/app/src/shared/attachments.ts): the
 * PC checks again, but refusing here gives a clear message on the phone.
 */
object Outgoing {
  const val MAX_FILES = 10
  private const val MAX_IMAGE = 3_900_000L
  private const val MAX_PDF = 24_000_000L
  private const val MAX_TEXT = 1_000_000L
  private const val MAX_OTHER = 10_000_000L
  const val MAX_TOTAL = 50L * 1024 * 1024
  private const val MAX_EDGE = 2048

  private fun dir(context: Context) = File(context.cacheDir, "outgoing").apply { mkdirs() }

  /** A file for the camera to write into, and the content Uri to hand it. */
  fun newCameraTarget(context: Context): Pair<File, Uri> {
    val file = File(dir(context), "photo-${System.currentTimeMillis()}.jpg")
    return file to FileProvider.getUriForFile(context, "${context.packageName}.files", file)
  }

  /** Drop yesterday's copies. */
  fun sweep(context: Context) {
    val cutoff = System.currentTimeMillis() - 24 * 60 * 60_000L
    dir(context).listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
  }

  suspend fun prepare(context: Context, uri: Uri): PendingAttachment = withContext(Dispatchers.IO) {
    val cr = context.contentResolver
    var name: String? = null
    cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) name = c.getString(0)
    }
    val displayName = (name ?: uri.lastPathSegment?.substringAfterLast('/') ?: "attachment").replace(Regex("""[\\/:*?"<>|]"""), "_")
    val ext = displayName.substringAfterLast('.', "").lowercase()
    val mime = cr.getType(uri)
      ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
      ?: "application/octet-stream"

    if (mime.startsWith("image/") && mime != "image/gif") {
      val bitmap = decodeScaled(context, uri) ?: throw IllegalArgumentException("Couldn’t read $displayName.")
      var quality = 88
      var bytes: ByteArray
      do {
        bytes = ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out); out.toByteArray() }
        quality -= 12
      } while (bytes.size > MAX_IMAGE && quality > 40)
      bitmap.recycle()
      if (bytes.size > MAX_IMAGE) throw IllegalArgumentException("$displayName is too large even after shrinking.")
      val base = displayName.substringBeforeLast('.').ifBlank { "photo" }
      val out = File(dir(context), "${System.nanoTime()}-$base.jpg")
      out.writeBytes(bytes)
      return@withContext PendingAttachment(out, "$base.jpg", "image/jpeg", out.length())
    }

    val out = File(dir(context), "${System.nanoTime()}-$displayName")
    cr.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } }
      ?: throw IllegalArgumentException("Couldn’t read $displayName.")
    val limit = when {
      mime == "application/pdf" -> MAX_PDF
      mime.startsWith("text/") || mime == "application/json" -> MAX_TEXT
      else -> MAX_OTHER
    }
    if (out.length() == 0L) { out.delete(); throw IllegalArgumentException("$displayName is empty.") }
    if (out.length() > limit) {
      out.delete()
      throw IllegalArgumentException("$displayName is ${out.length() / 1_000_000} MB — the limit for this kind of file is ${limit / 1_000_000} MB.")
    }
    PendingAttachment(out, displayName, mime, out.length())
  }

  /** Decoded upright (EXIF honoured on API 28+) and no bigger than MAX_EDGE on its long side. */
  private fun decodeScaled(context: Context, uri: Uri): Bitmap? = runCatching {
    if (Build.VERSION.SDK_INT >= 28) {
      ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
        val w = info.size.width
        val h = info.size.height
        val scale = MAX_EDGE.toFloat() / maxOf(w, h)
        if (scale < 1f) decoder.setTargetSize((w * scale).toInt(), (h * scale).toInt())
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      }
    } else {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
      var sample = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_EDGE) sample *= 2
      context.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
      }
    }
  }.getOrNull()
}
