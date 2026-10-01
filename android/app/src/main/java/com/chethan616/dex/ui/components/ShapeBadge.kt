package com.chethan616.dex.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.toPath
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.graphics.Path
import androidx.graphics.shapes.Morph
import androidx.graphics.shapes.RoundedPolygon

/**
 * Content on a Material 3 Expressive shape — a cookie, a clover, a sunny
 * burst — instead of a plain circle or square. `spinMs` turns it slowly (0
 * keeps it still), which is most of what makes a screen feel alive without
 * being busy.
 */
@Composable
fun ShapeBadge(
  shape: RoundedPolygon,
  color: Color,
  size: Dp,
  modifier: Modifier = Modifier,
  spinMs: Int = 0,
  content: @Composable BoxScope.() -> Unit = {},
) {
  // A morph from the shape to itself is just the shape — as a Path, outside composition.
  val path = remember(shape) { Morph(shape, shape).toPath(0f, Path()) }
  val angle = if (spinMs > 0) {
    val a by rememberInfiniteTransition(label = "shape").animateFloat(
      initialValue = 0f,
      targetValue = 360f,
      animationSpec = infiniteRepeatable(tween(spinMs, easing = LinearEasing), RepeatMode.Restart),
      label = "deg",
    )
    a
  } else 0f
  Box(modifier.size(size), contentAlignment = Alignment.Center) {
    Canvas(Modifier.fillMaxSize()) {
      rotate(angle) {
        // MaterialShapes live in a unit square; stretch it to the badge.
        scale(this.size.width, this.size.height, pivot = Offset.Zero) { drawPath(path, color) }
      }
    }
    content()
  }
}
