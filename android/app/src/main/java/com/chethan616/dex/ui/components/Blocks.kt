package com.chethan616.dex.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.DesktopWindows
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.automirrored.rounded.InsertDriveFile
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.SmartToy
import androidx.compose.material.icons.rounded.Terminal
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.Block
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.orb.DexOrb
import com.chethan616.dex.ui.orb.orbStateFor
import com.chethan616.dex.ui.theme.MonoStyle
import com.chethan616.dex.ui.files.PcFileCard
import com.chethan616.dex.ui.files.asTaskItem

private fun kindIcon(kind: String?): ImageVector = when (kind) {
  "search" -> Icons.Rounded.Search
  "browse" -> Icons.Rounded.Language
  "mcp" -> Icons.Rounded.Extension
  "read" -> Icons.Rounded.Description
  "write" -> Icons.Rounded.EditNote
  "run" -> Icons.Rounded.Terminal
  "desktop" -> Icons.Rounded.DesktopWindows
  "agent" -> Icons.Rounded.SmartToy
  else -> Icons.Rounded.AutoAwesome
}

/** Same per-kind accents as the desktop's chat.css. */
private fun kindColor(kind: String?): Color = when (kind) {
  "search" -> Color(0xFF5B8DEF)
  "browse" -> Color(0xFF3AA5B8)
  "mcp" -> Color(0xFF9B6CF0)
  "read" -> Color(0xFF8A8F98)
  "write" -> Color(0xFFD9922E)
  "run" -> Color(0xFF3FA36B)
  "desktop" -> Color(0xFFD4637B)
  "agent" -> Color(0xFFC9A227)
  else -> Color(0xFF8A8F98)
}

private fun formatMs(ms: Long): String = when {
  ms <= 0 -> ""
  ms < 1000 -> "${ms}ms"
  ms < 60_000 -> String.format(java.util.Locale.US, if (ms < 10_000) "%.1fs" else "%.0fs", ms / 1000.0)
  else -> "${ms / 60_000}m ${(ms % 60_000) / 1000}s"
}

@Composable
fun UserBubble(text: String) {
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
    Surface(
      shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = 22.dp, bottomEnd = 6.dp),
      color = MaterialTheme.colorScheme.primaryContainer,
      modifier = Modifier.widthIn(max = 320.dp),
    ) {
      Text(
        text,
        Modifier.padding(horizontal = 16.dp, vertical = 11.dp),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onPrimaryContainer,
      )
    }
  }
}

@Composable
fun AssistantText(text: String) {
  Markdown(text, Modifier.fillMaxWidth())
}

@Composable
fun ToolCard(block: Block, running: Boolean) {
  var open by rememberSaveable(block.seq) { mutableStateOf(false) }
  val haptics = LocalHaptics.current
  val failed = block.result?.ok == false
  val accent = if (failed) MaterialTheme.colorScheme.error else kindColor(block.toolKind)
  val chevron by animateFloatAsState(if (open) 180f else 0f, label = "chevron")
  val target = block.display ?: block.summary.orEmpty()

  Surface(
    shape = RoundedCornerShape(18.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    border = if (running) androidx.compose.foundation.BorderStroke(1.dp, accent.copy(alpha = 0.5f)) else null,
    modifier = Modifier.fillMaxWidth().animateContentSize(),
  ) {
    Column {
      Row(
        Modifier
          .fillMaxWidth()
          .clickable { haptics.tick(); open = !open }
          .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Box(
          Modifier.size(32.dp).background(accent.copy(alpha = 0.14f), RoundedCornerShape(10.dp)),
          contentAlignment = Alignment.Center,
        ) {
          if (running) DexOrb(orbStateFor(block.orb), size = 24.dp)
          else Icon(kindIcon(block.toolKind), null, tint = accent, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
          Text(
            (if (running) block.activeVerb else block.verb) ?: block.name.orEmpty(),
            style = MaterialTheme.typography.titleSmall,
          )
          if (target.isNotBlank()) {
            Text(target, style = MonoStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
        }
        block.result?.let { r ->
          if (r.ms > 0) Text(formatMs(r.ms), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (failed) {
          Spacer(Modifier.size(6.dp))
          Text("Failed", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
        }
        Icon(Icons.Rounded.ExpandMore, null, Modifier.rotate(chevron), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      AnimatedVisibility(open, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          CodeSection(label = "${block.name} · step ${block.iteration}", body = block.argsJson ?: "—")
          CodeSection(
            label = when { block.result == null -> "Waiting for result…"; failed -> "Error"; else -> "Result" },
            body = block.result?.preview?.ifBlank { "(no output)" },
            error = failed,
          )
        }
      }
    }
  }
}

@Composable
private fun CodeSection(label: String, body: String?, error: Boolean = false) {
  val clipboard = LocalClipboardManager.current
  val haptics = LocalHaptics.current
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
      if (body != null) {
        IconButton(onClick = { clipboard.setText(AnnotatedString(body)); haptics.confirm() }, modifier = Modifier.size(32.dp)) {
          Icon(Icons.Rounded.ContentCopy, "Copy", Modifier.size(16.dp))
        }
      }
    }
    if (body != null) {
      Text(
        body,
        style = MonoStyle,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        modifier = Modifier
          .fillMaxWidth()
          .heightIn(max = 260.dp)
          .background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(12.dp))
          .verticalScroll(rememberScrollState())
          .horizontalScroll(rememberScrollState())
          .padding(10.dp),
        softWrap = false,
      )
    }
  }
}

@Composable
fun DoneCard(block: Block) {
  if (block.echo) {
    DoneFooter(block)
    return
  }
  Card(
    shape = RoundedCornerShape(24.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.onTertiaryContainer)
        Spacer(Modifier.size(8.dp))
        Text("Done", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onTertiaryContainer)
        if (block.iteration > 0) {
          Spacer(Modifier.size(8.dp))
          Text("${block.iteration} steps", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f))
        }
      }
      Markdown(block.text.orEmpty(), color = MaterialTheme.colorScheme.onTertiaryContainer)
    }
  }
}

/**
 * The answer is already right above: just close the turn — a check, the step
 * count, and copy for the answer.
 */
@Composable
private fun DoneFooter(block: Block) {
  val clipboard = LocalClipboardManager.current
  val haptics = LocalHaptics.current
  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
    Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.tertiaryContainer) {
      Row(Modifier.padding(start = 8.dp, end = 12.dp, top = 5.dp, bottom = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Rounded.CheckCircle, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onTertiaryContainer)
        Spacer(Modifier.size(6.dp))
        Text(
          if (block.iteration > 0) "Done · ${block.iteration} steps" else "Done",
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.onTertiaryContainer,
        )
      }
    }
    Spacer(Modifier.weight(1f))
    IconButton(onClick = { clipboard.setText(AnnotatedString(block.text.orEmpty())); haptics.confirm() }) {
      Icon(Icons.Rounded.ContentCopy, "Copy answer", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/**
 * Consecutive tool calls folded into one row — "Worked through 6 steps" with
 * the kinds of work as icons — instead of a card per command. Opens to the
 * individual steps; while one is running it shows that one live.
 */
@Composable
fun ToolGroup(blocks: List<Block>, runningSeq: Long?) {
  if (blocks.size == 1) {
    ToolCard(blocks[0], running = blocks[0].seq == runningSeq)
    return
  }
  var open by rememberSaveable(blocks.first().seq) { mutableStateOf(false) }
  val haptics = LocalHaptics.current
  val chevron by animateFloatAsState(if (open) 180f else 0f, label = "chevron")
  val failed = blocks.count { it.result?.ok == false }
  val totalMs = blocks.sumOf { it.result?.ms ?: 0L }
  val running = blocks.firstOrNull { it.seq == runningSeq }
  val kinds = blocks.map { it.toolKind }.distinct().take(4)

  Surface(
    shape = RoundedCornerShape(18.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    modifier = Modifier.fillMaxWidth().animateContentSize(),
  ) {
    Column {
      Row(
        Modifier
          .fillMaxWidth()
          .clickable { haptics.tick(); open = !open }
          .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Row(horizontalArrangement = Arrangement.spacedBy((-6).dp)) {
          kinds.forEach { k ->
            Box(
              Modifier
                .size(26.dp)
                .background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(9.dp))
                .padding(1.5.dp)
                .background(kindColor(k).copy(alpha = 0.18f), RoundedCornerShape(8.dp)),
              contentAlignment = Alignment.Center,
            ) { Icon(kindIcon(k), null, tint = kindColor(k), modifier = Modifier.size(14.dp)) }
          }
        }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
          Text(
            if (running != null) "Working · step ${blocks.indexOf(running) + 1}" else "Worked through ${blocks.size} steps",
            style = MaterialTheme.typography.titleSmall,
          )
          Text(
            running?.let { (it.activeVerb ?: it.name.orEmpty()) + (it.display?.let { d -> " · $d" } ?: "") }
              ?: listOfNotNull(
                formatMs(totalMs).takeIf { it.isNotEmpty() },
                if (failed > 0) "$failed retried" else null,
              ).joinToString(" · ").ifEmpty { "Tap to see each step" },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
        if (running != null) DexOrb(orbStateFor(running.orb), size = 24.dp)
        Icon(Icons.Rounded.ExpandMore, null, Modifier.rotate(chevron), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      AnimatedVisibility(open, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        Column(Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          blocks.forEach { ToolCard(it, running = it.seq == runningSeq) }
        }
      }
    }
  }
}

@Composable
fun ErrorCard(text: String) {
  Row(
    Modifier
      .fillMaxWidth()
      .background(MaterialTheme.colorScheme.errorContainer, RoundedCornerShape(18.dp))
      .padding(14.dp),
    verticalAlignment = Alignment.Top,
  ) {
    Icon(Icons.Rounded.ErrorOutline, null, tint = MaterialTheme.colorScheme.onErrorContainer)
    Spacer(Modifier.size(10.dp))
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
  }
}

@Composable
fun NoticeRow(block: Block) {
  val icon = when (block.level) {
    "skill" -> Icons.Rounded.Lightbulb
    "confirm" -> Icons.Rounded.Shield
    "harness" -> Icons.Rounded.Extension
    else -> Icons.Rounded.Info
  }
  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 4.dp)) {
    Icon(icon, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.size(8.dp))
    Text(block.text.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
  }
}

@Composable
fun FileCard(block: Block) {
  // With a path the phone can fetch it from the PC: picture preview, open, share.
  block.asTaskItem()?.let {
    PcFileCard(it)
    return
  }
  Row(
    Modifier
      .fillMaxWidth()
      .background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(18.dp))
      .padding(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(if (block.kind == "image") Icons.Rounded.Image else Icons.AutoMirrored.Rounded.InsertDriveFile, null, tint = MaterialTheme.colorScheme.primary)
    Spacer(Modifier.size(10.dp))
    Column(Modifier.weight(1f)) {
      Text(block.name ?: block.text.orEmpty(), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(
        if (block.kind == "image") "Screenshot on your PC" else "${readableSize(block.size)} · saved on your PC",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

private fun readableSize(n: Long): String = when {
  n <= 0 -> "file"
  n < 1024 -> "$n B"
  n < 1024 * 1024 -> "${n / 1024} KB"
  else -> String.format(java.util.Locale.US, "%.1f MB", n / 1048576.0)
}

@Composable
fun CanvasCard(block: Block) {
  Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(block.name.orEmpty(), style = MaterialTheme.typography.titleMedium)
      block.text?.let { Markdown(it) }
      block.items.forEach { (label, detail) ->
        Column {
          Text(label, style = MaterialTheme.typography.bodyMedium)
          detail?.let { Text(it, style = MonoStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
      }
    }
  }
}

@Composable
fun BlockView(block: Block, running: Boolean) {
  when (block.kind) {
    "user" -> UserBubble(block.text.orEmpty())
    "text" -> AssistantText(block.text.orEmpty())
    "tool" -> ToolCard(block, running)
    "done" -> DoneCard(block)
    "error" -> ErrorCard(block.text.orEmpty())
    "notice" -> NoticeRow(block)
    "file", "image" -> FileCard(block)
    "canvas", "artifact" -> CanvasCard(block)
    else -> Unit
  }
}

/** Remembered helper so callers can hold per-list state without importing runtime bits. */
@Composable
fun <T> rememberMutable(initial: T) = remember { mutableStateOf(initial) }
