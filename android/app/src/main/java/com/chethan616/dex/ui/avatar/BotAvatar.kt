package com.chethan616.dex.ui.avatar

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.chethan616.dex.ui.haptics.LocalHaptics
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.random.Random

enum class BotMood { Idle, Working, Sleeping }

/** Same mapping as the desktop's AgentAvatar: engine → body shape, else a stable hash. */
fun botTypeFor(engineId: String?, key: String?): String {
  when (engineId) {
    "claude-code" -> return "flower"
    "codex" -> return "circle"
    "browsercode", "opencode" -> return "droid"
  }
  val k = key ?: engineId ?: "dex"
  var h = 2166136261L
  for (c in k) {
    h = h xor c.code.toLong()
    h = (h * 16777619L) and 0xFFFFFFFFL
  }
  return BOT_TYPES[(h % BOT_TYPES.size).toInt()]
}

fun moodFor(status: String?): BotMood = when (status) {
  "running", "stuck" -> BotMood.Working
  "paused" -> BotMood.Sleeping
  else -> BotMood.Idle
}

/**
 * A living bot: breathes, blinks, glances around, tilts its head toward where
 * it's looking, hops (with squash and stretch) while it works, sleeps with
 * its eyes shut, and jumps when tapped. Drawn from the bot-avatars outlines
 * with a soft lit-plastic shading — no bitmaps, crisp at any size.
 */
@Composable
fun BotAvatar(
  type: String,
  mood: BotMood,
  size: Dp,
  modifier: Modifier = Modifier,
  interactive: Boolean = true,
  label: String? = null,
  color: Color? = null,
) {
  val shape = BOT_SHAPES[type] ?: BOT_SHAPES.getValue("flower")
  val body = remember(type) { PathParser().parsePathString(shape.path).toPath() }
  val parts = remember(type) { shape.parts?.let { PathParser().parsePathString(it).toPath() } }
  val color = color ?: Color(shape.color)
  val ink = if (color.luminance() > 0.45f) Color(0xFF15161A) else Color(0xFFF8F8FA)
  val haptics = LocalHaptics.current
  val scope = rememberCoroutineScope()
  val seed = remember(type) { Random(type.hashCode()) }

  val hop = remember { Animatable(0f) }        // units above rest (body is 100 tall)
  val squash = remember { Animatable(1f) }     // 1 = rest; <1 squashed, >1 stretched
  val eyeOpen = remember { Animatable(1f) }
  val lookX = remember { Animatable(0f) }
  val lookY = remember { Animatable(0f) }

  val breath by rememberInfiniteTransition(label = "breath").animateFloat(
    initialValue = 0f,
    targetValue = 1f,
    animationSpec = infiniteRepeatable(tween(if (mood == BotMood.Sleeping) 4200 else 3000, easing = LinearEasing), RepeatMode.Restart),
    label = "breathPhase",
  )

  suspend fun jump(height: Float) {
    squash.animateTo(0.86f, tween(90, easing = FastOutSlowInEasing))
    scope.launch { squash.animateTo(1.1f, tween(160)) }
    hop.animateTo(height, tween(220, easing = FastOutSlowInEasing))
    scope.launch { squash.animateTo(1f, tween(180)) }
    hop.animateTo(0f, tween(240, easing = FastOutSlowInEasing))
    squash.animateTo(0.9f, tween(70))
    squash.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
  }

  // Blinking — never while asleep (lids are already shut).
  LaunchedEffect(mood) {
    if (mood == BotMood.Sleeping) { eyeOpen.animateTo(0f, tween(400)); return@LaunchedEffect }
    eyeOpen.animateTo(1f, tween(250))
    while (true) {
      delay(2200L + seed.nextLong(3200))
      eyeOpen.animateTo(0.08f, tween(70))
      eyeOpen.animateTo(1f, tween(120))
      if (seed.nextInt(5) == 0) { // the odd double blink
        delay(120)
        eyeOpen.animateTo(0.08f, tween(60))
        eyeOpen.animateTo(1f, tween(110))
      }
    }
  }

  // Glancing around.
  LaunchedEffect(mood) {
    if (mood == BotMood.Sleeping) {
      lookX.animateTo(0f); lookY.animateTo(2.5f); return@LaunchedEffect
    }
    while (true) {
      delay(1400L + seed.nextLong(2600))
      val x = (seed.nextFloat() * 2 - 1) * 3.2f
      val y = (seed.nextFloat() * 2 - 1) * 1.8f
      launch { lookX.animateTo(x, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessLow)) }
      lookY.animateTo(y, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessLow))
    }
  }

  // Hopping while working; the occasional happy hop while idle.
  LaunchedEffect(mood) {
    when (mood) {
      BotMood.Working -> while (true) { jump(12f); delay(260) }
      BotMood.Idle -> while (true) { delay(7000L + seed.nextLong(6000)); jump(9f) }
      BotMood.Sleeping -> Unit
    }
  }

  val large = size >= 36.dp
  val tapModifier = if (interactive) {
    Modifier.pointerInput(type) {
      detectTapGestures {
        haptics.hop()
        scope.launch { jump(18f) }
      }
    }
  } else Modifier

  Canvas(
    modifier
      .size(size)
      .then(tapModifier)
      .semantics { contentDescription = label ?: "DEX" },
  ) {
    val unit = this.size.minDimension / 100f
    val phase = breath * 2f * PI.toFloat()
    val breathe = if (mood == BotMood.Sleeping) 1f + 0.025f * sin(phase) else 1f + 0.012f * sin(phase)
    val bob = if (mood == BotMood.Idle) 1.2f * sin(phase) else 0f
    val lift = hop.value + bob

    // Contact shadow: shrinks and fades as the bot rises.
    val shadowW = 48f * unit * (1f - (hop.value / 40f).coerceIn(0f, 0.5f))
    drawOval(
      color = Color.Black.copy(alpha = 0.16f * (1f - (hop.value / 30f).coerceIn(0f, 0.6f))),
      topLeft = Offset(50f * unit - shadowW / 2, 90f * unit),
      size = Size(shadowW, 6f * unit),
    )

    translate(top = -lift * unit) {
      val sx = (2f - squash.value) * breathe
      val sy = squash.value * breathe
      scale(scaleX = sx, scaleY = sy, pivot = Offset(50f * unit, 88f * unit)) {
        rotate(degrees = lookX.value * 1.4f, pivot = Offset(50f * unit, 60f * unit)) {
          scale(unit, unit, pivot = Offset.Zero) {
            parts?.let { drawPath(it, lerp(color, Color.Black, 0.18f)) }
            drawPath(body, color)
            // Lit plastic: a soft key light from the upper left, a darker belly.
            drawPath(
              body,
              Brush.radialGradient(
                colors = listOf(Color.White.copy(alpha = 0.42f), Color.White.copy(alpha = 0f)),
                center = Offset(34f + lookX.value, 26f),
                radius = 52f,
              ),
            )
            drawPath(
              body,
              Brush.verticalGradient(
                colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.2f)),
                startY = 48f,
                endY = 96f,
              ),
            )
            drawPath(body, Color.White.copy(alpha = 0.18f), style = Stroke(width = 0.9f))

            // Face.
            val fs = shape.faceScale
            val cx = shape.faceX + lookX.value
            val cy = shape.faceY - 3f + lookY.value
            val gap = 7.6f * fs
            val w = 6.4f * fs
            val fullH = 9.6f * fs
            if (mood == BotMood.Sleeping || eyeOpen.value < 0.12f) {
              for (dx in floatArrayOf(-gap, gap)) {
                drawArc(
                  color = ink,
                  startAngle = 20f,
                  sweepAngle = 140f,
                  useCenter = false,
                  topLeft = Offset(cx + dx - w * 0.7f, cy - 2f),
                  size = Size(w * 1.4f, 4.5f * fs),
                  style = Stroke(width = 1.6f * fs, cap = StrokeCap.Round),
                )
              }
            } else {
              val h = fullH * eyeOpen.value
              for (dx in floatArrayOf(-gap, gap)) {
                drawRoundRect(
                  color = ink,
                  topLeft = Offset(cx + dx - w / 2, cy - h / 2),
                  size = Size(w, h),
                  cornerRadius = CornerRadius(w / 2, w / 2),
                )
                if (eyeOpen.value > 0.6f && ink.luminance() < 0.5f) {
                  drawCircle(Color.White.copy(alpha = 0.85f), radius = 1.1f * fs, center = Offset(cx + dx - w * 0.12f, cy - h * 0.22f))
                }
              }
            }
            if (mood == BotMood.Working && large) {
              // A wide grin while it works.
              drawArc(
                color = ink,
                startAngle = 15f,
                sweepAngle = 150f,
                useCenter = false,
                topLeft = Offset(cx - 5f * fs, cy + 5f * fs),
                size = Size(10f * fs, 6f * fs),
                style = Stroke(width = 1.7f * fs, cap = StrokeCap.Round),
              )
            }
            if (mood == BotMood.Sleeping && large) {
              val z = abs(sin(phase))
              drawCircle(ink.copy(alpha = 0.25f * z), radius = 1.6f, center = Offset(80f, 22f - 6f * z))
              drawCircle(ink.copy(alpha = 0.18f * (1 - z)), radius = 2.3f, center = Offset(86f, 14f - 5f * (1 - z)))
            }
          }
        }
      }
    }
  }
}
