package com.chethan616.dex.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.animateColorAsState
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.toPath
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.graphics.shapes.Morph
import kotlinx.coroutines.launch

/**
 * The send button, Material 3 Expressive: a scalloped "cookie" that turns
 * slowly while there's something to send, squishes into a circle when you
 * press it, and on send pops and spins while the arrow flies off the top and
 * a fresh one drops back in. Busy shows M3's shape-morphing loading
 * indicator. Disabled, it rests as a quiet circle.
 */
@Composable
fun ExpressiveSendButton(
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  busy: Boolean = false,
  size: Dp = 48.dp,
) {
  val scheme = MaterialTheme.colorScheme
  val scope = rememberCoroutineScope()
  val interaction = remember { MutableInteractionSource() }
  val pressed by interaction.collectIsPressedAsState()
  val active = enabled && !busy

  // Cookie at rest, circle when pressed or idle.
  val morph = remember { Morph(MaterialShapes.Cookie9Sided, MaterialShapes.Circle) }
  val path = remember { Path() }
  val round = remember { Animatable(1f) }
  LaunchedEffect(active, pressed) {
    round.animateTo(if (!active || pressed) 1f else 0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))
  }

  // A slow turn while it's ready; a quick spin on send. Nothing runs while
  // there's nothing to send, and the angle is read only while drawing.
  val drift = if (active) {
    rememberInfiniteTransition(label = "drift").animateFloat(
      initialValue = 0f,
      targetValue = 360f,
      animationSpec = infiniteRepeatable(tween(14_000, easing = LinearEasing), RepeatMode.Restart),
      label = "deg",
    )
  } else null
  val kick = remember { Animatable(0f) }
  val pop = remember { Animatable(1f) }
  val arrowY = remember { Animatable(0f) }   // fraction of the button's height
  val arrowAlpha = remember { Animatable(1f) }

  // Becoming sendable (you typed something) is a little "boing".
  LaunchedEffect(active) {
    if (active) {
      pop.snapTo(0.82f)
      pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
    }
  }

  val container by animateColorAsState(if (active) scheme.primary else scheme.surfaceContainerHighest, label = "container")
  val content by animateColorAsState(if (active) scheme.onPrimary else scheme.onSurfaceVariant.copy(alpha = 0.55f), label = "content")

  fun send() {
    onClick()
    scope.launch {
      launch { kick.snapTo(0f); kick.animateTo(120f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessLow)); kick.snapTo(0f) }
      launch { pop.animateTo(1.16f, tween(110)); pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium)) }
      // The arrow flies up and out, and a new one drops in from below.
      launch { arrowAlpha.animateTo(0f, tween(160)) }
      arrowY.animateTo(-0.9f, tween(170, easing = FastOutLinearInEasing))
      arrowY.snapTo(0.7f)
      launch { arrowAlpha.animateTo(1f, tween(140)) }
      arrowY.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))
    }
  }

  Box(
    modifier
      .size(size)
      .graphicsLayer { scaleX = pop.value; scaleY = pop.value }
      .clickable(interactionSource = interaction, indication = null, enabled = active, role = Role.Button, onClick = ::send)
      .semantics { contentDescription = if (busy) "Sending" else "Send" },
    contentAlignment = Alignment.Center,
  ) {
    Canvas(Modifier.fillMaxSize()) {
      morph.toPath(round.value, path)
      rotate((drift?.value ?: 0f) + kick.value) {
        // MaterialShapes live in a unit square; stretch it to the button.
        scale(this.size.width, this.size.height, pivot = Offset.Zero) { drawPath(path, container) }
      }
    }
    AnimatedContent(busy, transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.6f)) togetherWith fadeOut() }, label = "send") { isBusy ->
      if (isBusy) {
        LoadingIndicator(color = content, modifier = Modifier.size(size * 0.62f))
      } else {
        Icon(
          Icons.Rounded.ArrowUpward,
          contentDescription = null,
          tint = content,
          modifier = Modifier
            .size(size * 0.46f)
            .graphicsLayer {
              translationY = arrowY.value * this.size.height * 1.4f
              alpha = arrowAlpha.value
            },
        )
      }
    }
  }
}
