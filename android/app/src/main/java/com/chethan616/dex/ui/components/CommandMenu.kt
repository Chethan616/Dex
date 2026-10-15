package com.chethan616.dex.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountTree
import androidx.compose.material.icons.rounded.AddToDrive
import androidx.compose.material.icons.rounded.AlternateEmail
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.BugReport
import androidx.compose.material.icons.rounded.TravelExplore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.CommandSpec
import com.chethan616.dex.data.MentionSpec
import com.chethan616.dex.ui.haptics.LocalHaptics

/**
 * The `/` and `@` menus of the phone's text boxes (Home's prompt bar, the
 * new-task sheet, a task's composer), like the desktop's: type `/` for a
 * command, `@` for a mention, and pick one. The list is the PC's own (its
 * device row, bridge.ts publishDevice), so the phone offers exactly what that
 * DEX understands; these defaults stand in for a PC that doesn't say.
 */
data class DexCommands(val commands: List<CommandSpec>, val mentions: List<MentionSpec>)

val DEFAULT_COMMANDS = DexCommands(
  commands = listOf(
    CommandSpec("workflow", "Routines", "/workflow [what to do]", "Your saved workflows and routines — view, run, or say what to make or change.", false),
    CommandSpec("scrape", "Map a site", "/scrape <url>", "Map a site into memory — its pages, navigation, and where each control lives.", true),
    CommandSpec("bugbounty", "Security check", "/bugbounty <url>", "Authorized vulnerability assessment — exploitable bugs with evidence, not a header checklist.", true),
  ),
  mentions = listOf(MentionSpec("drive", "@drive", "Also search Google Drive alongside this PC.")),
)

val LocalDexCommands = compositionLocalOf { DEFAULT_COMMANDS }

/** The command word being typed after a leading `/`, or null once there's a space (or no slash). */
internal fun commandQuery(text: String): String? {
  val t = text.trimStart()
  if (!t.startsWith("/") || t.any { it.isWhitespace() }) return null
  return t.drop(1).lowercase()
}

/** The partial word after an `@` at the end of the text ("find it @dr" → "dr"); never an email's `@`. */
internal fun mentionQuery(text: String): String? = Regex("""(?:^|\s)@([A-Za-z]*)$""").find(text)?.groupValues?.get(1)?.lowercase()

/** The text with the command chosen: "/workflow ". */
internal fun withCommand(name: String): String = "/$name "

/** The text with the `@partial` at its end replaced by the mention: "find it @drive ". */
internal fun withMention(text: String, name: String): String = text.replace(Regex("""@[A-Za-z]*$"""), "@$name ")

/** A chosen command still waiting for what it needs ("/scrape " → its usage), or null. */
internal fun pendingCommand(text: String, commands: List<CommandSpec>): CommandSpec? {
  val m = Regex("""^\s*/([A-Za-z][\w-]*)\s+$""").find(text) ?: return null
  return commands.firstOrNull { it.name == m.groupValues[1].lowercase() && it.requiresArg }
}

/** What a command's usage asks for, in words: "/scrape <url>" → "the site's address". */
internal fun argWords(usage: String): String {
  val arg = usage.substringAfter(' ', "").trim().removePrefix("<").removePrefix("[").removeSuffix(">").removeSuffix("]")
  return when {
    arg.equals("url", ignoreCase = true) -> "the site's address"
    arg.isBlank() -> "what it's for"
    else -> arg
  }
}

private fun commandIcon(name: String): ImageVector = when (name) {
  "workflow" -> Icons.Rounded.AccountTree
  "scrape" -> Icons.Rounded.TravelExplore
  "bugbounty" -> Icons.Rounded.BugReport
  else -> Icons.Rounded.Bolt
}

private fun mentionIcon(name: String): ImageVector = when (name) {
  "drive" -> Icons.Rounded.AddToDrive
  else -> Icons.Rounded.AlternateEmail
}

/**
 * Shows above or inside a text box while `/…` or `@…` is being typed. Tapping
 * a row puts it in the text through [onText]; nothing is sent.
 */
@Composable
fun CommandMenu(text: String, onText: (String) -> Unit, modifier: Modifier = Modifier) {
  val all = LocalDexCommands.current
  val commandPartial = commandQuery(text)
  val mentionPartial = if (commandPartial == null) mentionQuery(text) else null
  val commands = remember(commandPartial, all) { commandPartial?.let { p -> all.commands.filter { it.name.startsWith(p) } }.orEmpty() }
  val mentions = remember(mentionPartial, all) { mentionPartial?.let { p -> all.mentions.filter { it.name.startsWith(p) } }.orEmpty() }
  val pending = remember(text, all) { pendingCommand(text, all.commands) }
  val haptics = LocalHaptics.current
  val scheme = MaterialTheme.colorScheme

  AnimatedVisibility(
    visible = commands.isNotEmpty() || mentions.isNotEmpty() || pending != null,
    enter = expandVertically(expandFrom = Alignment.Bottom) + fadeIn(),
    exit = shrinkVertically(shrinkTowards = Alignment.Bottom) + fadeOut(),
    modifier = modifier,
  ) {
    Surface(shape = RoundedCornerShape(24.dp), color = scheme.surfaceContainerHighest, modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(vertical = 8.dp)) {
        when {
          commands.isNotEmpty() -> {
            MenuHeader("Commands")
            commands.forEach { c ->
              MenuRow(commandIcon(c.name), "/${c.name}", c.label, c.summary) { haptics.tick(); onText(withCommand(c.name)) }
            }
          }
          mentions.isNotEmpty() -> {
            MenuHeader("Mention")
            mentions.forEach { m ->
              MenuRow(mentionIcon(m.name), m.label, null, m.summary) { haptics.tick(); onText(withMention(text, m.name)) }
            }
          }
          pending != null -> {
            // The command is chosen; say what to add, as the desktop's chip does.
            Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
              Icon(commandIcon(pending.name), null, Modifier.size(18.dp), tint = scheme.primary)
              Spacer(Modifier.size(10.dp))
              Text("${pending.label} · now add ${argWords(pending.usage)}", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun MenuHeader(text: String) {
  Text(
    text,
    style = MaterialTheme.typography.labelMedium,
    color = MaterialTheme.colorScheme.primary,
    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 4.dp),
  )
}

@Composable
private fun MenuRow(icon: ImageVector, title: String, label: String?, summary: String, onClick: () -> Unit) {
  val scheme = MaterialTheme.colorScheme
  Row(
    Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    ShapeBadge(MaterialShapes.Cookie6Sided, scheme.secondaryContainer, 40.dp) {
      Icon(icon, null, tint = scheme.onSecondaryContainer, modifier = Modifier.size(20.dp))
    }
    Spacer(Modifier.size(12.dp))
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = scheme.onSurface)
        if (label != null) {
          Spacer(Modifier.size(8.dp))
          Text(label, style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
        }
      }
      if (summary.isNotBlank()) {
        Text(summary, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
    }
  }
}
