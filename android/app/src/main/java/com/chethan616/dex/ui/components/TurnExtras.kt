package com.chethan616.dex.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Mail
import androidx.compose.material.icons.rounded.TaskAlt
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.Block
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.theme.Space
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/*
 * What closes a finished turn, as on the desktop (renderer/hub/chat/turns.ts,
 * ResultCard.tsx, ChatView.tsx): a typed card for a calendar, mail or task
 * result, the copy button with the time, and follow-up chips. The tool-name
 * rules below mirror mcpResults.ts and CHIP_RULES there; keep the two alike.
 */

/* ── Recognising a result ────────────────────────────────────────────── */

data class CardRow(
  val title: String,
  val subtitle: String? = null,
  val snippet: String? = null,
  val link: String? = null,
  val unread: Boolean = false,
  val done: Boolean = false,
)

data class ResultCardData(val kind: String, val provider: String, val rows: List<CardRow>) {
  val label: String
    get() = when (kind) {
      "calendar" -> if (provider == "microsoft") "Outlook Calendar" else "Calendar"
      "mail" -> if (provider == "microsoft") "Outlook Mail" else "Gmail"
      else -> if (provider == "microsoft") "Microsoft To Do" else "Google Tasks"
    }
}

private fun JSONObject.s(k: String): String? = if (has(k) && !isNull(k)) optString(k).takeIf { it.isNotEmpty() } else null

private val TOOL_RE = Regex("^mcp__(google|microsoft)__([a-z_]+)$")

/** "Tue, Oct 13, 2026" for an all-day date; "Tue, Oct 13, 2026 · 9:00 AM – 10:00 AM" for a timed one. */
internal fun eventTime(start: String?, end: String?, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String? {
  if (start == null) return null
  val dayFmt = DateTimeFormatter.ofPattern("EEE, MMM d, yyyy", locale)
  if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(start)) return runCatching { LocalDate.parse(start).format(dayFmt) }.getOrNull()
  fun at(v: String) = runCatching { OffsetDateTime.parse(v).atZoneSameInstant(zone).toLocalDateTime() }
    .recoverCatching { Instant.parse(v).atZone(zone).toLocalDateTime() }
    .recoverCatching { LocalDateTime.parse(v) }
    .getOrNull()
  val s = at(start) ?: return null
  val clock = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)
  val e = end?.let(::at)
  val day = s.format(dayFmt)
  return if (e != null) "$day · ${s.format(clock)} – ${e.format(clock)}" else "$day · ${s.format(clock)}"
}

private fun googleEvent(o: JSONObject?): CardRow? {
  val title = o?.s("summary") ?: return null
  val when_ = eventTime(o.s("start"), o.s("end"))
  return CardRow(title, listOfNotNull(when_, o.s("location")).joinToString(" · ").ifEmpty { null }, link = o.s("link") ?: o.s("meetLink"))
}

private fun msEvent(o: JSONObject?): CardRow? {
  val title = o?.s("subject") ?: return null
  val when_ = eventTime(o.s("start"), o.s("end"))
  return CardRow(title, listOfNotNull(when_, o.s("location")).joinToString(" · ").ifEmpty { null }, link = o.s("joinUrl"))
}

private fun googleMail(o: JSONObject?): CardRow? {
  if (o == null || (!o.has("id") && !o.has("subject"))) return null
  return CardRow(
    o.s("subject") ?: "(no subject)",
    listOfNotNull(o.s("from"), o.s("date")).joinToString(" · ").ifEmpty { null },
    snippet = o.s("snippet"),
    unread = o.optBoolean("unread"),
  )
}

private fun msMail(o: JSONObject?): CardRow? {
  if (o == null || (!o.has("id") && !o.has("subject"))) return null
  return CardRow(
    o.s("subject") ?: "(no subject)",
    listOfNotNull(o.s("fromName") ?: o.s("from"), o.s("received")).joinToString(" · ").ifEmpty { null },
    snippet = o.s("preview"),
    unread = o.has("isRead") && !o.optBoolean("isRead", true),
  )
}

private fun dueText(due: String?): String? {
  if (due == null) return null
  val date = runCatching { LocalDate.parse(due.take(10)) }.getOrNull() ?: return null
  return "Due " + date.format(DateTimeFormatter.ofPattern("MMM d", Locale.getDefault()))
}

private fun task(o: JSONObject?, dueKey: String): CardRow? {
  val title = o?.s("title") ?: return null
  return CardRow(title, dueText(o.s(dueKey)), done = o.s("status") == "completed")
}

private fun JSONArray.objs(): List<JSONObject?> = (0 until length()).map { optJSONObject(it) }

private fun rowsOf(data: Any?, map: (JSONObject?) -> CardRow?): List<CardRow>? {
  val arr = data as? JSONArray ?: return null
  return arr.objs().mapNotNull(map).ifEmpty { null }
}

/** A finished Google or Microsoft tool call's result as a card, or null for anything else. */
fun detectResultCard(toolName: String, preview: String): ResultCardData? {
  val m = TOOL_RE.matchEntire(toolName) ?: return null
  val provider = m.groupValues[1]
  val tool = m.groupValues[2]
  val data = runCatching { JSONTokener(preview).nextValue() }.getOrNull() ?: return null
  fun card(kind: String, rows: List<CardRow>?) = rows?.let { ResultCardData(kind, provider, it) }
  fun one(kind: String, row: CardRow?) = row?.let { ResultCardData(kind, provider, listOf(it)) }
  val obj = data as? JSONObject
  return if (provider == "google") when (tool) {
    "calendar_list_events" -> card("calendar", rowsOf(obj?.optJSONArray("events"), ::googleEvent))
    "calendar_create_event", "calendar_update_event", "meet_create" -> one("calendar", googleEvent(obj))
    "gmail_search" -> card("mail", rowsOf(data, ::googleMail))
    "tasks_list" -> card("tasks", rowsOf(data) { task(it, "due") })
    "tasks_create" -> one("tasks", task(obj, "due"))
    else -> null
  } else when (tool) {
    "calendar_list" -> card("calendar", rowsOf(data, ::msEvent))
    "calendar_create", "calendar_update" -> one("calendar", msEvent(obj))
    "mail_list" -> card("mail", rowsOf(data, ::msMail))
    "todo_tasks" -> card("tasks", rowsOf(data) { task(it, "dueDate") })
    else -> null
  }
}

/* ── Follow-up chips ─────────────────────────────────────────────────── */

data class FollowUp(val label: String, val prompt: String)

private class ChipRule(val match: Regex, val chips: List<FollowUp>)

private val CHIP_RULES = listOf(
  ChipRule(
    Regex("^mcp__(google|microsoft)__(calendar|meet)"),
    listOf(FollowUp("Show my week", "Show my calendar for this week"), FollowUp("Any conflicts?", "Are there any conflicts on my calendar this week?")),
  ),
  ChipRule(
    Regex("^mcp__google__gmail_|^mcp__microsoft__mail_"),
    listOf(FollowUp("Show unread emails", "Show me my unread emails"), FollowUp("Anything urgent?", "Is there anything urgent in my inbox?")),
  ),
  ChipRule(
    Regex("^mcp__google__tasks_|^mcp__microsoft__todo_"),
    listOf(FollowUp("Show all tasks", "Show me all my open tasks")),
  ),
  ChipRule(
    Regex("^mcp__remote_kiwi__"),
    listOf(FollowUp("Cheaper days?", "Which nearby days are cheaper for this trip?"), FollowUp("Find a hotel there", "Find me a hotel there for those dates")),
  ),
  ChipRule(
    Regex("^mcp__remote_trivago__"),
    listOf(FollowUp("Cheaper options", "Show me cheaper options"), FollowUp("Closest to the centre", "Which of these is closest to the centre?")),
  ),
)

/** Suggestions for what a turn just did, from the tools it called: never from its text, never an extra model call. */
fun followUpsFor(toolNames: List<String>): List<FollowUp> {
  val seen = LinkedHashMap<String, FollowUp>()
  for (name in toolNames) for (rule in CHIP_RULES) if (rule.match.containsMatchIn(name)) rule.chips.forEach { seen.putIfAbsent(it.label, it) }
  return seen.values.take(3)
}

/* ── Putting them at the end of each turn ────────────────────────────── */

/**
 * Adds, to each settled turn, synthetic blocks the list draws like any other:
 * `resultcard` (one per recognised tool result, before the turn's Done chip),
 * `replyfoot` (copy and time, when no Done chip carries them) and, on the
 * newest settled turn, `chips`. Their seq is negative, so it never meets a
 * real block's.
 */
internal fun withTurnExtras(blocks: List<Block>, live: Boolean): List<Block> {
  if (blocks.none { it.kind == "tool" || it.kind == "text" || it.kind == "done" }) return blocks
  val out = ArrayList<Block>(blocks.size + 4)
  var start = 0
  fun turnEnd(from: Int, to: Int, isLast: Boolean) {
    val turn = blocks.subList(from, to)
    val settled = !(isLast && live)
    if (!settled || turn.isEmpty()) { out += turn; return }
    val lastWork = turn.indexOfLast { it.kind == "tool" || it.kind == "image" }
    val reply = turn.withIndex().filter { (i, b) -> (b.kind == "text" && i > lastWork) || (b.kind == "done" && !b.echo && !b.text.isNullOrBlank()) }
      .joinToString("\n\n") { it.value.text.orEmpty().trim() }
    val tools = turn.filter { it.kind == "tool" }
    val anchor = turn.last()
    val base = -(anchor.seq * 8 + 8)
    val at = anchor.at ?: turn.lastOrNull { it.at != null }?.at
    val cards = tools.mapNotNull { t -> t.result?.takeIf { it.ok }?.let { r -> t.name?.let { n -> detectResultCard(n, r.preview) } } }
    val echoDone = anchor.kind == "done" && anchor.echo
    val cut = if (echoDone) turn.lastIndex else turn.size
    out += turn.subList(0, cut)
    cards.forEachIndexed { i, c -> out += Block(seq = base + i, kind = "resultcard", at = at, text = encodeCard(c)) }
    if (echoDone) out += turn.last()
    if (reply.isNotBlank() && !echoDone) out += Block(seq = base + 5, kind = "replyfoot", at = at, text = reply)
    val chips = if (isLast && reply.isNotBlank()) followUpsFor(tools.mapNotNull { it.name }) else emptyList()
    if (chips.isNotEmpty()) out += Block(seq = base + 6, kind = "chips", at = at, items = chips.map { it.label to it.prompt })
  }
  blocks.forEachIndexed { i, b -> if (b.kind == "user" && i > start) { turnEnd(start, i, false); start = i } }
  turnEnd(start, blocks.size, true)
  return out
}

private fun encodeCard(c: ResultCardData): String = JSONObject().apply {
  put("kind", c.kind)
  put("provider", c.provider)
  put("rows", JSONArray().also { a ->
    c.rows.forEach { r ->
      a.put(JSONObject().apply {
        put("title", r.title); r.subtitle?.let { put("subtitle", it) }; r.snippet?.let { put("snippet", it) }
        r.link?.let { put("link", it) }; put("unread", r.unread); put("done", r.done)
      })
    }
  })
}.toString()

private fun decodeCard(json: String?): ResultCardData? = runCatching {
  val o = JSONObject(json ?: return null)
  val rows = o.getJSONArray("rows").objs().filterNotNull().map {
    CardRow(it.getString("title"), it.s("subtitle"), it.s("snippet"), it.s("link"), it.optBoolean("unread"), it.optBoolean("done"))
  }
  ResultCardData(o.getString("kind"), o.getString("provider"), rows)
}.getOrNull()

/* ── Drawing them ────────────────────────────────────────────────────── */

@Composable
fun ResultCardBlock(block: Block) {
  val card = remember(block.text) { decodeCard(block.text) } ?: return
  val uri = LocalUriHandler.current
  val haptics = LocalHaptics.current
  val icon = when (card.kind) { "calendar" -> Icons.Rounded.CalendarMonth; "mail" -> Icons.Rounded.Mail; else -> Icons.Rounded.TaskAlt }
  WidgetSurface {
    Column {
      Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(horizontal = Space.l, vertical = Space.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s),
      ) {
        Icon(icon, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(card.label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      card.rows.forEachIndexed { i, row ->
        if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        Row(Modifier.fillMaxWidth().padding(Space.l), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.m)) {
          Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
              (if (row.unread) "● " else "") + row.title,
              style = MaterialTheme.typography.titleSmall,
              fontWeight = FontWeight.SemiBold,
              color = if (row.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
              textDecoration = if (row.done) androidx.compose.ui.text.style.TextDecoration.LineThrough else null,
              maxLines = 2,
              overflow = TextOverflow.Ellipsis,
            )
            row.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            row.snippet?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
          }
          row.link?.let { url ->
            FilledTonalIconButton(onClick = { haptics.click(); runCatching { uri.openUri(url) } }, modifier = Modifier.size(36.dp)) {
              Icon(Icons.AutoMirrored.Rounded.OpenInNew, "Open", Modifier.size(18.dp))
            }
          }
        }
      }
    }
  }
}

/** "2:17 PM", in the phone's own clock style. */
internal fun timeOfDay(ms: Long?): String? = ms?.let {
  Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))
}

/** Copy the answer, and when it came: the line under a reply. */
@Composable
fun CopyAndTime(text: String, at: Long?, modifier: Modifier = Modifier) {
  val clipboard = LocalClipboardManager.current
  val haptics = LocalHaptics.current
  var copied by remember { mutableStateOf(false) }
  androidx.compose.runtime.LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
  Row(modifier, verticalAlignment = Alignment.CenterVertically) {
    IconButton(onClick = { clipboard.setText(AnnotatedString(text)); haptics.confirm(); copied = true }, modifier = Modifier.size(36.dp)) {
      Icon(if (copied) Icons.Rounded.Check else Icons.Rounded.ContentCopy, if (copied) "Copied" else "Copy answer", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    timeOfDay(at)?.let {
      Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = Space.xs))
    }
  }
}

@Composable
fun ReplyFootBlock(block: Block) {
  CopyAndTime(block.text.orEmpty(), block.at, Modifier.fillMaxWidth())
}

/** Follow-up suggestions: tap one and it goes as your next message. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipsBlock(block: Block) {
  val host = LocalWidgetHost.current ?: return
  FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s), verticalArrangement = Arrangement.spacedBy(Space.s), modifier = Modifier.fillMaxWidth()) {
    block.items.forEach { (label, prompt) ->
      Pill(label, on = false, icon = Icons.AutoMirrored.Rounded.ArrowForward, dashed = true) { prompt?.let { host.reply(it) } }
    }
  }
}
