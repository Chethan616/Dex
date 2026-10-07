package com.chethan616.dex.ui.avatar

import android.graphics.Bitmap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection

/** A bot's body colour, as ARGB (for places outside Compose, like a notification's progress track). */
fun botColorArgb(type: String): Int = (BOT_SHAPES[type] ?: BOT_SHAPES.getValue("flower")).color.toInt()

/**
 * A bot as a still picture, for places Compose can't draw live — a live
 * update's progress tracker. The same body, lit-plastic shading, face and
 * accent as [BotAvatar], drawn once into a [px]-square bitmap.
 *
 * [hop] lifts it (body units) and [lean] tilts it, so alternating frames
 * read as a bot hopping along; [lookX] turns its eyes (positive: ahead).
 */
fun botStill(type: String, mood: BotMood, px: Int, lookX: Float = 0f, hop: Float = 0f, lean: Float = 0f): Bitmap {
  val shape = BOT_SHAPES[type] ?: BOT_SHAPES.getValue("flower")
  val body = PathParser().parsePathString(shape.path).toPath()
  val parts = shape.parts?.let { PathParser().parsePathString(it).toPath() }
  val base = Color(shape.color)
  // A sad bot loses a little colour, as in BotAvatar.
  val bodyColor = if (mood == BotMood.Sad) lerp(base, Color(0xFF8C9199), 0.32f) else base
  val ink = if (base.luminance() > 0.45f) Color(0xFF15161A) else Color(0xFFF8F8FA)
  val image = ImageBitmap(px, px)
  CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, Canvas(image), Size(px.toFloat(), px.toFloat())) {
    scale(px / 100f, px / 100f, pivot = Offset.Zero) {
      // A little smaller than the box, standing on its floor: headroom for a hop and the accent.
      scale(0.86f, 0.86f, pivot = Offset(50f, 98f)) {
      translate(top = -hop) {
        rotate(lean, pivot = Offset(50f, 60f)) {
          parts?.let { drawPath(it, lerp(bodyColor, Color.Black, 0.18f)) }
          drawPath(body, bodyColor)
          drawPath(
            body,
            Brush.radialGradient(listOf(Color.White.copy(alpha = 0.42f), Color.White.copy(alpha = 0f)), center = Offset(34f + lookX, 26f), radius = 52f),
          )
          drawPath(body, Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.2f)), startY = 48f, endY = 96f))
          drawPath(body, Color.White.copy(alpha = 0.18f), style = Stroke(width = 0.9f))
          drawFace(mood, shape, ink, lookX, 0f, 1f, large = true)
        }
        drawAccent(mood, ink, phase = 0f, beat = 0.25f, pop = 1f)
      }
      }
    }
  }
  return image.asAndroidBitmap()
}
