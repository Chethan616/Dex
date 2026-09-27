package com.chethan616.dex.ui.screens.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.ToggleButtonDefaults
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
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.avatar.botTypeFor
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.orb.DexOrb
import com.jakubantalik.thinkingorbs.OrbState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

internal val FALLBACK_ENGINES = listOf(
  Engine("claude-code", "Claude Code", emptyList()),
  Engine("codex", "Codex", emptyList()),
  Engine("browsercode", "BrowserCode", emptyList()),
)

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
) {
  val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  val haptics = LocalHaptics.current
  val scope = rememberCoroutineScope()
  val engines = desktop?.engines?.takeIf { it.isNotEmpty() } ?: FALLBACK_ENGINES
  var text by remember(prefill) { mutableStateOf(prefill) }
  var engine by remember { mutableStateOf(engines.firstOrNull { it.id == lastEngine } ?: engines.first()) }
  var model by remember(engine) { mutableStateOf<String?>(null) }
  var modelMenu by remember { mutableStateOf(false) }
  var state by remember { mutableStateOf<SendState>(SendState.Idle) }
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

  fun submit() {
    val prompt = text.trim()
    if (prompt.isEmpty() || state is SendState.Sending) return
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
    Column(
      Modifier
        .fillMaxWidth()
        .padding(horizontal = 20.dp)
        .navigationBarsPadding()
        .imePadding(),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text("New task", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.secondaryContainer) {
          Text(
            desktop?.name ?: "No PC yet",
            Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelLarge,
          )
        }
      }

      OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        placeholder = { Text("What should DEX do on your PC?") },
        shape = RoundedCornerShape(24.dp),
        minLines = 3,
        maxLines = 8,
        trailingIcon = {
          IconButton(onClick = onVoice) { Icon(Icons.Rounded.Mic, "Speak") }
        },
        modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp).focusRequester(focus),
      )

      Text("Agent", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Row(horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween), modifier = Modifier.fillMaxWidth()) {
        engines.forEachIndexed { i, e ->
          ToggleButton(
            checked = engine.id == e.id,
            onCheckedChange = { haptics.tick(); engine = e },
            shapes = when (i) {
              0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
              engines.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
              else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
            },
            modifier = Modifier.weight(1f).semantics { role = Role.RadioButton },
          ) {
            BotAvatar(type = botTypeFor(e.id, e.id), mood = if (engine.id == e.id) BotMood.Working else BotMood.Idle, size = 22.dp, interactive = false)
            Spacer(Modifier.size(ToggleButtonDefaults.IconSpacing))
            Text(e.name, maxLines = 1)
          }
        }
      }

      if (engine.models.isNotEmpty()) {
        Box {
          TextButton(onClick = { haptics.tick(); modelMenu = true }) {
            Icon(Icons.Rounded.Tune, null, Modifier.size(18.dp))
            Spacer(Modifier.size(8.dp))
            Text("Model: " + (engine.models.firstOrNull { it.id == model }?.label ?: "Default"))
          }
          DropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }, shape = RoundedCornerShape(20.dp)) {
            DropdownMenuItem(text = { Text("Default") }, onClick = { model = null; modelMenu = false; haptics.tick() })
            engine.models.forEach { m ->
              DropdownMenuItem(text = { Text(m.label) }, onClick = { model = m.id; modelMenu = false; haptics.tick() })
            }
          }
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
            DexOrb(OrbState.Connecting, size = 40.dp)
            Spacer(Modifier.size(12.dp))
            Text(s.label, style = MaterialTheme.typography.bodyLarge)
          }
          else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (s is SendState.Failed) {
              Text(s.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Button(
              onClick = ::submit,
              enabled = text.isNotBlank(),
              shapes = ButtonDefaults.shapes(),
              modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp),
            ) {
              Icon(Icons.AutoMirrored.Rounded.Send, null)
              Spacer(Modifier.size(10.dp))
              Text("Start on ${desktop?.name ?: "PC"}", style = MaterialTheme.typography.titleMedium)
            }
          }
        }
      }
      Spacer(Modifier.size(8.dp))
    }
  }
}
