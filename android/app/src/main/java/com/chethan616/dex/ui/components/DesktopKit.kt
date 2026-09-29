package com.chethan616.dex.ui.components

import androidx.compose.animation.AnimatedContent
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
 * Components carried over from the desktop app so the two feel like one
 * product: the liquid-metal send button (MetalFx "chromatic" circle), the
 * metal "New" badge, and the prompt bar itself (TaskInput) with its chips.
 */

/** The chromatic ramp metal-fx's "chromatic" preset runs around its ring. */
private val CHROMATIC = listOf(
  Color(0xFFF4F6FA), Color(0xFF9AA7BD), Color(0xFFE9EEF6), Color(0xFFB7C8E6),
  Color(0xFFFFD6EE), Color(0xFFCFE3FF), Color(0xFF8C98AE), Color(0xFFF4F6FA),
)

/**
 * The desktop's send button: a disc inside a slowly turning chromatic metal
 * ring, with a specular glint. It presses in with a spring and dims when
 * disabled. Busy shows an orb in place of the arrow.
 */
@Composable
fun MetalSendButton(
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  busy: Boolean = false,
  size: Dp = 44.dp,
) {
  val dark = LocalIsDark.current
  val spin by rememberInfiniteTransition(label = "metal").animateFloat(
    initialValue = 0f,
    targetValue = 360f,
    animationSpec = infiniteRepeatable(tween(if (enabled) 5200 else 12000, easing = LinearEasing), RepeatMode.Restart),
    label = "spin",
  )
  val interaction = remember { MutableInteractionSource() }
  val pressed by interaction.collectIsPressedAsState()
  val scale by animateFloatAsState(if (pressed) 0.9f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "press")
  val disc = if (dark) Color(0xFF1D1D1D) else Color.White
  val ink = if (dark) Color(0xFFF8F8F8) else Color(0xFF111111)

  Box(
    modifier
      .size(size)
      .scale(scale)
      .clip(CircleShape)
      .clickable(interactionSource = interaction, indication = null, enabled = enabled && !busy, onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Canvas(Modifier.fillMaxSize()) {
      val ring = this.size.minDimension * 0.09f
      rotate(spin) {
        drawCircle(Brush.sweepGradient(CHROMATIC), radius = this.size.minDimension / 2f)
      }
      drawCircle(disc, radius = this.size.minDimension / 2f - ring)
      // Soft inner glow + a glint in the upper left, like the MetalFx inner shadow.
      drawCircle(
        Brush.radialGradient(listOf(Color.White.copy(alpha = if (dark) 0.10f else 0.0f), Color.Transparent)),
        radius = this.size.minDimension / 2f - ring,
      )
      drawArc(
        color = Color.White.copy(alpha = 0.55f),
        startAngle = 200f,
        sweepAngle = 45f,
        useCenter = false,
        topLeft = Offset(ring * 0.5f, ring * 0.5f),
        size = androidx.compose.ui.geometry.Size(this.size.width - ring, this.size.height - ring),
        style = Stroke(width = ring * 0.45f),
      )
    }
    AnimatedContent(busy, transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.6f)) togetherWith fadeOut() }, label = "send") { isBusy ->
      if (isBusy) DexOrb(OrbState.Connecting, size = size * 0.55f)
      else Icon(
        Icons.Rounded.ArrowUpward,
        contentDescription = "Send",
        tint = ink.copy(alpha = if (enabled) 1f else 0.45f),
        modifier = Modifier.size(size * 0.42f),
      )
    }
  }
}

/** The metal "New" pill (desktop NewBadge / menu-new-pill): brushed silver with a passing sheen. */
@Composable
fun MetalNewBadge(label: String = "New", modifier: Modifier = Modifier) {
  val sheen by rememberInfiniteTransition(label = "sheen").animateFloat(
    initialValue = -1f,
    targetValue = 2f,
    animationSpec = infiniteRepeatable(tween(2800, easing = LinearEasing), RepeatMode.Restart),
    label = "x",
  )
  Box(
    modifier
      .clip(RoundedCornerShape(50))
      .background(Brush.verticalGradient(listOf(Color(0xFFFDFDFD), Color(0xFFD9DADE), Color(0xFFB9BBC1), Color(0xFFECEEF1))))
      .drawWithContent {
        drawContent()
        val w = size.width
        drawRect(
          Brush.linearGradient(
            listOf(Color.Transparent, Color.White.copy(alpha = 0.85f), Color.Transparent),
            start = Offset(sheen * w - w * 0.3f, 0f),
            end = Offset(sheen * w + w * 0.3f, size.height),
          ),
        )
      }
      .padding(horizontal = 8.dp, vertical = 2.dp),
  ) {
    Text(label, color = Color(0xFF2A2B2F), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
  }
}

/** A chip in the prompt bar's action row (desktop .task-input__plus / engine toggle). */
@Composable
private fun BarChip(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(50),
    color = MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = 0.6f),
    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
    modifier = modifier.heightIn(min = 36.dp),
  ) {
    Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center, content = content)
  }
}

private val ENGINE_BLURB = mapOf(
  "claude-code" to "Anthropic’s coding agent",
  "codex" to "OpenAI’s coding agent",
  "browsercode" to "DEX’s browser agent · any model",
  "opencode" to "Open-source coding agent",
)

/**
 * The desktop prompt bar: one card with the text area on top and, below it,
 * "+" and mic on the left, the engine and model chips and the metal send
 * button on the right. The engine menu is the desktop's: avatar, name,
 * one-line description, a check on the current one.
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
  placeholder: String = "Whats on your mind today?",
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

  fun send() {
    val prompt = text.trim()
    if ((prompt.isEmpty() && !hasFiles) || busy || attachments?.preparing == true) return
    haptics.send()
    onSend(prompt, engine?.id, model)
    text = ""
  }

  Surface(
    shape = RoundedCornerShape(28.dp),
    color = scheme.surfaceContainerLow,
    border = androidx.compose.foundation.BorderStroke(1.dp, scheme.outlineVariant.copy(alpha = 0.55f)),
    shadowElevation = if (LocalIsDark.current) 0.dp else 2.dp,
    modifier = modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(start = 18.dp, end = 12.dp, top = 16.dp, bottom = 12.dp)) {
      if (attachments != null) {
        com.chethan616.dex.ui.attach.AttachmentStrip(attachments, Modifier.padding(bottom = 10.dp))
      }
      BasicTextField(
        value = text,
        onValueChange = { text = it },
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface),
        cursorBrush = SolidColor(Color(0xFF1683FF)),
        maxLines = 6,
        modifier = Modifier.fillMaxWidth().heightIn(min = 28.dp),
        decorationBox = { inner ->
          Box {
            if (text.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = scheme.onSurfaceVariant.copy(alpha = 0.7f))
            inner()
          }
        },
      )
      Spacer(Modifier.height(12.dp))
      // Phone layout: [+] [agent ▾] ··· [mic] [send]. The model lives inside the
      // agent menu, so the row never outgrows a narrow screen.
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box {
          BarChip(
            onClick = { haptics.tick(); if (pickers != null) attachMenu = true else onMore() },
            modifier = Modifier.size(38.dp),
          ) {
            Icon(Icons.Rounded.Add, if (pickers != null) "Attach" else "More", Modifier.size(18.dp))
          }
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
          // The agent chip's box takes all the free space (so its name isn't
          // squeezed to "…"); the chip itself hugs its content on the left.
          Box(Modifier.weight(1f)) {
            BarChip(onClick = { haptics.tick(); engineMenu = true }) {
              BotAvatar(type = botTypeFor(engine.id), mood = BotMood.Idle, size = 20.dp, interactive = false)
              Spacer(Modifier.size(6.dp))
              Text(
                engine.name + (engine.models.firstOrNull { it.id == model }?.let { " · ${it.label}" } ?: ""),
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
              )
              Icon(Icons.Rounded.KeyboardArrowDown, null, Modifier.size(16.dp))
            }
            DropdownMenu(expanded = engineMenu, onDismissRequest = { engineMenu = false }, shape = RoundedCornerShape(20.dp)) {
              Text("Agent", style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
              engines.forEach { e ->
                DropdownMenuItem(
                  leadingIcon = { BotAvatar(type = botTypeFor(e.id), mood = if (e.id == engine.id) BotMood.Working else BotMood.Idle, size = 28.dp, interactive = false) },
                  text = {
                    Column(Modifier.widthIn(min = 180.dp)) {
                      Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(e.name, style = MaterialTheme.typography.titleSmall)
                        if (e.id == "browsercode") { Spacer(Modifier.size(6.dp)); MetalNewBadge() }
                      }
                      Text(ENGINE_BLURB[e.id] ?: "", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                  },
                  trailingIcon = { if (e.id == engine.id) Icon(Icons.Rounded.Check, null) },
                  onClick = { haptics.tick(); engineId = e.id; model = null; engineMenu = false },
                )
              }
              if (engine.models.isNotEmpty()) {
                androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 6.dp))
                Text("Model", style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                DropdownMenuItem(
                  text = { Column { Text("Default", style = MaterialTheme.typography.titleSmall); Text("Engine’s own choice", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant) } },
                  trailingIcon = { if (model == null) Icon(Icons.Rounded.Check, null) },
                  onClick = { haptics.tick(); model = null; engineMenu = false },
                )
                engine.models.forEach { m ->
                  DropdownMenuItem(
                    text = { Text(m.label, style = MaterialTheme.typography.titleSmall) },
                    trailingIcon = { if (model == m.id) Icon(Icons.Rounded.Check, null) },
                    onClick = { haptics.tick(); model = m.id; engineMenu = false },
                  )
                }
              }
            }
          }
        }
        if (engine == null) Spacer(Modifier.weight(1f)) else Spacer(Modifier.size(8.dp))
        androidx.compose.material3.IconButton(onClick = onVoice, modifier = Modifier.size(40.dp)) {
          Icon(Icons.Rounded.Mic, "Speak", tint = scheme.onSurfaceVariant)
        }
        Spacer(Modifier.size(4.dp))
        MetalSendButton(onClick = ::send, enabled = (text.isNotBlank() || hasFiles) && attachments?.preparing != true, busy = busy)
      }
      if (status != null) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(14.dp).rotate(0f), tint = scheme.onSurfaceVariant)
          Spacer(Modifier.size(6.dp))
          Text(status, style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
        }
      }
    }
  }
}
