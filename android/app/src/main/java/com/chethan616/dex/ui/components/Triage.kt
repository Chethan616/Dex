package com.chethan616.dex.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.MailOutline
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.chethan616.dex.ui.haptics.LocalHaptics
import kotlinx.coroutines.delay
import org.json.JSONObject
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * Triage — the desktop's triage card (desktop/app/src/shared/triage.ts,
 * hub/chat/Triage.tsx) on the phone. Messages DEX read for you, each a point
 * on urgency (across) and importance (up), with the reply it drafted and
 * three answers: Yes sends it, No leaves it, Specify says what to change.
 *
 * In the chat it's a compact card — the plot, or the rows when there are
 * five or fewer. Answering happens in a full-screen sheet that stays open
 * while you go through them, each message turning to "Sending…" then a tick
 * as the PC's updates arrive.
 */

data class TItem(
  val id: String,
  val from: String,
  val address: String?,
  val subject: String?,
  val preview: String?,
  val body: String?,
  val at: String?,
  val urgency: Double,
  val importance: Double,
  val why: String?,
  val draft: String?,
  val source: String?,
  val state: String?,
  val note: String?,
)

private fun JSONObject.s(k: String): String? = if (has(k) && !isNull(k)) optString(k).takeIf { it.isNotBlank() } else null

internal fun parseTriageItem(o: JSONObject, i: Int): TItem? {
  val from = o.s("from") ?: return null
  return TItem(
    id = o.s("id") ?: "i${i + 1}",
    from = from,
    address = o.s("address"),
    subject = o.s("subject"),
    preview = o.s("preview"),
    body = o.s("body"),
    at = o.s("at"),
    urgency = o.optDouble("urgency", 0.0).coerceIn(0.0, 10.0),
    importance = o.optDouble("importance", 0.0).coerceIn(0.0, 10.0),
    why = o.s("why"),
    draft = o.s("draft"),
    source = o.s("source"),
    state = o.s("state"),
    note = o.s("note"),
  )
}

/* ── The four corners (the same split as shared/triage.ts) ─────────── */

internal enum class Quad(val label: String, val color: Color) {
  Now("Reply now", Color(0xFFEF5B5B)),
  Quick("Quick reply", Color(0xFFF1A23B)),
  Plan("Plan a reply", Color(0xFF4C8BFF)),
  Later("Later", Color(0xFF8D97A8)),
}

internal fun quadOf(i: TItem): Quad = when {
  i.urgency >= 5 && i.importance >= 5 -> Quad.Now
  i.urgency >= 5 -> Quad.Quick
  i.importance >= 5 -> Quad.Plan
  else -> Quad.Later
}

/** Reply now first, then quick ones, then the rest; within each, highest first. */
internal fun triageOrder(items: List<TItem>): List<TItem> =
  items.sortedWith(compareBy<TItem> { quadOf(it).ordinal }.thenByDescending { it.urgency + it.importance })

internal fun settled(i: TItem): Boolean = i.state == "sent" || i.state == "skipped" || i.state == "sending"

private const val PLOT_ABOVE = 5

private val SOURCE_NAME = mapOf(
  "email" to "Email", "gmail" to "Gmail", "outlook" to "Outlook", "whatsapp" to "WhatsApp", "telegram" to "Telegram",
  "slack" to "Slack", "teams" to "Teams", "discord" to "Discord", "sms" to "SMS", "messages" to "Messages",
)

private fun initials(name: String): String {
  val words = name.replace(Regex("[^\\p{L}\\p{N}\\s]"), " ").trim().split(Regex("\\s+")).filter { it.isNotBlank() }
  if (words.isEmpty()) return "?"
  return (if (words.size == 1) words[0].take(2) else "${words.first()[0]}${words.last()[0]}").uppercase()
}

private val STATE_WORDS = mapOf("sending" to "Sending…", "sent" to "Sent", "skipped" to "Skipped", "changing" to "Redrafting…", "failed" to "Didn’t send")

/** The command an answer sends — main turns it into the agent's instruction (shared/triage.ts). */
private fun command(decision: String, wid: String, item: String, text: String? = null): String =
  "/triage $decision $wid $item" + (text?.trim()?.takeIf { it.isNotEmpty() }?.let { " $it" } ?: "")

/* ── The card in the chat ─────────────────────────────────────────── */

@Composable
internal fun TriageCard(title: String?, source: String?, cardItems: List<TItem>, wid: String?, reply: (String) -> Unit) {
  val haptics = LocalHaptics.current
  // An answer shows at once and holds until the PC's state for that message moves.
  val local = remember { mutableStateMapOf<String, Pair<String, String?>>() }
  val items = cardItems.map { it ->
    val mine = local[it.id]
    if (mine != null && it.state == mine.second) it.copy(state = mine.first) else it
  }
  val order = triageOrder(items)
  var openAt by remember { mutableStateOf<String?>(null) }
  val handled = items.count(::settled)
  val nowLeft = items.count { quadOf(it) == Quad.Now && !settled(it) }
  val sub = listOfNotNull("${items.size} message${if (items.size == 1) "" else "s"}", SOURCE_NAME[source], if (nowLeft > 0) "$nowLeft to reply now" else null, if (handled > 0) "$handled answered" else null).joinToString(" · ")

  val answer: (TItem, String, String?) -> String? = answer@{ item, decision, text ->
    if (wid == null) return@answer null
    if (decision == "yes") haptics.confirm() else haptics.click()
    reply(command(decision, wid, item.id, text))
    local[item.id] = (if (decision == "yes") "sending" else if (decision == "no") "skipped" else "changing") to cardItems.firstOrNull { it.id == item.id }?.state
    if (decision == "change") item.id else order.firstOrNull { it.id != item.id && !settled(it) }?.id
  }

  WidgetSurface {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        GlyphTile(Icons.Rounded.MailOutline, size = 40)
        Column(Modifier.weight(1f)) {
          Text(title ?: "Messages to answer", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
          Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      Progress(handled, items.size)
      if (items.size > PLOT_ABOVE) {
        TriagePlot(items, selected = null, onSelect = { haptics.click(); openAt = it })
      } else {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
          order.forEach { item -> TriageRow(item, selected = false, onClick = { haptics.click(); openAt = item.id }) }
        }
      }
      val first = order.firstOrNull { !settled(it) }
      if (first != null) {
        Button(onClick = { haptics.click(); openAt = first.id }, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)) {
          Text(if (handled == 0) "Answer them" else "Keep going · ${items.size - handled} left")
        }
      } else {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          Icon(Icons.Rounded.Check, null, Modifier.size(16.dp), tint = Color(0xFF3DD68C))
          Text("All answered", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }

  openAt?.let { start ->
    TriageSheet(
      title = title, source = source, items = items, order = order, start = start, canAnswer = wid != null,
      onAnswer = answer, onDismiss = { openAt = null },
    )
  }
}

@Composable
private fun Progress(done: Int, total: Int) {
  Box(Modifier.fillMaxWidth().height(3.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
    Box(Modifier.fillMaxHeight().fillMaxWidth(if (total == 0) 0f else done.toFloat() / total).clip(CircleShape).background(Color(0xFF3DD68C)))
  }
}

@Composable
private fun Avatar(item: TItem, size: Int = 34) {
  val q = quadOf(item)
  val bg = when (item.state) { "sent" -> Color(0xFF3DD68C); else -> q.color }
  Box(Modifier.size(size.dp).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
    if (item.state == "sent") Icon(Icons.Rounded.Check, null, Modifier.size((size * 0.5).dp), tint = Color.White)
    else Text(initials(item.from), color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size * 0.36).sp)
  }
}

@Composable
private fun QuadChip(item: TItem) {
  val q = quadOf(item)
  val text = STATE_WORDS[item.state] ?: q.label
  val tint = if (item.state == "sent") Color(0xFF3DD68C) else if (item.state == "failed") MaterialTheme.colorScheme.error else q.color
  Surface(shape = CircleShape, color = tint.copy(alpha = 0.15f)) {
    Text(text, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = tint, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
  }
}

@Composable
private fun TriageRow(item: TItem, selected: Boolean, onClick: () -> Unit) {
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(16.dp),
    color = if (selected) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceContainer,
    modifier = Modifier.fillMaxWidth().alpha(if (item.state == "skipped") 0.55f else 1f),
  ) {
    Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      Avatar(item)
      Column(Modifier.weight(1f)) {
        Text(item.from, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        (item.subject ?: item.preview)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
      }
      QuadChip(item)
    }
  }
}

/* ── The plot ─────────────────────────────────────────────────────── */

private data class Placed(val item: TItem, val x: Float, val y: Float)

/** Each message where its scores put it, nudged off any point it would cover (as Triage.tsx does). */
private fun place(items: List<TItem>, left: Float, top: Float, w: Float, h: Float, r: Float): List<Placed> {
  val out = mutableListOf<Placed>()
  for (item in triageOrder(items)) {
    val bx = left + r + (w - 2 * r) * (item.urgency / 10.0).toFloat()
    val by = top + r + (h - 2 * r) * ((10 - item.importance) / 10.0).toFloat()
    var x = bx
    var y = by
    var a = 0.0
    var k = 1
    while (k < 40 && out.any { hypot(it.x - x, it.y - y) < 2 * r + 3 }) {
      a += 2.4
      x = (bx + cos(a).toFloat() * (4 + k * 3)).coerceIn(left + r, left + w - r)
      y = (by + sin(a).toFloat() * (4 + k * 3)).coerceIn(top + r, top + h - r)
      k += 1
    }
    out += Placed(item, x, y)
  }
  return out
}

@Composable
private fun TriagePlot(items: List<TItem>, selected: String?, onSelect: (String) -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val density = LocalDensity.current
  BoxWithConstraints(Modifier.fillMaxWidth().aspectRatio(1.35f)) {
    val wPx = constraints.maxWidth.toFloat()
    val hPx = constraints.maxHeight.toFloat()
    val band = with(density) { 22.dp.toPx() }
    val r = with(density) { 15.dp.toPx() }
    val top = band
    val plotH = hPx - band * 2
    val cx = wPx / 2
    val cy = top + plotH / 2
    val placed = remember(items, wPx, hPx) { place(items, 0f, top, wPx, plotH, r) }
    val axis = scheme.onSurfaceVariant.copy(alpha = 0.7f)
    Canvas(Modifier.fillMaxSize()) {
      val corner = CornerRadius(14.dp.toPx())
      drawRoundRect(Quad.Plan.color.copy(alpha = 0.09f), Offset(0f, top), Size(cx, cy - top), corner)
      drawRoundRect(Quad.Now.color.copy(alpha = 0.10f), Offset(cx, top), Size(wPx - cx, cy - top), corner)
      drawRoundRect(scheme.onSurface.copy(alpha = 0.04f), Offset(0f, cy), Size(cx, top + plotH - cy), corner)
      drawRoundRect(Quad.Quick.color.copy(alpha = 0.09f), Offset(cx, cy), Size(wPx - cx, top + plotH - cy), corner)
      val stroke = Stroke(width = 1.5.dp.toPx(), cap = StrokeCap.Round)
      drawLine(axis, Offset(4f, cy), Offset(wPx - 2f, cy), stroke.width, StrokeCap.Round)
      drawLine(axis, Offset(cx, top + plotH - 2f), Offset(cx, top + 2f), stroke.width, StrokeCap.Round)
      val a = 7.dp.toPx()
      drawPath(Path().apply { moveTo(wPx - 2f - a, cy - a * 0.8f); lineTo(wPx - 2f, cy); lineTo(wPx - 2f - a, cy + a * 0.8f) }, axis, style = stroke)
      drawPath(Path().apply { moveTo(cx - a * 0.8f, top + 2f + a); lineTo(cx, top + 2f); lineTo(cx + a * 0.8f, top + 2f + a) }, axis, style = stroke)
    }
    val label = MaterialTheme.typography.labelSmall
    Text(Quad.Plan.label.uppercase(), style = label, color = scheme.onSurfaceVariant, modifier = Modifier.align(Alignment.TopStart))
    Text("Importance", style = label, fontWeight = FontWeight.SemiBold, color = scheme.onSurface, modifier = Modifier.align(Alignment.TopCenter))
    Text(Quad.Now.label.uppercase(), style = label, fontWeight = FontWeight.SemiBold, color = Quad.Now.color, modifier = Modifier.align(Alignment.TopEnd))
    Text(Quad.Later.label.uppercase(), style = label, color = scheme.onSurfaceVariant, modifier = Modifier.align(Alignment.BottomStart))
    Text(Quad.Quick.label.uppercase(), style = label, color = scheme.onSurfaceVariant, modifier = Modifier.align(Alignment.BottomEnd))
    Text(
      "Urgency", style = label, fontWeight = FontWeight.SemiBold, color = scheme.onSurface,
      modifier = Modifier.offset { IntOffset((wPx - with(density) { 64.dp.toPx() }).roundToInt(), (cy + with(density) { 6.dp.toPx() }).roundToInt()) },
    )
    val size = with(density) { (r * 2).toDp() }
    placed.forEach { p ->
      val on = p.item.id == selected
      Box(
        Modifier
          .offset { IntOffset((p.x - r).roundToInt(), (p.y - r).roundToInt()) }
          .size(size)
          .alpha(if (p.item.state == "skipped") 0.35f else 1f)
          .then(if (on) Modifier.border(2.dp, scheme.onSurface, CircleShape) else Modifier)
          .clip(CircleShape)
          .clickable { onSelect(p.item.id) }
          .semantics { contentDescription = "${p.item.from}${p.item.subject?.let { ": $it" } ?: ""}, ${quadOf(p.item).label}" },
        contentAlignment = Alignment.Center,
      ) {
        Avatar(p.item, size = if (on) 26 else 30)
      }
    }
  }
}

/* ── The sheet: one message at a time ─────────────────────────────── */

@Composable
private fun TriageSheet(
  title: String?,
  source: String?,
  items: List<TItem>,
  order: List<TItem>,
  start: String,
  canAnswer: Boolean,
  onAnswer: (TItem, String, String?) -> String?,
  onDismiss: () -> Unit,
) {
  val haptics = LocalHaptics.current
  val scheme = MaterialTheme.colorScheme
  var selected by remember { mutableStateOf(start) }
  var next by remember { mutableStateOf<String?>(null) }
  // Yes and No settle a message: a beat to see it land, then the next.
  LaunchedEffect(next) { next?.let { delay(260); selected = it; next = null } }
  val open = items.firstOrNull { it.id == selected }
  Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    Surface(Modifier.fillMaxSize(), color = scheme.surfaceContainerLowest) {
      Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text(title ?: "Messages to answer", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val left = items.count { !settled(it) }
            Text(if (left == 0) "All answered" else "$left of ${items.size} left", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
          }
          FilledTonalIconButton(onClick = { haptics.tick(); onDismiss() }) { Icon(Icons.Rounded.Close, "Close") }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
          if (items.size > PLOT_ABOVE) {
            TriagePlot(items, selected = selected, onSelect = { haptics.click(); selected = it })
            open?.let { item -> TriageMessage(item, source, canAnswer) { d, t -> onAnswer(item, d, t)?.let { if (it != item.id) next = it } } }
          } else {
            order.forEach { item ->
              TriageRow(item, selected = item.id == selected, onClick = { haptics.click(); selected = item.id })
              if (item.id == selected) TriageMessage(item, source, canAnswer, inRow = true) { d, t -> onAnswer(item, d, t)?.let { if (it != item.id) next = it } }
            }
          }
          Spacer(Modifier.height(24.dp))
        }
      }
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TriageMessage(item: TItem, source: String?, canAnswer: Boolean, inRow: Boolean = false, onAnswer: (String, String?) -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val q = quadOf(item)
  var draft by remember(item.id, item.draft) { mutableStateOf(item.draft.orEmpty()) }
  var asking by remember(item.id) { mutableStateOf(false) }
  var ask by remember(item.id) { mutableStateOf("") }
  val state = item.state ?: "open"
  val busy = state == "sending" || state == "changing"
  val done = state == "sent"
  val edited = draft.trim().takeIf { it.isNotEmpty() && it != item.draft.orEmpty().trim() }
  val via = SOURCE_NAME[item.source ?: source]

  Surface(shape = RoundedCornerShape(20.dp), color = scheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      // Under its row in the list, the row already says who and what.
      if (!inRow) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(item, size = 40)
        Column(Modifier.weight(1f)) {
          Text(item.from, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
          listOfNotNull(item.address, via).joinToString(" · ").takeIf { it.isNotEmpty() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
        }
        item.at?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant) }
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Surface(shape = CircleShape, color = q.color.copy(alpha = 0.15f)) {
          Text(q.label, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = q.color, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
        }
        item.why?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterVertically)) }
      }
      if (inRow) listOfNotNull(item.address, via, item.at).joinToString(" · ").takeIf { it.isNotEmpty() }?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      if (!inRow) item.subject?.let { Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
      (item.body ?: item.preview)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant, modifier = Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState())) }
      HorizontalDivider(color = scheme.outlineVariant.copy(alpha = 0.5f))
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(Icons.Rounded.MailOutline, null, Modifier.size(16.dp), tint = scheme.onSurfaceVariant)
        Text(if (item.draft != null) "DEX’s reply" else "No reply needed", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        STATE_WORDS[state]?.let { Text(it, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = if (done) Color(0xFF3DD68C) else if (state == "failed") scheme.error else scheme.onSurfaceVariant) }
      }
      if (item.draft != null || draft.isNotEmpty()) {
        OutlinedTextField(
          value = draft,
          onValueChange = { draft = it },
          readOnly = busy || done,
          modifier = Modifier.fillMaxWidth(),
          textStyle = MaterialTheme.typography.bodyLarge,
          shape = RoundedCornerShape(16.dp),
          minLines = 3,
          maxLines = 10,
        )
      }
      item.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.error) }
      if (!canAnswer) {
        Text("Answer this one on your PC.", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
      } else if (!done) {
        if (asking) {
          OutlinedTextField(
            value = ask,
            onValueChange = { ask = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("What should change? e.g. “say I’ll call at 5”") },
            shape = RoundedCornerShape(16.dp),
            singleLine = false,
            maxLines = 4,
          )
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onAnswer("change", ask.trim()); ask = ""; asking = false }, enabled = ask.isNotBlank()) {
              Icon(Icons.Rounded.Edit, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Redraft")
            }
            TextButton(onClick = { asking = false }) { Text("Cancel") }
          }
        } else {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onAnswer("yes", edited) }, enabled = !busy, modifier = Modifier.heightIn(min = 44.dp)) {
              Icon(Icons.Rounded.Check, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
              Text(if (item.draft != null || draft.isNotBlank()) (if (edited != null) "Send my edit" else "Yes, send") else "Reply anyway")
            }
            FilledTonalButton(onClick = { onAnswer("no", null) }, enabled = !busy && state != "skipped", modifier = Modifier.heightIn(min = 44.dp)) { Text("No") }
            OutlinedButton(onClick = { asking = true }, enabled = !busy, modifier = Modifier.heightIn(min = 44.dp)) { Text("Specify…") }
          }
        }
      }
    }
  }
}
