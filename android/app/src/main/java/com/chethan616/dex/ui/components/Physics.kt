package com.chethan616.dex.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.sign
import kotlin.math.sqrt

/*
 * Physics for the phone's motion: springs (a damping ratio and a stiffness,
 * not a duration), so a thing that's moving keeps its momentum when it's
 * interrupted, overshoots by how hard it was thrown, and settles on its own.
 * Everything here animates the layer only (scale, offset, alpha) — no relayout
 * per frame, which is what keeps it smooth.
 */

/** Under a finger: soft and bouncy — it sinks fast and wobbles back. */
private val PressSpring = spring<Float>(dampingRatio = 0.45f, stiffness = Spring.StiffnessMedium)

/**
 * The card squishes while it's pressed and springs back with a little wobble
 * when it's let go. Share `interaction` with the clickable it belongs to.
 */
@Composable
fun Modifier.springPress(interaction: MutableInteractionSource, pressedScale: Float = 0.95f): Modifier {
  val pressed by interaction.collectIsPressedAsState()
  val scale by animateFloatAsState(if (pressed) pressedScale else 1f, PressSpring, label = "press")
  return graphicsLayer { scaleX = scale; scaleY = scale }
}

/**
 * One card of an entrance cascade: it rises from a little below on a real
 * spring — under-damped, so it overshoots by a few dp and settles — a beat
 * after the one above it. `play` false shows it in place at once (you've
 * seen this screen already).
 */
@Composable
fun Modifier.cascadeIn(index: Int, play: Boolean): Modifier {
  val p = remember { Animatable(if (play) 0f else 1f) }
  // Keyed on nothing: once it has started, `play` turning off doesn't cut it short.
  LaunchedEffect(Unit) {
    if (p.value < 1f) {
      delay(index * 55L)
      p.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = 260f))
    }
  }
  return graphicsLayer {
    val v = p.value
    alpha = (v * 1.6f).coerceIn(0f, 1f)
    translationY = (1f - v) * 64.dp.toPx()
    val s = 0.9f + 0.1f * v
    scaleX = s
    scaleY = s
  }
}

/**
 * Drag it anywhere; it follows with rubber-band resistance (the further you
 * pull, the harder it gets), and when you let go it springs home carrying
 * your flick's velocity — a loose, bouncy spring, so a hard throw overshoots
 * and wobbles before it settles.
 */
@Composable
fun Modifier.springDrag(onGrab: () -> Unit = {}, onRelease: () -> Unit = {}): Modifier {
  val offset = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
  val scope = rememberCoroutineScope()
  val reach = 120.dp
  return this
    .pointerInput(Unit) {
      val max = reach.toPx()
      // Resistance: the raw drag maps onto a curve that flattens towards `max`.
      fun rubber(raw: Float): Float {
        val d = abs(raw)
        return sign(raw) * max * (1f - 1f / (d / max + 1f))
      }
      var raw = Offset.Zero
      val tracker = VelocityTracker()
      detectDragGestures(
        onDragStart = {
          raw = offset.value
          tracker.resetTracking()
          onGrab()
          scope.launch { offset.stop() }
        },
        onDragEnd = {
          val v = tracker.calculateVelocity()
          onRelease()
          scope.launch {
            offset.animateTo(
              Offset.Zero,
              spring(dampingRatio = 0.38f, stiffness = Spring.StiffnessLow),
              initialVelocity = Offset(v.x, v.y) * 0.6f,
            )
          }
        },
        onDragCancel = { scope.launch { offset.animateTo(Offset.Zero, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessLow)) } },
      ) { change, drag ->
        change.consume()
        raw += drag
        tracker.addPosition(change.uptimeMillis, change.position)
        scope.launch { offset.snapTo(Offset(rubber(raw.x), rubber(raw.y))) }
      }
    }
    .graphicsLayer {
      translationX = offset.value.x
      translationY = offset.value.y
      // Leans into the pull, a little squashed along it.
      val o = offset.value
      rotationZ = (o.x / reach.toPx()) * 12f
      val stretch = (sqrt(o.x * o.x + o.y * o.y) / reach.toPx()).coerceIn(0f, 1f) * 0.08f
      scaleX = 1f + stretch
      scaleY = 1f - stretch
    }
}
