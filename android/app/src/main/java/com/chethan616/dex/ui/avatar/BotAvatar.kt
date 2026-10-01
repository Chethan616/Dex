package com.chethan616.dex.ui.avatar

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
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
import kotlin.math.sin
import kotlin.random.Random

/**
 * What a bot is doing — the same moods as the desktop (renderer
 * components/lib/botMood.ts):
 *
 *  - Idle       awake, blinking, glancing round, the odd happy hop
 *  - Thinking   eyes up and to the side, a small "hmm", thought dots
 *  - Working    hopping with a grin
 *  - NeedsYou   wide eyes on you, raised brows, a pulsing "!", eager hops
 *  - Happy      ^ ^ eyes, a big open smile, a jump, sparkles
 *  - Sad        droopy brows, a frown, a sweat drop, a little grey
 *  - Sleeping   eyes shut, slow breaths, z's
 */
enum class BotMood { Idle, Thinking, Working, NeedsYou, Happy, Sad, Sleeping }

/**
 * Same mapping as the desktop's AgentAvatar: every task gets its own bot, a
 * stable hash of its session id — so a list of tasks isn't a row of identical
 * faces, and a task looks the same on the phone and the PC. Without a task
 * (the agent pickers) the engine picks: Claude Code a flower, Codex a circle,
 * BrowserCode a droid.
 */
fun botTypeFor(engineId: String?, sessionId: String? = null): String {
  if (sessionId == null) {
    when (engineId) {
      "claude-code" -> return "flower"
      "codex" -> return "circle"
      "browsercode", "opencode" -> return "droid"
    }
  }
  val k = sessionId ?: engineId ?: "dex"
  var h = 2166136261L
  for (c in k) {
    h = h xor c.code.toLong()
    h = (h * 16777619L) and 0xFFFFFFFFL
  }
  return BOT_TYPES[(h % BOT_TYPES.size).toInt()]
}

/** From a status alone (where nothing else is known): working, asleep, or awake. */
fun moodFor(status: String?): BotMood = when (status) {
  "running", "stuck" -> BotMood.Working
  // A paused task naps; a finished one rests.
  "paused", "idle", "stopped" -> BotMood.Sleeping
  else -> BotMood.Idle
}

private val AMBER = Color(0xFFF5A623)
private val SPARKLE = Color(0xFFFFD24A)
private val SPARKLE_COOL = Color(0xFF7FD8FF)
private val SWEAT = Color(0xFF7CC4F5)
/** A soft periwinkle that reads on light and dark screens alike. */
private val SLEEPY = Color(0xFF8EA2F2)

/**
 * A living bot: breathes, blinks, glances around, tilts its head toward where
 * it's looking, and wears its mood — each with its own face, its own way of
 * moving, and a little accent (thought dots, a "!", sparkles, a sweat drop,
 * z's). It jumps when tapped. Drawn from the bot-avatars outlines with a soft
 * lit-plastic shading — no bitmaps, crisp at any size.
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
  /**
   * A still portrait: the mood's face and accent, drawn once — for lists,
   * where a dozen breathing, blinking bots would each redraw every frame.
   * A tap still makes it jump.
   */
  still: Boolean = false,
) {
  val shape = BOT_SHAPES[type] ?: BOT_SHAPES.getValue("flower")
  val body = remember(type) { PathParser().parsePathString(shape.path).toPath() }
  val parts = remember(type) { shape.parts?.let { PathParser().parsePathString(it).toPath() } }
  // A sad bot loses a little colour.
  val grey by animateFloatAsState(if (mood == BotMood.Sad) 0.32f else 0f, tween(900), label = "grey")
  val base = color ?: Color(shape.color)
  val bodyColor = lerp(base, Color(0xFF8C9199), grey)
  val ink = if (base.luminance() > 0.45f) Color(0xFF15161A) else Color(0xFFF8F8FA)
  val haptics = LocalHaptics.current
  val scope = rememberCoroutineScope()
  val seed = remember(type) { Random(type.hashCode()) }

  val hop = remember { Animatable(0f) }        // units above rest (body is 100 tall)
  val squash = remember { Animatable(1f) }     // 1 = rest; <1 squashed, >1 stretched
  val eyeOpen = remember { Animatable(1f) }
  val lookX = remember { Animatable(0f) }
  val lookY = remember { Animatable(0f) }
  val spin = remember { Animatable(0f) }       // a happy twirl, degrees
  val accent = remember { Animatable(0f) }     // the accent popping in, 0…1

  val slow = mood == BotMood.Sleeping || mood == BotMood.Sad
  // Both phases are read only while drawing (a running bot redraws; it never
  // recomposes), and a still one has none at all.
  val breathPhase = if (still) null else rememberInfiniteTransition(label = "breath").animateFloat(
    initialValue = 0f,
    targetValue = 1f,
    animationSpec = infiniteRepeatable(tween(if (slow) 4200 else 3000, easing = LinearEasing), RepeatMode.Restart),
    label = "breathPhase",
  )
  val beatPhase = if (still) null else rememberInfiniteTransition(label = "beat").animateFloat(
    initialValue = 0f,
    targetValue = 1f,
    animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart),
    label = "beatPhase",
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

  if (still) {
    // The mood's resting pose, set once.
    LaunchedEffect(mood) {
      accent.snapTo(1f)
      eyeOpen.snapTo(when (mood) { BotMood.Sleeping -> 0f; BotMood.Thinking -> 0.72f; else -> 1f })
      val (x, y) = when (mood) {
        BotMood.Sleeping -> 0f to 2.5f
        BotMood.Sad -> -1f to 2.2f
        BotMood.NeedsYou, BotMood.Happy -> 0f to -0.5f
        BotMood.Thinking -> 2.6f to -2.4f
        else -> 0f to 0f
      }
      lookX.snapTo(x)
      lookY.snapTo(y)
    }
  } else {
  // The accent pops in on every change of mood.
  LaunchedEffect(mood) {
    accent.snapTo(0f)
    accent.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))
  }

  // Blinking — never while asleep (lids are already shut) or beaming (^ ^).
  LaunchedEffect(mood) {
    when (mood) {
      BotMood.Sleeping -> { eyeOpen.animateTo(0f, tween(400)); return@LaunchedEffect }
      BotMood.Thinking -> eyeOpen.animateTo(0.72f, tween(300))
      else -> eyeOpen.animateTo(1f, tween(250))
    }
    val open = eyeOpen.value
    while (true) {
      delay(2200L + seed.nextLong(3200))
      eyeOpen.animateTo(0.08f, tween(70))
      eyeOpen.animateTo(open, tween(120))
      if (seed.nextInt(5) == 0) { // the odd double blink
        delay(120)
        eyeOpen.animateTo(0.08f, tween(60))
        eyeOpen.animateTo(open, tween(110))
      }
    }
  }

  // Where it looks.
  LaunchedEffect(mood) {
    val soft = spring<Float>(dampingRatio = 0.7f, stiffness = Spring.StiffnessLow)
    when (mood) {
      BotMood.Sleeping -> { launch { lookX.animateTo(0f) }; lookY.animateTo(2.5f) }
      BotMood.Sad -> { launch { lookX.animateTo(-1f, soft) }; lookY.animateTo(2.2f, soft) }
      // Straight at you.
      BotMood.NeedsYou, BotMood.Happy -> { launch { lookX.animateTo(0f, soft) }; lookY.animateTo(-0.5f, soft) }
      // Up and to the side, drifting a little.
      BotMood.Thinking -> while (true) {
        launch { lookX.animateTo(2.4f + seed.nextFloat() * 0.8f, soft) }
        lookY.animateTo(-2.6f + seed.nextFloat() * 0.6f, soft)
        delay(1800L + seed.nextLong(1400))
      }
      else -> while (true) {
        delay(1400L + seed.nextLong(2600))
        val x = (seed.nextFloat() * 2 - 1) * 3.2f
        val y = (seed.nextFloat() * 2 - 1) * 1.8f
        launch { lookX.animateTo(x, soft) }
        lookY.animateTo(y, soft)
      }
    }
  }

  // How it moves.
  LaunchedEffect(mood) {
    when (mood) {
      BotMood.Working -> while (true) { jump(12f); delay(260) }
      BotMood.NeedsYou -> while (true) { jump(7f); jump(5f); delay(1500) }
      BotMood.Happy -> {
        launch { spin.snapTo(0f); spin.animateTo(360f, tween(620, easing = FastOutSlowInEasing)); spin.snapTo(0f) }
        jump(22f)
        while (true) { delay(2600); jump(10f) }
      }
      BotMood.Idle -> while (true) { delay(7000L + seed.nextLong(6000)); jump(9f) }
      BotMood.Thinking, BotMood.Sad, BotMood.Sleeping -> Unit
    }
  }
  }

  val large = size >= 36.dp
  val showAccent = size >= 24.dp
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
      .semantics { contentDescription = label ?: "DEX, ${moodLabel(mood)}" },
  ) {
    val unit = this.size.minDimension / 100f
    val breath = breathPhase?.value ?: 0f
    val beat = beatPhase?.value ?: 0.4f
    val phase = breath * 2f * PI.toFloat()
    val breathe = if (slow) 1f + 0.025f * sin(phase) else 1f + 0.012f * sin(phase)
    val bob = if (mood == BotMood.Idle) 1.2f * sin(phase) else 0f
    // Thinking sways gently side to side.
    val sway = if (mood == BotMood.Thinking) 3.5f * sin(phase) else 0f
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
        rotate(degrees = lookX.value * 1.4f + sway + spin.value, pivot = Offset(50f * unit, 60f * unit)) {
          scale(unit, unit, pivot = Offset.Zero) {
            parts?.let { drawPath(it, lerp(bodyColor, Color.Black, 0.18f)) }
            drawPath(body, bodyColor)
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
            drawFace(mood, shape, ink, lookX.value, lookY.value, eyeOpen.value, large)
          }
        }
      }
      if (showAccent) {
        scale(unit, unit, pivot = Offset.Zero) {
          drawAccent(mood, ink, phase, beat, accent.value)
        }
      }
    }
  }
}

private fun moodLabel(mood: BotMood): String = when (mood) {
  BotMood.Idle -> "ready"
  BotMood.Thinking -> "thinking"
  BotMood.Working -> "working"
  BotMood.NeedsYou -> "needs you"
  BotMood.Happy -> "done"
  BotMood.Sad -> "hit a problem"
  BotMood.Sleeping -> "asleep"
}

/** The face, in the 100-unit body box. */
private fun DrawScope.drawFace(
  mood: BotMood,
  shape: BotShape,
  ink: Color,
  lookX: Float,
  lookY: Float,
  eyeOpen: Float,
  large: Boolean,
) {
  val fs = shape.faceScale
  val cx = shape.faceX + lookX
  val cy = shape.faceY - 3f + lookY
  val gap = 7.6f * fs
  val w = 6.4f * fs
  val fullH = 9.6f * fs
  val line = Stroke(width = 1.6f * fs, cap = StrokeCap.Round)

  when {
    // Beaming: eyes squeezed into happy arcs, ^ ^.
    mood == BotMood.Happy -> for (dx in floatArrayOf(-gap, gap)) {
      drawArc(ink, startAngle = 200f, sweepAngle = 140f, useCenter = false, topLeft = Offset(cx + dx - w * 0.75f, cy - 2.2f * fs), size = Size(w * 1.5f, 5.5f * fs), style = Stroke(width = 1.9f * fs, cap = StrokeCap.Round))
    }
    mood == BotMood.Sleeping || eyeOpen < 0.12f -> for (dx in floatArrayOf(-gap, gap)) {
      drawArc(ink, startAngle = 20f, sweepAngle = 140f, useCenter = false, topLeft = Offset(cx + dx - w * 0.7f, cy - 2f), size = Size(w * 1.4f, 4.5f * fs), style = line)
    }
    else -> {
      val wide = if (mood == BotMood.NeedsYou) 1.14f else 1f
      val h = fullH * eyeOpen * wide
      val ew = w * wide
      for (dx in floatArrayOf(-gap, gap)) {
        drawRoundRect(ink, topLeft = Offset(cx + dx - ew / 2, cy - h / 2), size = Size(ew, h), cornerRadius = CornerRadius(ew / 2, ew / 2))
        if (eyeOpen > 0.6f && ink.luminance() < 0.5f) {
          drawCircle(Color.White.copy(alpha = 0.85f), radius = 1.1f * fs, center = Offset(cx + dx - ew * 0.12f, cy - h * 0.22f))
        }
      }
    }
  }

  if (!large) return
  val browY = cy - fullH * 0.5f - 3.4f * fs
  when (mood) {
    BotMood.Working -> // A wide grin.
      drawArc(ink, startAngle = 15f, sweepAngle = 150f, useCenter = false, topLeft = Offset(cx - 5f * fs, cy + 5f * fs), size = Size(10f * fs, 6f * fs), style = Stroke(width = 1.7f * fs, cap = StrokeCap.Round))
    BotMood.Happy -> { // A big open smile.
      drawArc(ink, startAngle = 0f, sweepAngle = 180f, useCenter = true, topLeft = Offset(cx - 5.5f * fs, cy + 2.5f * fs), size = Size(11f * fs, 8f * fs))
      drawArc(Color(0xFFFF7A8A), startAngle = 20f, sweepAngle = 140f, useCenter = true, topLeft = Offset(cx - 3f * fs, cy + 5.5f * fs), size = Size(6f * fs, 4.5f * fs))
    }
    BotMood.Thinking -> // A small "hmm", off to one side.
      drawLine(ink, Offset(cx + 0.5f * fs, cy + 7.2f * fs), Offset(cx + 4.5f * fs, cy + 6.4f * fs), strokeWidth = 1.6f * fs, cap = StrokeCap.Round)
    BotMood.NeedsYou -> { // Raised brows and a little "o".
      for (dx in floatArrayOf(-gap, gap)) {
        drawLine(ink, Offset(cx + dx - w * 0.55f, browY - 0.6f * fs), Offset(cx + dx + w * 0.55f, browY - 1.4f * fs), strokeWidth = 1.5f * fs, cap = StrokeCap.Round)
      }
      drawOval(ink, topLeft = Offset(cx - 1.8f * fs, cy + 5.2f * fs), size = Size(3.6f * fs, 4.2f * fs))
    }
    BotMood.Sad -> { // Brows that slope down to the sides, and a frown.
      for (sign in floatArrayOf(-1f, 1f)) {
        val x = cx + sign * gap
        drawLine(ink, Offset(x - sign * w * 0.6f, browY - 1.2f * fs), Offset(x + sign * w * 0.6f, browY + 0.6f * fs), strokeWidth = 1.5f * fs, cap = StrokeCap.Round)
      }
      drawArc(ink, startAngle = 200f, sweepAngle = 140f, useCenter = false, topLeft = Offset(cx - 4.5f * fs, cy + 6.5f * fs), size = Size(9f * fs, 5.5f * fs), style = Stroke(width = 1.6f * fs, cap = StrokeCap.Round))
    }
    else -> Unit
  }
}

/** The accent beside the head, in the 100-unit box: pops in with the mood. */
private fun DrawScope.drawAccent(mood: BotMood, ink: Color, phase: Float, beat: Float, pop: Float) {
  if (pop <= 0.01f) return
  when (mood) {
    BotMood.Thinking -> scale(pop, pivot = Offset(80f, 16f)) {
      // A little thought cloud with three dots taking turns.
      drawCircle(Color.White.copy(alpha = 0.92f), radius = 3f, center = Offset(66f, 28f))
      drawRoundRect(Color.White.copy(alpha = 0.95f), topLeft = Offset(69f, 6f), size = Size(24f, 13f), cornerRadius = CornerRadius(7f, 7f))
      for (i in 0 until 3) {
        val t = ((beat * 3f - i) % 3f + 3f) % 3f
        val up = if (t < 1f) sin(t * PI.toFloat()) * 2.2f else 0f
        drawCircle(Color(0xFF55595F).copy(alpha = 0.55f + up / 5f), radius = 2f, center = Offset(75f + i * 6f, 12.5f - up))
      }
    }
    BotMood.NeedsYou -> {
      val pulse = 1f + 0.12f * sin(beat * 2f * PI.toFloat())
      val ring = beat
      drawCircle(AMBER.copy(alpha = 0.35f * (1f - ring)), radius = 10f + 8f * ring, center = Offset(84f, 14f))
      scale(pop * pulse, pivot = Offset(84f, 14f)) {
        drawCircle(AMBER, radius = 9.5f, center = Offset(84f, 14f))
        drawLine(Color(0xFF1A1206), Offset(84f, 8.5f), Offset(84f, 15.5f), strokeWidth = 3f, cap = StrokeCap.Round)
        drawCircle(Color(0xFF1A1206), radius = 1.7f, center = Offset(84f, 19.5f))
      }
    }
    BotMood.Happy -> {
      val stars = listOf(Triple(Offset(84f, 12f), 7f, SPARKLE), Triple(Offset(14f, 22f), 5f, SPARKLE), Triple(Offset(72f, 2f), 4f, SPARKLE_COOL))
      stars.forEachIndexed { i, (c, r, tone) ->
        val t = (sin((beat + i * 0.33f) * 2f * PI.toFloat()) + 1f) / 2f
        val s = pop * (0.45f + 0.7f * t)
        rotate(45f * t, pivot = c) { drawSparkle(c, r * s, tone.copy(alpha = 0.55f + 0.45f * t)) }
      }
    }
    BotMood.Sad -> {
      // A sweat drop sliding down the temple.
      val t = (beat * 0.6f) % 1f
      val y = 18f + 12f * t
      val a = (if (t < 0.15f) t / 0.15f else if (t > 0.8f) (1f - t) / 0.2f else 1f) * pop
      val drop = Path().apply {
        moveTo(86f, y - 6f)
        cubicTo(90f, y - 1f, 91f, y + 2f, 86f, y + 4f)
        cubicTo(81f, y + 2f, 82f, y - 1f, 86f, y - 6f)
        close()
      }
      drawPath(drop, SWEAT.copy(alpha = a))
      drawCircle(Color.White.copy(alpha = 0.7f * a), radius = 1f, center = Offset(84.6f, y))
    }
    BotMood.Sleeping -> {
      // Two z's drifting up and away.
      for (i in 0 until 2) {
        val t = ((phase / (2f * PI.toFloat())) + i * 0.5f) % 1f
        val s = (7f - i * 2f) * (0.7f + 0.4f * t)
        val x = 78f + 8f * t + i * 5f
        val y = 26f - 22f * t - i * 4f
        val a = (if (t < 0.2f) t / 0.2f else 1f - (t - 0.2f) / 0.8f) * pop
        drawZ(Offset(x, y), s, SLEEPY.copy(alpha = 0.9f * a))
      }
    }
    else -> Unit
  }
}

private fun DrawScope.drawSparkle(c: Offset, r: Float, color: Color) {
  val path = Path().apply {
    moveTo(c.x, c.y - r)
    quadraticTo(c.x + r * 0.18f, c.y - r * 0.18f, c.x + r, c.y)
    quadraticTo(c.x + r * 0.18f, c.y + r * 0.18f, c.x, c.y + r)
    quadraticTo(c.x - r * 0.18f, c.y + r * 0.18f, c.x - r, c.y)
    quadraticTo(c.x - r * 0.18f, c.y - r * 0.18f, c.x, c.y - r)
    close()
  }
  drawPath(path, color)
}

private fun DrawScope.drawZ(at: Offset, s: Float, color: Color) {
  val path = Path().apply {
    moveTo(at.x, at.y)
    lineTo(at.x + s, at.y)
    lineTo(at.x, at.y + s)
    lineTo(at.x + s, at.y + s)
  }
  drawPath(path, color, style = Stroke(width = s * 0.22f, cap = StrokeCap.Round))
}
