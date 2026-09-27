package com.chethan616.dex.ui.profile

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.DexProfile
import com.chethan616.dex.ui.avatar.BOT_TYPES
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.haptics.LocalHaptics
import kotlinx.coroutines.launch

/** Same swatches as the desktop picker (components/lib/DexProfile.tsx); null = the bot's own colour. */
val DEX_COLORS: List<String?> = listOf(
  null, "#35B8FF", "#2FCB7A", "#9A62FF", "#DC48FF", "#FF5C8A", "#FF8C42", "#FFD32B", "#1ED3C6", "#95A6C4",
)

/** Your DEX, for anything below the signed-in root. */
val LocalDexProfile = compositionLocalOf<DexProfile?> { null }

/** A stable random bot for an account that hasn't chosen yet. */
fun defaultProfileFor(seed: String): DexProfile {
  var h = 2166136261L
  for (c in seed) { h = h xor c.code.toLong(); h = (h * 16777619L) and 0xFFFFFFFFL }
  return DexProfile(bot = BOT_TYPES[(h % BOT_TYPES.size).toInt()], color = null, name = null, updatedAt = 0)
}

fun parseHex(hex: String?): Color? = hex?.removePrefix("#")?.toLongOrNull(16)?.let { Color(0xFF000000 or it) }

/** Your DEX's face — the chosen bot and colour, wherever it appears. */
@Composable
fun DexAvatar(size: Dp, modifier: Modifier = Modifier, mood: BotMood = BotMood.Idle, interactive: Boolean = true) {
  val profile = LocalDexProfile.current
  BotAvatar(
    type = profile?.bot ?: "flower",
    mood = mood,
    size = size,
    modifier = modifier,
    interactive = interactive,
    label = profile?.name ?: "DEX",
    color = parseHex(profile?.color),
  )
}

/**
 * Pick your DEX: the chosen bot big at the top with its name, every bot in a
 * grid (the chosen one lifts, rings and hops), colour swatches, and Shuffle.
 */
@Composable
fun ProfilePicker(
  initial: DexProfile,
  saveLabel: String,
  onSave: suspend (bot: String, color: String?, name: String?) -> Unit,
  onCancel: (() -> Unit)? = null,
  /**
   * In a bottom sheet: the avatars and colours scroll on their own and
   * Shuffle / Cancel / Save stay pinned above the navigation bar. As one
   * long scroll the buttons ended up under the nav bar and the scroll fought
   * the sheet's own drag (flicker, and taps lost after a swipe).
   */
  pinActions: Boolean = false,
) {
  val haptics = LocalHaptics.current
  val scope = rememberCoroutineScope()
  var bot by rememberSaveable { mutableStateOf(initial.bot) }
  var color by rememberSaveable { mutableStateOf(initial.color) }
  var name by rememberSaveable { mutableStateOf(initial.name ?: "") }
  var saving by remember { mutableStateOf(false) }
  val scheme = MaterialTheme.colorScheme

  Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
  Column(
    if (pinActions) Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()) else Modifier,
    verticalArrangement = Arrangement.spacedBy(18.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      BotAvatar(type = bot, mood = BotMood.Idle, size = 104.dp, color = parseHex(color), label = name.ifBlank { "DEX" })
      Spacer(Modifier.size(16.dp))
      OutlinedTextField(
        value = name,
        onValueChange = { name = it.take(32) },
        label = { Text("Name your DEX") },
        singleLine = true,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.weight(1f),
      )
    }

    // 4-wide grid of every bot.
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
      BOT_TYPES.chunked(4).forEach { row ->
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          row.forEach { type ->
            BotTile(
              type = type,
              selected = type == bot,
              color = if (type == bot) parseHex(color) else null,
              modifier = Modifier.weight(1f),
            ) { haptics.tick(); bot = type }
          }
          repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
        }
      }
    }

    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      items(DEX_COLORS) { c ->
        val selected = c == color
        val ring by animateDpAsState(if (selected) 3.dp else 0.dp, label = "ring")
        Box(
          Modifier
            .size(36.dp)
            .border(ring, scheme.onSurface, CircleShape)
            .padding(if (selected) 5.dp else 0.dp)
            .background(
              if (c == null) Brush.sweepGradient(listOf(Color(0xFF35B8FF), Color(0xFF2FCB7A), Color(0xFFFFD32B), Color(0xFFFF8C42), Color(0xFFFF5C8A), Color(0xFF9A62FF), Color(0xFF35B8FF)))
              else Brush.linearGradient(listOf(parseHex(c)!!, parseHex(c)!!)),
              CircleShape,
            )
            .clickable { haptics.tick(); color = c },
        )
      }
    }

  }

    Row(
      if (pinActions) Modifier.navigationBarsPadding().padding(bottom = 8.dp) else Modifier,
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      FilledTonalButton(
        onClick = {
          haptics.hop()
          bot = BOT_TYPES.random()
          color = DEX_COLORS.random()
        },
        shapes = ButtonDefaults.shapes(),
      ) {
        Icon(Icons.Rounded.Casino, null, Modifier.size(18.dp))
        Spacer(Modifier.size(8.dp))
        Text("Shuffle")
      }
      Spacer(Modifier.weight(1f))
      if (onCancel != null) TextButton(onClick = onCancel) { Text("Cancel") }
      Button(
        onClick = {
          if (saving) return@Button
          saving = true
          haptics.success()
          scope.launch { try { onSave(bot, color, name) } finally { saving = false } }
        },
        shapes = ButtonDefaults.shapes(),
      ) {
        if (saving) LoadingIndicator(Modifier.size(22.dp), color = scheme.onPrimary) else Text(saveLabel)
      }
    }
  }
}

@Composable
private fun BotTile(type: String, selected: Boolean, color: Color?, modifier: Modifier, onClick: () -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val scale by animateFloatAsState(if (selected) 1.06f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "lift")
  val corner by animateDpAsState(if (selected) 28.dp else 20.dp, label = "corner")
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(corner),
    color = if (selected) scheme.primaryContainer else scheme.surfaceContainerHigh,
    border = if (selected) androidx.compose.foundation.BorderStroke(2.dp, scheme.primary) else null,
    modifier = modifier.aspectRatio(1f).scale(scale),
  ) {
    Box(contentAlignment = Alignment.Center) {
      BotAvatar(type = type, mood = if (selected) BotMood.Working else BotMood.Idle, size = 52.dp, interactive = false, color = color)
    }
  }
}

/** The Netflix-style first-run step: shown once, right after signing in. */
@Composable
fun PickYourDexScreen(initial: DexProfile, onSave: suspend (bot: String, color: String?, name: String?) -> Unit) {
  Surface(Modifier.fillMaxSize()) {
    Column(
      Modifier
        .fillMaxSize()
        .statusBarsPadding()
        .navigationBarsPadding()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
      Text("Pick your DEX", style = MaterialTheme.typography.displaySmall, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
      Spacer(Modifier.height(8.dp))
      Text(
        "This bot is you — here and in DEX on your PC. You can change it any time in Settings.",
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
      )
      Spacer(Modifier.height(24.dp))
      ProfilePicker(initial = initial, saveLabel = "Continue", onSave = onSave)
    }
  }
}
