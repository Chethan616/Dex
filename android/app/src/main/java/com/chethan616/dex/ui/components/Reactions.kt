package com.chethan616.dex.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chethan616.dex.data.Block
import com.chethan616.dex.data.Reaction

/**
 * DEX's reactions on your messages (the desktop's src/shared/reactions.ts is
 * the source of truth). You don't react; DEX does, sparingly — a 👍 when you
 * say "ok go on" to something it asked, a ❤️ for a thank-you — shown the way
 * Grok and WhatsApp show one: a small emoji tucked onto the bubble's corner.
 */
class ReactionsState(val reactions: Map<String, List<Reaction>>)

val LocalReactions = staticCompositionLocalOf<ReactionsState?> { null }

/** The message key the desktop uses: 'u:prompt' for the first message, 'u:<at>' for the rest. */
fun messageKey(block: Block): String? = when (block.kind) {
  "user" -> if (block.seq == 0L) "u:prompt" else block.at?.let { "u:$it" }
  else -> null
}

/** Your message, with DEX's reaction on its lower corner when it has one. */
@Composable
fun Reactable(key: String?, content: @Composable () -> Unit) {
  val emojis = key?.let { k -> LocalReactions.current?.reactions?.get(k) }.orEmpty().filter { it.byAgent }.map { it.emoji }.distinct()
  if (emojis.isEmpty()) { content(); return }
  Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
    content()
    // Tucked up onto the bubble's corner, half over it.
    ReactionBadge(emojis, Modifier.offset(x = (-10).dp, y = (-11).dp))
  }
}

/**
 * The badge: a small circle in the chat's raised surface, ringed with the
 * background so it reads as sitting on the bubble. It pops in once.
 */
@Composable
private fun ReactionBadge(emojis: List<String>, modifier: Modifier = Modifier) {
  val scheme = MaterialTheme.colorScheme
  val pop = remember { Animatable(0.5f) }
  LaunchedEffect(Unit) { pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium)) }
  Surface(
    shape = CircleShape,
    color = scheme.surfaceContainerHighest,
    border = BorderStroke(2.dp, scheme.surface),
    modifier = modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value },
  ) {
    Row(
      Modifier.heightIn(min = 26.dp).widthIn(min = 26.dp).padding(horizontal = 5.dp),
      horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      emojis.forEach { e -> Box(contentAlignment = Alignment.Center) { Text(e, fontSize = 12.sp) } }
    }
  }
}
