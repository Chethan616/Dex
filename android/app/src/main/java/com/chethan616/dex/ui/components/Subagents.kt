package com.chethan616.dex.ui.components

/**
 * Subagents on the phone (desktop/app/src/main/firebase/bridge.ts mirrors
 * one row per subagent to sessions/{id}/subagents/{subagentId}; see
 * data/Models.kt's Subagent for the shape): a quiet mention row in the
 * conversation ("X, Y and Z started working" / "X finished" — same grouping
 * the desktop chat uses), and a sheet of Active/Done rows reached from the
 * top bar. Avatars here are still (BotAvatar's `still = true`) — nothing
 * animates forever in a list, on the phone same as the desktop.
 */

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.Block
import com.chethan616.dex.data.Subagent
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.avatar.botTypeFor

/** One "started working" / "finished" line — several subagents that began (or ended) within the same couple of seconds read as one line. */
data class SubagentMentionGroup(val at: Long, val kind: String, val items: List<Subagent>)

private const val GROUP_WINDOW_MS = 2_000L

/** "a", "a and b", "a, b and c". */
fun joinNames(names: List<String>): String = when (names.size) {
  0 -> ""
  1 -> names[0]
  2 -> "${names[0]} and ${names[1]}"
  else -> "${names.dropLast(1).joinToString(", ")} and ${names.last()}"
}

fun mentionText(group: SubagentMentionGroup): String {
  val verb = if (group.kind == "start") "started working" else "finished"
  return "${joinNames(group.items.map { it.name })} $verb"
}

/** Buckets a timestamped list into groups no more than GROUP_WINDOW_MS apart, in order. */
private fun bucketByTime(items: List<Subagent>, kind: String, timeOf: (Subagent) -> Long): List<SubagentMentionGroup> {
  val out = mutableListOf<SubagentMentionGroup>()
  var bucket = mutableListOf<Subagent>()
  var bucketAt = 0L
  for (s in items) {
    val t = timeOf(s)
    if (bucket.isEmpty()) {
      bucketAt = t
      bucket.add(s)
    } else if (t - bucketAt <= GROUP_WINDOW_MS) {
      bucket.add(s)
    } else {
      out += SubagentMentionGroup(bucketAt, kind, bucket)
      bucket = mutableListOf(s)
      bucketAt = t
    }
  }
  if (bucket.isNotEmpty()) out += SubagentMentionGroup(bucketAt, kind, bucket)
  return out
}

fun groupSubagentMentions(subagents: List<Subagent>): List<SubagentMentionGroup> {
  val starts = subagents.filter { it.startedAt != null }.sortedBy { it.startedAt }
  val dones = subagents.filter { it.status == "done" && it.endedAt != null }.sortedBy { it.endedAt }
  val startGroups = bucketByTime(starts, "start") { it.startedAt!! }
  val doneGroups = bucketByTime(dones, "done") { it.endedAt!! }
  return (startGroups + doneGroups).sortedBy { it.at }
}

/** One item in the merged conversation: a run of ordinary blocks, or a subagent mention line. */
sealed interface ConversationItem {
  data class Blocks(val group: List<Block>) : ConversationItem
  data class Mention(val group: SubagentMentionGroup) : ConversationItem
}

/**
 * Merges the block groups SessionScreen already builds (groupTools) with
 * subagent mention lines, ordered by timestamp — the same idea as the
 * desktop chat's turn/mention merge. Falls back to the plain block list
 * when there's nothing to merge, so a session with no subagents costs
 * nothing extra.
 */
fun mergeConversation(blockGroups: List<List<Block>>, subagents: List<Subagent>): List<ConversationItem> {
  if (subagents.isEmpty()) return blockGroups.map { ConversationItem.Blocks(it) }
  val mentions = groupSubagentMentions(subagents)
  if (mentions.isEmpty()) return blockGroups.map { ConversationItem.Blocks(it) }
  data class Timed(val at: Long, val order: Int, val item: ConversationItem)
  val timed = ArrayList<Timed>(blockGroups.size + mentions.size)
  blockGroups.forEachIndexed { i, g -> timed += Timed(g.firstOrNull()?.at ?: Long.MAX_VALUE, i, ConversationItem.Blocks(g)) }
  mentions.forEachIndexed { i, m -> timed += Timed(m.at, blockGroups.size + i, ConversationItem.Mention(m)) }
  return timed.sortedWith(compareBy({ it.at }, { it.order })).map { it.item }
}

@Composable
fun SubagentMentionRow(group: SubagentMentionGroup) {
  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
      group.items.take(4).forEach { s ->
        BotAvatar(type = botTypeFor(null, s.id), mood = BotMood.Idle, size = 16.dp, interactive = false, still = true)
      }
    }
    Spacer(Modifier.size(6.dp))
    Text(
      mentionText(group),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

@Composable
fun SubagentsButton(count: Int, activeCount: Int, onClick: () -> Unit) {
  if (count == 0) return
  IconButton(onClick = onClick) {
    BadgedBox(badge = { if (activeCount > 0) Badge { Text("$activeCount") } }) {
      Icon(Icons.Rounded.Groups, "Subagents")
    }
  }
}

private val VERBS = mapOf(
  "read" to "inspecting", "grep" to "inspecting", "glob" to "inspecting", "ls" to "inspecting",
  "bash" to "running", "edit" to "editing", "write" to "writing", "multiedit" to "editing",
  "websearch" to "searching", "webfetch" to "reading",
)

/** The subagent's one-line "what it's doing now", from its mirrored latest step. */
private fun activityLine(s: Subagent): String? {
  val last = s.lastActivity ?: return null
  if (last.kind != "tool_call") return null
  val verb = last.name?.lowercase()?.let { VERBS[it] } ?: "using"
  val target = last.preview?.lineSequence()?.firstOrNull()?.trim()?.substringAfterLast('/')?.substringAfterLast('\\')
  return if (!target.isNullOrBlank()) "$verb ${target.take(48)}" else verb.replaceFirstChar { it.uppercase() }
}

private fun agoLabel(ms: Long?, now: Long): String {
  if (ms == null) return ""
  val diff = (now - ms).coerceAtLeast(0)
  return when {
    diff < 60_000 -> "just now"
    diff < 3_600_000 -> "${diff / 60_000}m ago"
    diff < 86_400_000 -> "${diff / 3_600_000}h ago"
    else -> "${diff / 86_400_000}d ago"
  }
}

private fun elapsedLabel(ms: Long?): String {
  if (ms == null) return ""
  val s = ms / 1000
  return if (s < 60) "${s}s" else "${s / 60}m ${s % 60}s"
}

@Composable
private fun SubagentRow(a: Subagent, now: Long, modifier: Modifier = Modifier) {
  var expanded by remember { mutableStateOf(false) }
  val active = a.isActive
  Column(
    modifier
      .fillMaxWidth()
      .clickable { expanded = !expanded }
      .padding(vertical = 8.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      BotAvatar(type = botTypeFor(null, a.id), mood = if (active) BotMood.Working else BotMood.Idle, size = 32.dp, interactive = false, still = true)
      Spacer(Modifier.size(10.dp))
      Column(Modifier.weight(1f)) {
        Text(a.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        val sub = if (active) activityLine(a) else null
        if (sub != null) {
          Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
      Text(
        if (active) elapsedLabel(a.startedAt?.let { now - it }) else agoLabel(a.endedAt, now),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    if (expanded) {
      Column(Modifier.padding(start = 42.dp, top = 6.dp)) {
        a.prompt?.takeIf { it.isNotBlank() }?.let {
          Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!active) {
          Text(
            a.summary?.takeIf { it.isNotBlank() } ?: if (a.ok == false) "Failed." else "Done.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 4.dp),
          )
        }
      }
    }
  }
}

@Composable
fun SubagentsSheet(subagents: List<Subagent>, onDismiss: () -> Unit) {
  val active = subagents.filter { it.isActive }
  val done = subagents.filter { !it.isActive }
  val now = System.currentTimeMillis()
  val sheetMax = rememberSheetMaxHeight()
  val navBottom = androidx.compose.foundation.layout.WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    shape = RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp),
    contentWindowInsets = { NoSheetInsets },
  ) {
    LazyColumn(
      Modifier.fillMaxWidth().heightIn(max = sheetMax),
      contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp + navBottom),
      verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
      item { Text("Subagents", style = MaterialTheme.typography.headlineSmall) }
      item { Text("Active · ${active.size}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 12.dp)) }
      if (active.isEmpty()) {
        item { Text("No active subagents", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      } else {
        items(active, key = { "a-" + it.id }) { SubagentRow(it, now) }
      }
      item { Text("Done · ${done.size}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 12.dp)) }
      if (done.isEmpty()) {
        item { Text("None finished yet", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      } else {
        items(done, key = { "d-" + it.id }) { SubagentRow(it, now) }
      }
    }
  }
}
