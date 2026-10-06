package com.chethan616.dex.ui.screens.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.CommandState
import com.chethan616.dex.data.Device
import com.chethan616.dex.data.Engine
import com.chethan616.dex.data.shortName
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.avatar.botTypeFor
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.orb.DexOrb
import com.jakubantalik.thinkingorbs.OrbState
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.sp
import com.chethan616.dex.ui.theme.LocalStatusColors
import com.chethan616.dex.ui.theme.Space
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

internal val FALLBACK_ENGINES = listOf(
  Engine("claude-code", "Claude Code", emptyList()),
  Engine("codex", "Codex", emptyList()),
  Engine("browsercode", "BrowserCode", emptyList()),
)

/** The task's words, the same size as Home's prompt. */
private val TaskText = androidx.compose.ui.text.TextStyle(fontSize = 17.sp, lineHeight = 24.sp)

private sealed interface SendState {
  data object Idle : SendState
  data class Sending(val label: String) : SendState
  data class Failed(val error: String) : SendState
}

@Composable
fun NewTaskSheet(
  prefill: String,
  desktop: Device?,
  lastEngine: String?,
  send: (String, String?, String?) -> Flow<CommandState>,
  onDismiss: () -> Unit,
  onStarted: (String) -> Unit,
  onVoice: () -> Unit,
  attachments: com.chethan616.dex.ui.attach.AttachmentState? = null,
  pickers: com.chethan616.dex.ui.attach.AttachPickers? = null,
  /** Shared in from another app: offer instructions that fit it. */
  shared: com.chethan616.dex.share.SharedContent? = null,
) {
  val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  val haptics = LocalHaptics.current
  val scope = rememberCoroutineScope()
  val engines = desktop?.engines?.takeIf { it.isNotEmpty() } ?: FALLBACK_ENGINES
  var text by remember(prefill) { mutableStateOf(prefill) }
  var engine by remember { mutableStateOf(engines.firstOrNull { it.id == lastEngine } ?: engines.first()) }
  var model by remember(engine) { mutableStateOf<String?>(null) }
  var state by remember { mutableStateOf<SendState>(SendState.Idle) }
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

  val hasFiles = (attachments?.items?.size ?: 0) > 0
  var attachMenu by remember { mutableStateOf(false) }

  fun submit() {
    val prompt = text.trim()
    if ((prompt.isEmpty() && !hasFiles) || state is SendState.Sending || attachments?.preparing == true) return
    haptics.send()
    val pcName = desktop?.name ?: "your PC"
    state = SendState.Sending(if (desktop?.isReachable == true) "Sending to $pcName…" else "Queued — $pcName is offline, it’ll start when it’s back")
    scope.launch {
      send(prompt, engine.id, model).collect { cmd ->
        when (cmd) {
          CommandState.Pending -> Unit
          CommandState.Running -> state = SendState.Sending("Starting on ${desktop?.name ?: "your PC"}…")
          is CommandState.Done -> {
            val id = cmd.result["sessionId"] as? String
            val err = cmd.result["error"] as? String
            if (id != null) { haptics.success(); onStarted(id) }
            else { haptics.reject(); state = SendState.Failed(err ?: "Your PC couldn’t start that.") }
          }
          is CommandState.Failed -> { haptics.reject(); state = SendState.Failed(cmd.error) }
        }
      }
    }
  }

  ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, shape = RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp)) {
    val scheme = MaterialTheme.colorScheme
    Column(
      Modifier
        .fillMaxWidth()
        .padding(horizontal = 20.dp)
        .navigationBarsPadding()
        .imePadding(),
      verticalArrangement = Arrangement.spacedBy(Space.l),
    ) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        // Your DEX listens as you type: awake, then thinking about it, then off it goes.
        com.chethan616.dex.ui.profile.DexAvatar(
          size = 44.dp,
          mood = when {
            state is SendState.Sending -> com.chethan616.dex.ui.avatar.BotMood.Working
            state is SendState.Failed -> com.chethan616.dex.ui.avatar.BotMood.Sad
            text.isNotBlank() -> com.chethan616.dex.ui.avatar.BotMood.Thinking
            else -> com.chethan616.dex.ui.avatar.BotMood.Idle
          },
        )
        Spacer(Modifier.size(10.dp))
        Text("New task", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
        // Which PC it goes to, and whether it's there right now.
        val status = LocalStatusColors.current
        Surface(shape = CircleShape, color = scheme.secondaryContainer, contentColor = scheme.onSecondaryContainer) {
          Row(Modifier.padding(start = 10.dp, end = 12.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(if (desktop?.isReachable == true) status.running else status.idle, CircleShape))
            Spacer(Modifier.size(6.dp))
            Text(desktop?.name ?: "No PC yet", style = MaterialTheme.typography.labelLarge, maxLines = 1)
          }
        }
      }

      if (shared != null) {
        // One tap turns what was shared into an instruction.
        androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          items(shared.quickActions().size) { i ->
            val action = shared.quickActions()[i]
            androidx.compose.material3.SuggestionChip(
              onClick = {
                haptics.tick()
                val body = shared.text?.takeIf { !it.startsWith(action) }
                text = if (body != null) "$action\n\n$body" else action
              },
              label = { Text(action) },
              shape = RoundedCornerShape(50),
            )
          }
        }
      }

      if (attachments != null) com.chethan616.dex.ui.attach.AttachmentStrip(attachments)

      Surface(shape = MaterialTheme.shapes.large, color = scheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 18.dp, end = 10.dp, top = 16.dp, bottom = 10.dp)) {
          BasicTextField(
            value = text,
            onValueChange = { text = it },
            textStyle = TaskText.copy(color = scheme.onSurface),
            cursorBrush = SolidColor(scheme.primary),
            maxLines = 8,
            modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).focusRequester(focus),
            decorationBox = { inner ->
              Box {
                if (text.isEmpty()) {
                  Text(
                    if (hasFiles) "What should DEX do with this?" else "What should DEX do on your PC?",
                    style = TaskText,
                    color = scheme.onSurfaceVariant.copy(alpha = 0.75f),
                  )
                }
                inner()
              }
            },
          )
          Spacer(Modifier.size(Space.s))
          Row(verticalAlignment = Alignment.CenterVertically) {
            if (pickers != null) {
              Box {
                com.chethan616.dex.ui.components.PromptPlusButton(open = attachMenu, onClick = { haptics.tick(); attachMenu = !attachMenu })
                com.chethan616.dex.ui.attach.AttachMenu(expanded = attachMenu, onDismiss = { attachMenu = false }, pickers = pickers)
              }
              Spacer(Modifier.size(Space.s))
            }
            com.chethan616.dex.ui.components.PromptMicButton(onClick = onVoice)
          }
        }
      }

      // A label sits close to its control; groups sit apart.
      Column(verticalArrangement = Arrangement.spacedBy(Space.s)) {
        Text("Agent", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant)
        com.chethan616.dex.ui.components.AgentToggleRow(engines, engine.id, onSelect = { engine = it }, modifier = Modifier.fillMaxWidth())
      }

      if (engine.models.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(Space.s)) {
          Text("Model", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant)
          com.chethan616.dex.ui.components.ModelChips(engine, model, onPick = { model = it }, maxHeight = 120.dp)
        }
      }

      AnimatedContent(
        targetState = state,
        transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.92f)) togetherWith fadeOut() },
        label = "send",
      ) { s ->
        when (s) {
          is SendState.Sending -> Row(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
          ) {
            androidx.compose.material3.LoadingIndicator(Modifier.size(44.dp))
            Spacer(Modifier.size(12.dp))
            Text(s.label, style = MaterialTheme.typography.bodyLarge)
          }
          else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (s is SendState.Failed) {
              Text(s.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            // The button says what will happen: start now, queue for later,
            // or (disabled) what's missing — never just a grey bar.
            val ready = (text.isNotBlank() || hasFiles) && attachments?.preparing != true
            val pc = desktop?.name ?: "your PC"
            Button(
              onClick = ::submit,
              enabled = ready,
              shapes = ButtonDefaults.shapes(),
              modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp),
            ) {
              if (ready) {
                Icon(Icons.AutoMirrored.Rounded.Send, null)
                Spacer(Modifier.size(10.dp))
              }
              Text(
                when {
                  attachments?.preparing == true -> "Getting your files ready…"
                  !ready -> "Write the task first"
                  desktop?.isReachable == true -> "Start on $pc"
                  else -> "Queue for $pc"
                },
                style = MaterialTheme.typography.titleMedium,
              )
            }
            if (ready && desktop != null && !desktop.isReachable) {
              Text(
                "${desktop.name} is offline. DEX starts this the moment it's back.",
                style = MaterialTheme.typography.bodySmall,
                color = scheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
              )
            }
          }
        }
      }
      Spacer(Modifier.size(8.dp))
    }
  }
}
