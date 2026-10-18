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
import androidx.compose.ui.graphics.luminance
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
import com.chethan616.dex.ui.theme.LocalStatusColors
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
  /** What it's about: academics, work, personal or other — its lane in the quadrant. */
  val category: String = "other",
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
    category = o.s("category")?.takeIf { it in CATEGORIES } ?: "other",
  )
}

/** The lanes, in the desktop's order (shared/triage.ts TRIAGE_CATEGORIES). */
internal val CATEGORIES = listOf("academics", "work", "personal", "other")
private val CATEGORY_LABELS = mapOf("academics" to "Academics", "work" to "Work", "personal" to "Personal", "other" to "Other")

/** The categories a card's messages have, in order: its quadrants' lanes. */
internal fun lanesOf(items: List<TItem>): List<String> = CATEGORIES.filter { c -> items.any { it.category == c } }

/* ── The four corners (the same split as shared/triage.ts) ─────────── */

internal enum class Quad(val label: String, val short: String) {
  Now("Reply now", "Reply now"),
  Quick("Quick reply", "Quick"),
  Plan("Plan a reply", "Plan"),
  Later("Later", "Later"),
}

/** A corner's colour: priority, from the status colours the desktop shares (theme.global.css). */
@Composable
private fun quadColor(q: Quad): Color {
  val status = LocalStatusColors.current
  return when (q) {
    Quad.Now -> status.stuck
    Quad.Quick -> status.idle
    Quad.Plan -> status.paused
    Quad.Later -> MaterialTheme.colorScheme.onSurfaceVariant
  }
}

/** A category's fill and the ink on it, from the app's scheme — the same roles as the desktop's. */
@Composable
private fun catColors(category: String): Pair<Color, Color> {
  val scheme = MaterialTheme.colorScheme
  val status = LocalStatusColors.current
  val fill = when (category) {
    "academics" -> scheme.primary
    "work" -> status.idle
    "personal" -> scheme.tertiary
    else -> scheme.outline
  }
  return fill to inkOn(fill)
}

/** Dark text on a light fill, white on a dark one: the light theme's status colours are dark, the dark theme's light. */
private fun inkOn(fill: Color): Color = if (fill.luminance() > 0.4f) Color(0xFF1B1B1F) else Color.White

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
          Icon(Icons.Rounded.Check, null, Modifier.size(16.dp), tint = LocalStatusColors.current.running)
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
    Box(Modifier.fillMaxHeight().fillMaxWidth(if (total == 0) 0f else done.toFloat() / total).clip(CircleShape).background(LocalStatusColors.current.running))
  }
}

@Composable
private fun Avatar(item: TItem, size: Int = 34) {
  val (fill, ink) = catColors(item.category)
  val sent = item.state == "sent"
  val bg = if (sent) LocalStatusColors.current.running else fill
  Box(Modifier.size(size.dp).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
    if (sent) Icon(Icons.Rounded.Check, null, Modifier.size((size * 0.5).dp), tint = inkOn(bg))
    else Text(initials(item.from), color = ink, fontWeight = FontWeight.Bold, fontSize = (size * 0.36).sp, maxLines = 1)
  }
}

@Composable
private fun QuadChip(item: TItem) {
  val q = quadOf(item)
  val text = STATE_WORDS[item.state] ?: q.label
  val tint = if (item.state == "sent") LocalStatusColors.current.running else if (item.state == "failed") MaterialTheme.colorScheme.error else quadColor(q)
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
private data class Box4(val x: Float, val y: Float, val w: Float, val h: Float)

/** Where each corner sits in the plot (plan and now on top), in pixels. */
private fun corner(q: Quad, w: Float, top: Float, plotH: Float, gap: Float): Box4 {
  val qw = (w - gap) / 2
  val qh = (plotH - gap) / 2
  val right = q == Quad.Now || q == Quad.Quick
  val upper = q == Quad.Plan || q == Quad.Now
  return Box4(if (right) qw + gap else 0f, top + if (upper) 0f else qh + gap, qw, qh)
}

/** One category's lane in a corner: a small plot of its own, the same axes. */
private fun lane(c: Box4, i: Int, n: Int, head: Float, inset: Float): Box4 {
  val lw = (c.w - inset * 2) / n
  return Box4(c.x + inset + i * lw, c.y + head, lw, c.h - head - inset)
}

/**
 * Each message in its corner's lane for its category, where its scores put it
 * within the corner, nudged off any point it would cover without leaving the
 * lane (as Triage.tsx does).
 */
private fun place(items: List<TItem>, lanes: List<String>, w: Float, top: Float, plotH: Float, gap: Float, head: Float, inset: Float, r: Float): List<Placed> {
  val out = mutableListOf<Placed>()
  val n = maxOf(1, lanes.size)
  for (item in triageOrder(items)) {
    val b = lane(corner(quadOf(item), w, top, plotH, gap), maxOf(0, lanes.indexOf(item.category)), n, head, inset)
    val fu = ((item.urgency - if (item.urgency >= 5) 5.0 else 0.0) / 5.0).coerceIn(0.0, 1.0).toFloat()
    val fi = ((item.importance - if (item.importance >= 5) 5.0 else 0.0) / 5.0).coerceIn(0.0, 1.0).toFloat()
    val minX = b.x + r
    val maxX = maxOf(minX, b.x + b.w - r)
    val minY = b.y + r
    val maxY = maxOf(minY, b.y + b.h - r)
    val bx = minX + (maxX - minX) * fu
    val by = minY + (maxY - minY) * (1 - fi)
    var x = bx
    var y = by
    var a = 0.0
    var k = 1
    while (k < 48 && out.any { hypot(it.x - x, it.y - y) < 2 * r + 2 }) {
      a += 2.4
      x = (bx + cos(a).toFloat() * (3 + k * 2.5f)).coerceIn(minX, maxX)
      y = (by + sin(a).toFloat() * (3 + k * 2.5f)).coerceIn(minY, maxY)
      k += 1
    }
    out += Placed(item, x, y)
  }
  return out
}

/** The categories with their colours and counts — what the lanes' colour keys mean. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend(items: List<TItem>, lanes: List<String>) {
  FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    lanes.forEach { c ->
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(catColors(c).first))
        Text(CATEGORY_LABELS[c] ?: c, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("${items.count { it.category == c }}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.outline)
      }
    }
  }
}

@Composable
private fun TriagePlot(items: List<TItem>, selected: String?, onSelect: (String) -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val density = LocalDensity.current
  val lanes = remember(items) { lanesOf(items) }
  val n = maxOf(1, lanes.size)
  val colors = CATEGORIES.associateWith { catColors(it).first }
  val quads = Quad.entries.associateWith { quadColor(it) }
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (lanes.size > 1) Legend(items, lanes)
    // Compact on a phone: a little taller than wide, so each lane keeps room for its points.
    BoxWithConstraints(Modifier.fillMaxWidth().aspectRatio(1.08f)) {
      val wPx = constraints.maxWidth.toFloat()
      val hPx = constraints.maxHeight.toFloat()
      val padT = with(density) { 16.dp.toPx() }
      val padB = with(density) { 16.dp.toPx() }
      val gap = with(density) { 8.dp.toPx() }
      val head = with(density) { 20.dp.toPx() }
      val inset = with(density) { 4.dp.toPx() }
      val r = with(density) { 11.dp.toPx() }
      val plotH = hPx - padT - padB
      val cx = wPx / 2
      val cy = padT + plotH / 2
      val placed = remember(items, lanes, wPx, hPx) { place(items, lanes, wPx, padT, plotH, gap, head, inset, r) }
      val axis = scheme.outline
      val panel = scheme.surfaceContainerHigh
      val divider = scheme.outlineVariant.copy(alpha = 0.6f)
      Canvas(Modifier.fillMaxSize()) {
        val round = CornerRadius(12.dp.toPx())
        Quad.entries.forEach { q ->
          val c = corner(q, wPx, padT, plotH, gap)
          val fill = if (q == Quad.Now) quads.getValue(q).copy(alpha = 0.12f) else panel.copy(alpha = 0.55f)
          drawRoundRect(fill, Offset(c.x, c.y), Size(c.w, c.h), round)
          if (lanes.size > 1) {
            lanes.forEachIndexed { i, cat ->
              val b = lane(c, i, n, head, inset)
              drawRoundRect(colors.getValue(cat).copy(alpha = 0.6f), Offset(b.x + 2.dp.toPx(), b.y - 3.dp.toPx()), Size(maxOf(0f, b.w - 4.dp.toPx()), 2.dp.toPx()), CornerRadius(1.dp.toPx()))
              if (i > 0) drawLine(divider, Offset(b.x, b.y + 2.dp.toPx()), Offset(b.x, b.y + b.h), 1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())))
            }
          }
        }
        val stroke = Stroke(width = 1.4.dp.toPx(), cap = StrokeCap.Round)
        drawLine(axis, Offset(2f, cy), Offset(wPx - 2f, cy), stroke.width, StrokeCap.Round)
        drawLine(axis, Offset(cx, padT + plotH), Offset(cx, padT - 4.dp.toPx()), stroke.width, StrokeCap.Round)
        val a = 6.dp.toPx()
        drawPath(Path().apply { moveTo(wPx - 2f - a, cy - a * 0.8f); lineTo(wPx - 2f, cy); lineTo(wPx - 2f - a, cy + a * 0.8f) }, axis, style = stroke)
        drawPath(Path().apply { moveTo(cx - a * 0.8f, padT - 4.dp.toPx() + a); lineTo(cx, padT - 4.dp.toPx()); lineTo(cx + a * 0.8f, padT - 4.dp.toPx() + a) }, axis, style = stroke)
      }
      val label = MaterialTheme.typography.labelSmall
      // Each corner's name and count, inside it.
      Quad.entries.forEach { q ->
        val c = corner(q, wPx, padT, plotH, gap)
        val count = items.count { quadOf(it) == q }
        Row(
          Modifier.offset { IntOffset((c.x + with(density) { 8.dp.toPx() }).roundToInt(), (c.y + with(density) { 4.dp.toPx() }).roundToInt()) }
            .width(with(density) { (c.w - 16.dp.toPx()).toDp() }),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text(q.short.uppercase(), style = label, fontSize = 9.sp, fontWeight = FontWeight.Bold, color = quads.getValue(q), maxLines = 1, modifier = Modifier.weight(1f))
          if (count > 0) Text("$count", style = label, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = scheme.outline)
        }
      }
      Text("Importance", style = label, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant,
        modifier = Modifier.offset { IntOffset((cx + with(density) { 8.dp.toPx() }).roundToInt(), 0) })
      Text("Urgency →", style = label, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant, modifier = Modifier.align(Alignment.BottomEnd))
      val dot = with(density) { (r * 2).toDp() }
      placed.forEach { p ->
        val on = p.item.id == selected
        Box(
          Modifier
            .offset { IntOffset((p.x - r).roundToInt(), (p.y - r).roundToInt()) }
            .size(dot)
            .alpha(if (p.item.state == "skipped") 0.35f else 1f)
            .then(if (on) Modifier.border(2.dp, scheme.onSurface, CircleShape) else Modifier)
            .clip(CircleShape)
            .clickable { onSelect(p.item.id) }
            .semantics { contentDescription = "${p.item.from}${p.item.subject?.let { ": $it" } ?: ""}, ${quadOf(p.item).label}, ${CATEGORY_LABELS[p.item.category]}" },
          contentAlignment = Alignment.Center,
        ) {
          Avatar(p.item, size = if (on) 18 else 22)
        }
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
        val qc = quadColor(q)
        Surface(shape = CircleShape, color = qc.copy(alpha = 0.15f)) {
          Text(q.label, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = qc, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
        }
        Surface(shape = CircleShape, color = scheme.surfaceContainerHighest) {
          Row(Modifier.padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(catColors(item.category).first))
            Text(CATEGORY_LABELS[item.category] ?: "Other", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant)
          }
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
        STATE_WORDS[state]?.let { Text(it, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = if (done) LocalStatusColors.current.running else if (state == "failed") scheme.error else scheme.onSurfaceVariant) }
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
