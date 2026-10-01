package com.chethan616.dex.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chethan616.dex.data.Engine
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.avatar.botTypeFor
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.orb.DexOrb
import com.chethan616.dex.ui.theme.LocalIsDark
import com.jakubantalik.thinkingorbs.OrbState

/*
 * The prompt bar: the phone's version of the desktop's TaskInput, in
 * Material 3 Expressive. Its send button and agent picker are their own
 * components (SendButton.kt, AgentPicker.kt). Everything here moves only when
 * you touch it: the bar glows while you type, "+" turns into "×" while its
 * menu is open, the agent's chevron flips, a new agent's bot pops in.
 */

/**
 * "+": attach (or more). A tonal button that changes shape under a finger
 * (M3 Expressive) and turns 45° into a "×" while its menu is open.
 */
@Composable
fun PromptPlusButton(open: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, size: Dp = 44.dp) {
  val turn by animateFloatAsState(if (open) 45f else 0f, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMedium), label = "plus")
  androidx.compose.material3.FilledTonalIconButton(
    onClick = onClick,
    enabled = enabled,
    shapes = androidx.compose.material3.IconButtonDefaults.shapes(),
    colors = androidx.compose.material3.IconButtonDefaults.filledTonalIconButtonColors(
      containerColor = MaterialTheme.colorScheme.secondaryContainer,
      contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    ),
    modifier = modifier.size(size),
  ) {
    Icon(Icons.Rounded.Add, if (open) "Close" else "Attach", Modifier.size(22.dp).graphicsLayer { rotationZ = turn })
  }
}

/** The mic: speak instead of typing. A tertiary tonal button that changes shape under a finger. */
@Composable
fun PromptMicButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, size: Dp = 44.dp) {
  androidx.compose.material3.FilledTonalIconButton(
    onClick = onClick,
    enabled = enabled,
    shapes = androidx.compose.material3.IconButtonDefaults.shapes(),
    colors = androidx.compose.material3.IconButtonDefaults.filledTonalIconButtonColors(
      containerColor = MaterialTheme.colorScheme.tertiaryContainer,
      contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
    ),
    modifier = modifier.size(size),
  ) {
    Icon(Icons.Rounded.Mic, "Speak", Modifier.size(22.dp))
  }
}

/**
 * The agent chip: the agent's bot and name (and model, once picked) on a
 * filled pill. It squishes under a finger, the chevron flips while the picker
 * is open, and picking another agent pops its bot in.
 */
@Composable
private fun AgentChip(engine: Engine, modelLabel: String?, open: Boolean, onClick: () -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val press = remember { MutableInteractionSource() }
  val flip by animateFloatAsState(if (open) 180f else 0f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMedium), label = "chevron")
  val pop = remember { androidx.compose.animation.core.Animatable(1f) }
  var shownEngine by remember { mutableStateOf(engine.id) }
  androidx.compose.runtime.LaunchedEffect(engine.id) {
    if (engine.id == shownEngine) return@LaunchedEffect
    shownEngine = engine.id
    pop.snapTo(0.55f)
    pop.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMedium))
  }
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(50),
    color = scheme.primaryContainer,
    contentColor = scheme.onPrimaryContainer,
    interactionSource = press,
    modifier = Modifier.heightIn(min = 44.dp).springPress(press, 0.94f),
  ) {
    Row(Modifier.padding(start = 6.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
      // The bot sits on a little disc, like a sticker on the chip.
      Box(
        Modifier.size(32.dp).background(scheme.surface.copy(alpha = 0.55f), CircleShape).graphicsLayer { scaleX = pop.value; scaleY = pop.value },
        contentAlignment = Alignment.Center,
      ) {
        BotAvatar(type = botTypeFor(engine.id), mood = BotMood.Idle, size = 26.dp, interactive = false, still = true)
      }
      Spacer(Modifier.size(8.dp))
      Text(
        engine.name + (modelLabel?.let { " · $it" } ?: ""),
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.weight(1f, fill = false),
      )
      Spacer(Modifier.size(2.dp))
      Icon(Icons.Rounded.KeyboardArrowDown, null, Modifier.size(20.dp).graphicsLayer { rotationZ = flip })
    }
  }
}

/**
 * The prompt bar: one card with the text area on top and, below it, "+",
 * the agent chip, then mic and the send button. The agent chip opens a
 * compact picker (AgentPicker.kt): the agents in one row, that agent's
 * models as chips.
 */
@Composable
fun PromptBar(
  engines: List<Engine>,
  initialEngine: String?,
  busy: Boolean,
  status: String?,
  onSend: (prompt: String, engine: String?, model: String?) -> Unit,
  onVoice: () -> Unit,
  onMore: () -> Unit,
  modifier: Modifier = Modifier,
  placeholder: String = "What’s on your mind today?",
  /** Photos/files for the task; "+" opens Photos · Camera · Files · More options. */
  attachments: com.chethan616.dex.ui.attach.AttachmentState? = null,
  pickers: com.chethan616.dex.ui.attach.AttachPickers? = null,
) {
  val haptics = LocalHaptics.current
  val scheme = MaterialTheme.colorScheme
  var text by rememberSaveable { mutableStateOf("") }
  var attachMenu by remember { mutableStateOf(false) }
  val hasFiles = (attachments?.items?.size ?: 0) > 0
  var engineId by rememberSaveable { mutableStateOf(initialEngine ?: engines.firstOrNull()?.id) }
  var model by rememberSaveable { mutableStateOf<String?>(null) }
  var engineMenu by remember { mutableStateOf(false) }
  val engine = engines.firstOrNull { it.id == engineId } ?: engines.firstOrNull()
  var focused by remember { mutableStateOf(false) }

  fun send() {
    val prompt = text.trim()
    if ((prompt.isEmpty() && !hasFiles) || busy || attachments?.preparing == true) return
    haptics.send()
    onSend(prompt, engine?.id, model)
    text = ""
  }

  // While you type, the bar glows in your colour (two colour fades, not a frame loop).
  val container by animateColorAsState(if (focused) scheme.surfaceContainer else scheme.surfaceContainerLow, label = "bar")
  val edge by animateColorAsState(if (focused) scheme.primary.copy(alpha = 0.7f) else scheme.outlineVariant.copy(alpha = 0.35f), label = "edge")
  Surface(
    shape = RoundedCornerShape(32.dp),
    color = container,
    border = androidx.compose.foundation.BorderStroke(if (focused) 2.dp else 1.dp, edge),
    shadowElevation = if (LocalIsDark.current) 0.dp else 3.dp,
    modifier = modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 12.dp)) {
      if (attachments != null) {
        com.chethan616.dex.ui.attach.AttachmentStrip(attachments, Modifier.padding(bottom = 10.dp))
      }
      BasicTextField(
        value = text,
        onValueChange = { text = it },
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface),
        cursorBrush = SolidColor(scheme.primary),
        maxLines = 6,
        modifier = Modifier.fillMaxWidth().heightIn(min = 28.dp).onFocusChanged { focused = it.isFocused },
        decorationBox = { inner ->
          Box {
            if (text.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = scheme.onSurfaceVariant.copy(alpha = 0.75f))
            inner()
          }
        },
      )
      Spacer(Modifier.height(14.dp))
      // Phone layout: [+] [agent ▾] ··· [mic] [send]. The model lives inside the
      // agent menu, so the row never outgrows a narrow screen.
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box {
          PromptPlusButton(open = attachMenu, onClick = { haptics.tick(); if (pickers != null) attachMenu = !attachMenu else onMore() })
          if (pickers != null) {
            com.chethan616.dex.ui.attach.AttachMenu(
              expanded = attachMenu,
              onDismiss = { attachMenu = false },
              pickers = pickers,
              extraLabel = "More options",
              onExtra = onMore,
            )
          }
        }
        Spacer(Modifier.size(8.dp))
        if (engine != null) {
          // The chip's box takes the free space (so the name isn't squeezed to
          // "…"); the chip itself hugs its content on the left.
          Box(Modifier.weight(1f)) {
            AgentChip(engine, engine.models.firstOrNull { it.id == model }?.label, open = engineMenu) { haptics.tick(); engineMenu = true }
            AgentPickerMenu(
              expanded = engineMenu,
              onDismiss = { engineMenu = false },
              engines = engines,
              engine = engine,
              model = model,
              onEngine = { engineId = it.id; model = null },
              onModel = { model = it },
            )
          }
        }
        if (engine == null) Spacer(Modifier.weight(1f)) else Spacer(Modifier.size(8.dp))
        PromptMicButton(onClick = onVoice)
        Spacer(Modifier.size(8.dp))
        ExpressiveSendButton(onClick = ::send, enabled = (text.isNotBlank() || hasFiles) && attachments?.preparing != true, busy = busy, size = 44.dp)
      }
      if (status != null) {
        Spacer(Modifier.height(10.dp))
        Surface(shape = RoundedCornerShape(50), color = scheme.secondaryContainer.copy(alpha = 0.7f), contentColor = scheme.onSecondaryContainer) {
          Row(Modifier.padding(start = 6.dp, end = 12.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (busy) androidx.compose.material3.LoadingIndicator(Modifier.size(22.dp))
            else Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.padding(horizontal = 3.dp).size(16.dp))
            Spacer(Modifier.size(6.dp))
            Text(status, style = MaterialTheme.typography.labelLarge)
          }
        }
      }
    }
  }
}
