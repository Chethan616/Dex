package com.chethan616.dex.ui.components

import android.view.ViewGroup
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.emoji2.emojipicker.EmojiPickerView
import com.chethan616.dex.data.Block
import com.chethan616.dex.data.Reaction
import com.chethan616.dex.ui.haptics.LocalHaptics

/**
 * Reactions on chat messages, like WhatsApp's and Grok's (the desktop's
 * src/shared/reactions.ts is the source of truth): chips on the bubble's
 * corner, a long-press for the quick row, and "+" for every emoji.
 */
class ReactionsState(
  val reactions: Map<String, List<Reaction>>,
  val onReact: (target: String, emoji: String, on: Boolean) -> Unit,
)

val LocalReactions = staticCompositionLocalOf<ReactionsState?> { null }

val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👀")

/** The message key the desktop uses: 'u:prompt', 'u:<at>' for yours, 'a:<at>' for DEX's. */
fun messageKey(block: Block): String? = when (block.kind) {
  "user" -> if (block.seq == 0L) "u:prompt" else block.at?.let { "u:$it" }
  "text", "done" -> block.at?.let { "a:$it" }
  else -> null
}

/**
 * A message you can react to: long-press opens the quick row above it, and
 * its reactions sit on its lower corner (the end for yours, the start for
 * DEX's).
 */
@Composable
fun Reactable(key: String?, alignEnd: Boolean, content: @Composable () -> Unit) {
  val state = LocalReactions.current
  if (key == null || state == null) { content(); return }
  val haptics = LocalHaptics.current
  var bar by remember { mutableStateOf(false) }
  var picker by remember { mutableStateOf(false) }
  val list = state.reactions[key].orEmpty()
  val mine = list.filter { !it.byAgent }.map { it.emoji }
  fun pick(emoji: String) {
    haptics.click()
    state.onReact(key, emoji, emoji !in mine)
    bar = false
    picker = false
  }

  Box(Modifier.fillMaxWidth()) {
    Column(
      Modifier
        .fillMaxWidth()
        .pointerInput(key) { detectTapGestures(onLongPress = { haptics.tick(); bar = true }) },
      horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start,
    ) {
      content()
      if (list.isNotEmpty()) {
        // On your bubble, tucked up onto its corner like Grok's; under DEX's
        // text (no bubble), just below the last line.
        ReactionChips(
          list,
          onToggle = { e, on -> haptics.tick(); state.onReact(key, e, on) },
          modifier = if (alignEnd) Modifier.offset(x = (-6).dp, y = (-8).dp) else Modifier.padding(top = 4.dp),
        )
      }
    }
    if (bar) {
      val lift = with(LocalDensity.current) { 52.dp.roundToPx() }
      Popup(
        alignment = if (alignEnd) Alignment.TopEnd else Alignment.TopStart,
        offset = IntOffset(0, -lift),
        onDismissRequest = { bar = false },
        properties = PopupProperties(focusable = true),
      ) {
        QuickBar(mine, onPick = ::pick, onMore = { bar = false; picker = true })
      }
    }
  }
  if (picker) EmojiPickerSheet(onPick = ::pick, onDismiss = { picker = false })
}

@Composable
private fun ReactionChips(list: List<Reaction>, onToggle: (String, Boolean) -> Unit, modifier: Modifier = Modifier) {
  val chips = list.groupBy { it.emoji }
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    chips.forEach { (emoji, rs) ->
      val mine = rs.any { !it.byAgent }
      val scheme = MaterialTheme.colorScheme
      Surface(
        shape = RoundedCornerShape(50),
        color = if (mine) scheme.secondaryContainer else scheme.surfaceContainerHigh,
        border = BorderStroke(1.dp, if (mine) scheme.secondary.copy(alpha = 0.45f) else scheme.outlineVariant),
        shadowElevation = 2.dp,
        modifier = Modifier.clickable { onToggle(emoji, !mine) },
      ) {
        Row(Modifier.padding(horizontal = 7.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
          Text(emoji, fontSize = 14.sp)
          if (rs.size > 1) Text("${rs.size}", style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant)
        }
      }
    }
  }
}

@Composable
private fun QuickBar(mine: List<String>, onPick: (String) -> Unit, onMore: () -> Unit) {
  // One small pop in, on the layer: cheap, and it feels alive.
  val pop = remember { Animatable(0.6f) }
  LaunchedEffect(Unit) { pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow)) }
  Surface(
    shape = RoundedCornerShape(50),
    color = MaterialTheme.colorScheme.surfaceContainerHighest,
    shadowElevation = 8.dp,
    modifier = Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value; alpha = ((pop.value - 0.6f) / 0.4f).coerceIn(0f, 1f) },
  ) {
    Row(Modifier.padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
      QUICK_REACTIONS.forEach { e ->
        Box(
          Modifier
            .size(38.dp)
            .then(if (e in mine) Modifier.padding(2.dp) else Modifier)
            .clickable { onPick(e) },
          contentAlignment = Alignment.Center,
        ) {
          if (e in mine) Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(34.dp)) {}
          Text(e, fontSize = 22.sp)
        }
      }
      Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.size(34.dp).clickable(onClick = onMore)) {
        Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Add, contentDescription = "All emoji", Modifier.size(20.dp)) }
      }
    }
  }
}

/** Every emoji: Android's own picker (Jetpack emoji2), with recents and categories. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EmojiPickerSheet(onPick: (String) -> Unit, onDismiss: () -> Unit) {
  ModalBottomSheet(onDismissRequest = onDismiss) {
    AndroidView(
      factory = { ctx ->
        EmojiPickerView(ctx).apply {
          layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
          emojiGridColumns = 9
          setOnEmojiPickedListener { item -> onPick(item.emoji) }
        }
      },
      modifier = Modifier.fillMaxWidth().height(400.dp).padding(horizontal = 8.dp),
    )
  }
}
