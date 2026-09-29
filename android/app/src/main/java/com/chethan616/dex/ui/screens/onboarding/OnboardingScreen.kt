package com.chethan616.dex.ui.screens.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.StopCircle
import androidx.compose.material.icons.rounded.TableChart
import androidx.compose.material.icons.rounded.ViewInAr
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.toPath
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.graphics.shapes.Morph
import androidx.graphics.shapes.RoundedPolygon
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.theme.LocalStatusColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

/*
 * The welcome tour: first run, before sign-in (and again from Settings →
 * Welcome tour). Four pages on what DEX on the phone is for, done the
 * Material 3 Expressive way — one big shape behind everything that morphs
 * from page to page as you swipe, confetti shapes drifting at different
 * speeds, a wavy progress line, and a Next button that squishes when pressed
 * and grows into "Get started". Every page has something to poke: the bots
 * hop when tapped, the approval card really approves.
 */

private data class Page(val title: String, val body: String)

private val PAGES = listOf(
  Page("Meet DEX", "An AI agent that works on your PC for you — and takes orders from your phone."),
  Page("Just ask", "Type it, or share a photo or a file into DEX. Your PC does the rest — mail, websites, files, even 3D."),
  Page("You’re in charge", "Anything risky waits for your OK. Approve, reply or stop a task right from the notification."),
  Page("It all comes back", "Files, pictures and 3D models your PC makes land right here — open them, share them, spin them round."),
)

/** One shape per page; the blob morphs between neighbours as the pager moves. */
private val BLOB_SHAPES: List<RoundedPolygon> = listOf(
  MaterialShapes.Cookie9Sided,
  MaterialShapes.Puffy,
  MaterialShapes.SoftBurst,
  MaterialShapes.Sunny,
)

@Composable
fun OnboardingScreen(onDone: () -> Unit, doneLabel: String = "Get started") {
  val haptics = LocalHaptics.current
  val motion = MaterialTheme.motionScheme
  val scope = rememberCoroutineScope()
  val pager = rememberPagerState { PAGES.size }
  val last = pager.currentPage == PAGES.lastIndex
  // The pager's position as a float: 1.4 is 40% of the way from page 1 to 2.
  val position by remember { derivedStateOf { pager.currentPage + pager.currentPageOffsetFraction } }

  LaunchedEffect(pager) { snapshotFlow { pager.currentPage }.drop(1).collect { haptics.tick() } }
  BackHandler(enabled = pager.currentPage > 0) {
    scope.launch { pager.animateScrollToPage(pager.currentPage - 1, animationSpec = motion.defaultSpatialSpec()) }
  }

  fun next() {
    if (last) {
      haptics.success()
      onDone()
    } else {
      haptics.click()
      scope.launch { pager.animateScrollToPage(pager.currentPage + 1, animationSpec = motion.slowSpatialSpec()) }
    }
  }

  Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
      TopBar(showSkip = !last, onSkip = { haptics.click(); onDone() })

      BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
        val hero = minOf(maxHeight * 0.62f, 440.dp)
        // On a tall phone the picture and the words (about 190dp) sit centred,
        // not stuck to the top with a gap above the buttons.
        val top = ((maxHeight - hero - 190.dp) / 2).coerceIn(0.dp, 72.dp)
        Confetti({ position }, hero, Modifier.offset(y = top))
        MorphingBlob({ position }, Modifier.align(Alignment.TopCenter).offset(y = top + hero * 0.07f).size(hero * 0.86f))
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { index ->
          PageContent(index, pager, hero, top)
        }
      }

      Row(
        Modifier.fillMaxWidth().padding(start = 28.dp, end = 20.dp, top = 8.dp, bottom = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        LinearWavyProgressIndicator(
          progress = { ((position + 1f) / PAGES.size).coerceIn(0f, 1f) },
          modifier = Modifier.width(132.dp),
        )
        Spacer(Modifier.weight(1f))
        Button(
          onClick = ::next,
          shapes = ButtonDefaults.shapes(),
          contentPadding = PaddingValues(horizontal = if (last) 28.dp else 0.dp),
          modifier = Modifier.height(64.dp).widthIn(min = 64.dp).animateContentSize(motion.defaultSpatialSpec()),
        ) {
          AnimatedContent(last, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) }, label = "next") { end ->
            if (end) {
              Row(verticalAlignment = Alignment.CenterVertically) {
                Text(doneLabel, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.width(10.dp))
                Icon(Icons.AutoMirrored.Rounded.ArrowForward, null)
              }
            } else {
              Icon(Icons.AutoMirrored.Rounded.ArrowForward, "Next", Modifier.size(28.dp))
            }
          }
        }
      }
    }
  }
}

@Composable
private fun TopBar(showSkip: Boolean, onSkip: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().height(56.dp).padding(start = 24.dp, end = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text("DEX", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
    Spacer(Modifier.weight(1f))
    AnimatedVisibility(showSkip, enter = fadeIn(), exit = fadeOut()) {
      TextButton(onClick = onSkip) { Text("Skip") }
    }
  }
}

/** One page: its scene over the blob, then the words. Both drift with the swipe. */
@Composable
private fun PageContent(index: Int, pager: PagerState, hero: Dp, top: Dp) {
  // 0 when this page is centred, ±1 a whole page away.
  val offset = { (pager.currentPage - index) + pager.currentPageOffsetFraction }
  val active = pager.settledPage == index
  Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
    Spacer(Modifier.height(top))
    Box(
      Modifier
        .fillMaxWidth()
        .height(hero)
        .graphicsLayer {
          val o = offset()
          // The scene lags the swipe a little (parallax over the blob) and shrinks away.
          translationX = o * size.width * 0.45f
          alpha = 1f - (abs(o) * 1.2f).coerceAtMost(1f)
          val s = 1f - abs(o).coerceAtMost(1f) * 0.2f
          scaleX = s
          scaleY = s
        },
      contentAlignment = Alignment.Center,
    ) {
      when (index) {
        0 -> MeetScene(hero)
        1 -> AskScene(active)
        2 -> ApproveScene(active)
        else -> FilesScene(active)
      }
    }
    Column(
      Modifier
        .padding(horizontal = 28.dp)
        .graphicsLayer {
          val o = offset()
          translationX = o * size.width * 0.2f
          alpha = 1f - (abs(o) * 1.6f).coerceAtMost(1f)
        },
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Spacer(Modifier.height(8.dp))
      Text(
        PAGES[index].title,
        style = MaterialTheme.typography.displaySmallEmphasized,
        textAlign = TextAlign.Center,
      )
      Spacer(Modifier.height(10.dp))
      Text(
        PAGES[index].body,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
      )
    }
  }
}

/** The big shape behind the scenes: morphs page to page, turns slowly, shifts colour. */
@Composable
private fun MorphingBlob(position: () -> Float, modifier: Modifier) {
  val scheme = MaterialTheme.colorScheme
  val colors = listOf(scheme.primaryContainer, scheme.tertiaryContainer, scheme.secondaryContainer, scheme.primaryContainer)
  val morphs = remember { BLOB_SHAPES.zipWithNext { a, b -> Morph(a, b) } }
  val spin by rememberInfiniteTransition(label = "spin").animateFloat(
    initialValue = 0f,
    targetValue = 360f,
    animationSpec = infiniteRepeatable(tween(48_000, easing = LinearEasing)),
    label = "deg",
  )
  val breathe by rememberInfiniteTransition(label = "breathe").animateFloat(
    initialValue = 0.97f,
    targetValue = 1.03f,
    animationSpec = infiniteRepeatable(tween(2600), RepeatMode.Reverse),
    label = "scale",
  )
  val path = remember { Path() }
  Canvas(modifier) {
    val p = position().coerceIn(0f, BLOB_SHAPES.lastIndex.toFloat())
    val i = floor(p).toInt().coerceAtMost(morphs.lastIndex)
    val t = p - i
    val color = lerp(colors[i], colors[i + 1], t)
    morphs[i].toPath(t, path)
    rotate(spin + p * 60f) {
      scale(breathe) {
        // MaterialShapes live in a unit square; stretch it to the canvas.
        scale(size.width, size.height, pivot = Offset.Zero) { drawPath(path, color) }
      }
    }
  }
}

private data class Bit(val shape: RoundedPolygon, val x: Float, val y: Float, val size: Dp, val depth: Float, val tone: Int)

private val BITS = listOf(
  Bit(MaterialShapes.Heart, 0.10f, 0.10f, 30.dp, 1.4f, 2),
  Bit(MaterialShapes.Gem, 0.84f, 0.06f, 24.dp, 0.7f, 1),
  Bit(MaterialShapes.Clover4Leaf, 0.90f, 0.62f, 34.dp, 1.8f, 0),
  Bit(MaterialShapes.Triangle, 0.06f, 0.70f, 22.dp, 1.1f, 1),
  Bit(MaterialShapes.Sunny, 0.72f, 0.90f, 20.dp, 0.5f, 2),
)

/** Little shapes around the hero, each sliding at its own speed as you swipe. */
@Composable
private fun Confetti(position: () -> Float, hero: Dp, modifier: Modifier) {
  val scheme = MaterialTheme.colorScheme
  val tones = listOf(scheme.primary, scheme.secondary, scheme.tertiary)
  val bob by rememberInfiniteTransition(label = "bob").animateFloat(
    initialValue = 0f,
    targetValue = (2 * Math.PI).toFloat(),
    animationSpec = infiniteRepeatable(tween(7000, easing = LinearEasing)),
    label = "t",
  )
  BoxWithConstraints(modifier.fillMaxWidth().height(hero)) {
    val w = maxWidth
    BITS.forEachIndexed { n, bit ->
      val shape = bit.shape.toShape()
      Box(
        Modifier
          .offset(x = w * bit.x - bit.size / 2, y = hero * bit.y)
          .graphicsLayer {
            val p = position()
            translationX = -p * 90f * bit.depth
            translationY = sin(bob + n * 1.3f) * 10f
            rotationZ = p * 40f * bit.depth + n * 25f
          }
          .size(bit.size)
          .background(tones[bit.tone].copy(alpha = 0.55f), shape),
      )
    }
  }
}

/** Page 1: DEX, with three friends orbiting in 3D (behind it, then in front). */
@Composable
private fun MeetScene(hero: Dp) {
  val orbit by rememberInfiniteTransition(label = "orbit").animateFloat(
    initialValue = 0f,
    targetValue = (2 * Math.PI).toFloat(),
    animationSpec = infiniteRepeatable(tween(12_000, easing = LinearEasing)),
    label = "a",
  )
  BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    val rx = minOf(maxWidth * 0.32f, hero * 0.36f).value
    val ry = hero.value * 0.13f
    BotAvatar(type = "flower", mood = BotMood.Idle, size = hero * 0.38f, label = "DEX", modifier = Modifier.zIndex(0f))
    listOf("circle", "star", "droid").forEachIndexed { n, type ->
      val a = orbit + n * (2 * Math.PI / 3).toFloat()
      val depth = sin(a) // -1 behind DEX … 1 in front
      BotAvatar(
        type = type,
        mood = BotMood.Idle,
        size = 50.dp,
        interactive = false,
        modifier = Modifier
          .zIndex(if (depth > 0) 1f else -1f)
          .offset(x = (cos(a) * rx).dp, y = (depth * ry + 8).dp)
          .graphicsLayer {
            val s = 0.78f + 0.22f * (depth + 1f) / 2f * 1.4f
            scaleX = s
            scaleY = s
            alpha = 0.75f + 0.25f * (depth + 1f) / 2f
          },
      )
    }
  }
}

private val ASKS = listOf("Check my mail", "Send the PDF to Mom", "Find flights to Goa", "Make a mushroom house in 3D")

/** Page 2: requests pop out one after another; DEX hops once it has them all. */
@Composable
private fun AskScene(active: Boolean) {
  val haptics = LocalHaptics.current
  var shown by remember { mutableIntStateOf(0) }
  LaunchedEffect(active) {
    if (!active) { shown = 0; return@LaunchedEffect }
    delay(150)
    while (shown < ASKS.size) { delay(320); shown++; haptics.tick() }
  }
  Box(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 12.dp)) {
    Column(Modifier.align(Alignment.TopCenter).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      ASKS.forEachIndexed { i, text ->
        val right = i % 2 == 1
        AnimatedVisibility(
          visible = i < shown,
          modifier = Modifier.align(if (right) Alignment.End else Alignment.Start),
          enter = scaleIn(
            spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow),
            transformOrigin = TransformOrigin(if (right) 1f else 0f, 1f),
          ) + fadeIn(),
          exit = fadeOut(tween(90)),
        ) {
          Surface(
            shape = RoundedCornerShape(22.dp, 22.dp, if (right) 6.dp else 22.dp, if (right) 22.dp else 6.dp),
            color = if (right) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHighest,
            shadowElevation = 3.dp,
            modifier = Modifier.padding(horizontal = if (right) 0.dp else 18.dp),
          ) {
            Text(
              text,
              style = MaterialTheme.typography.titleSmall,
              modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            )
          }
        }
      }
    }
    BotAvatar(
      type = "cat",
      mood = if (shown == ASKS.size) BotMood.Working else BotMood.Idle,
      size = 92.dp,
      modifier = Modifier.align(Alignment.BottomCenter),
    )
  }
}

private enum class Verdict { Waiting, Approved, Stopped }

/** Page 3: a real-looking approval notification whose buttons actually work. */
@Composable
private fun ApproveScene(active: Boolean) {
  val haptics = LocalHaptics.current
  val status = LocalStatusColors.current
  var verdict by remember { mutableStateOf(Verdict.Waiting) }
  val drop = remember { Animatable(-1f) }
  LaunchedEffect(active) {
    if (!active) { verdict = Verdict.Waiting; drop.snapTo(-1f); return@LaunchedEffect }
    delay(120)
    haptics.attention()
    drop.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
  }
  LaunchedEffect(verdict) {
    if (verdict != Verdict.Waiting) { delay(2600); verdict = Verdict.Waiting }
  }
  Box(Modifier.fillMaxSize().padding(horizontal = 22.dp), contentAlignment = Alignment.Center) {
    Surface(
      shape = RoundedCornerShape(30.dp),
      color = MaterialTheme.colorScheme.surfaceContainerHigh,
      shadowElevation = 8.dp,
      modifier = Modifier
        .fillMaxWidth()
        .graphicsLayer {
          translationY = drop.value * 260f
          alpha = (1f + drop.value).coerceIn(0f, 1f)
          rotationZ = drop.value * -6f
        },
    ) {
      Column(Modifier.padding(18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          BotAvatar(
            type = "ghost",
            mood = when (verdict) { Verdict.Approved -> BotMood.Working; Verdict.Stopped -> BotMood.Sleeping; else -> BotMood.Idle },
            size = 44.dp,
          )
          Spacer(Modifier.width(12.dp))
          Column(Modifier.weight(1f)) {
            Text("DEX · needs your OK", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Text("Send 3 replies from your Gmail?", style = MaterialTheme.typography.titleMedium)
          }
        }
        Spacer(Modifier.height(14.dp))
        AnimatedContent(verdict, transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.9f)) togetherWith fadeOut() }, label = "verdict") { v ->
          when (v) {
            Verdict.Waiting -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              Button(
                onClick = { haptics.success(); verdict = Verdict.Approved },
                shapes = ButtonDefaults.shapes(),
                modifier = Modifier.weight(1f).height(52.dp),
              ) { Text("Approve") }
              FilledTonalButton(
                onClick = { haptics.reject(); verdict = Verdict.Stopped },
                shapes = ButtonDefaults.shapes(),
                modifier = Modifier.weight(1f).height(52.dp),
              ) { Text("Stop") }
            }
            Verdict.Approved -> Outcome(Icons.Rounded.Check, "Approved — sending now", status.running)
            Verdict.Stopped -> Outcome(Icons.Rounded.StopCircle, "Stopped. Nothing was sent.", status.stopped)
          }
        }
      }
    }
  }
}

@Composable
private fun Outcome(icon: ImageVector, text: String, tint: Color) {
  Row(Modifier.fillMaxWidth().height(52.dp), verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(32.dp).background(tint.copy(alpha = 0.18f), CircleShape), contentAlignment = Alignment.Center) {
      Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
    }
    Spacer(Modifier.width(12.dp))
    Text(text, style = MaterialTheme.typography.titleSmall)
  }
}

private data class Delivered(val icon: ImageVector, val name: String, val kind: String, val tilt: Float, val x: Dp)

private val FILES = listOf(
  Delivered(Icons.Rounded.PictureAsPdf, "Aadhaar.pdf", "PDF · to WhatsApp", -5f, (-26).dp),
  Delivered(Icons.Rounded.Image, "Timetable.png", "Picture", 4f, 30.dp),
  Delivered(Icons.Rounded.ViewInAr, "Mushroom house", "3D model · Blender", -3f, (-12).dp),
  Delivered(Icons.Rounded.TableChart, "Expenses.xlsx", "Sheet", 6f, 22.dp),
)

/** Page 4: what the PC made drops onto the phone, one bouncy card at a time. */
@Composable
private fun FilesScene(active: Boolean) {
  val haptics = LocalHaptics.current
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      FILES.forEachIndexed { i, file ->
        val fall = remember { Animatable(-1f) }
        LaunchedEffect(active) {
          if (!active) { fall.snapTo(-1f); return@LaunchedEffect }
          delay(140L + i * 170L)
          launch { delay(260); haptics.tick() }
          fall.animateTo(0f, spring(dampingRatio = 0.48f, stiffness = Spring.StiffnessLow))
        }
        Surface(
          shape = RoundedCornerShape(20.dp),
          color = MaterialTheme.colorScheme.surfaceContainerHighest,
          shadowElevation = 4.dp,
          modifier = Modifier
            .offset(x = file.x)
            .graphicsLayer {
              translationY = fall.value * 900f
              rotationZ = file.tilt + fall.value * 20f
              alpha = (1.6f + fall.value * 1.6f).coerceIn(0f, 1f)
            },
        ) {
          Row(Modifier.padding(start = 10.dp, end = 18.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
              Modifier.size(38.dp).background(MaterialTheme.colorScheme.primaryContainer, MaterialShapes.Cookie6Sided.toShape()),
              contentAlignment = Alignment.Center,
            ) {
              Icon(file.icon, null, tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column {
              Text(file.name, style = MaterialTheme.typography.titleSmall)
              Text(file.kind, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
    }
    BotAvatar(
      type = "drop",
      mood = BotMood.Idle,
      size = 58.dp,
      modifier = Modifier.align(Alignment.BottomEnd).padding(end = 34.dp, bottom = 6.dp),
    )
  }
}
