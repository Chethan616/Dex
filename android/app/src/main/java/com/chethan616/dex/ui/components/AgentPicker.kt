package com.chethan616.dex.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.Engine
import com.chethan616.dex.data.shortName
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.avatar.botTypeFor
import com.chethan616.dex.ui.haptics.LocalHaptics

/**
 * The agents as one connected button group: each with its bot, the chosen
 * one hopping. Three fit across a phone.
 */
@Composable
fun AgentToggleRow(engines: List<Engine>, selectedId: String?, onSelect: (Engine) -> Unit, modifier: Modifier = Modifier) {
  val haptics = LocalHaptics.current
  Row(horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween), modifier = modifier) {
    engines.forEachIndexed { i, e ->
      val on = e.id == selectedId
      ToggleButton(
        checked = on,
        onCheckedChange = { haptics.tick(); onSelect(e) },
        shapes = when (i) {
          0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
          engines.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
          else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
        },
        // Three across a phone: the default padding leaves "Claude" clipped.
        contentPadding = PaddingValues(horizontal = 8.dp),
        modifier = Modifier.weight(1f).semantics { role = Role.RadioButton },
      ) {
        BotAvatar(type = botTypeFor(e.id), mood = if (on) BotMood.Working else BotMood.Idle, size = 18.dp, interactive = false)
        Spacer(Modifier.size(4.dp))
        // labelLarge: "Browser" fits a third of a 312dp picker on a narrow phone.
        Text(e.shortName, style = MaterialTheme.typography.labelLarge, maxLines = 1, softWrap = false)
      }
    }
  }
}

/**
 * An agent's models as chips that wrap, "Default" first, in a short area
 * that scrolls if there are many — never a list taller than the screen.
 * Switching agent swaps the chips with a little slide.
 */
@Composable
fun ModelChips(engine: Engine, model: String?, onPick: (String?) -> Unit, maxHeight: Dp = 156.dp, modifier: Modifier = Modifier) {
  val haptics = LocalHaptics.current
  val motion = MaterialTheme.motionScheme
  AnimatedContent(
    targetState = engine,
    contentKey = { it.id },
    transitionSpec = {
      (slideInHorizontally(motion.fastSpatialSpec()) { it / 6 } + fadeIn(motion.fastEffectsSpec()) + scaleIn(motion.fastSpatialSpec(), initialScale = 0.96f)) togetherWith
        fadeOut(motion.fastEffectsSpec())
    },
    label = "models",
    modifier = modifier,
  ) { e ->
    FlowRow(
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalArrangement = Arrangement.spacedBy(0.dp),
      modifier = Modifier.heightIn(max = maxHeight).verticalScroll(rememberScrollState()),
    ) {
      val options = listOf<Pair<String?, String>>(null to "Default") + e.models.map { it.id to it.label }
      options.forEach { (id, label) ->
        val on = id == model
        FilterChip(
          selected = on,
          onClick = { haptics.tick(); onPick(id) },
          label = { Text(label, maxLines = 1) },
          leadingIcon = if (on) {
            { Icon(Icons.Rounded.Check, null, Modifier.size(FilterChipDefaults.IconSize)) }
          } else null,
          shape = RoundedCornerShape(50),
        )
      }
    }
  }
}

/**
 * The prompt bar's agent picker: a compact card under the chip — the agents
 * in one row, then that agent's models as chips. Picking an agent keeps it
 * open (you may want a model next); picking a model closes it.
 */
@Composable
fun AgentPickerMenu(
  expanded: Boolean,
  onDismiss: () -> Unit,
  engines: List<Engine>,
  engine: Engine,
  model: String?,
  onEngine: (Engine) -> Unit,
  onModel: (String?) -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  DropdownMenu(
    expanded = expanded,
    onDismissRequest = onDismiss,
    shape = RoundedCornerShape(28.dp),
    containerColor = scheme.surfaceContainerHigh,
  ) {
    Column(Modifier.width(312.dp).padding(horizontal = 14.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text("Agent", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant)
      AgentToggleRow(engines, engine.id, onSelect = onEngine)
      if (engine.models.isNotEmpty()) {
        Text("Model", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant)
        ModelChips(engine, model, onPick = { onModel(it); onDismiss() })
      }
    }
  }
}
