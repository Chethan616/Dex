package com.chethan616.dex.ui.components

import androidx.compose.animation.Crossfade
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
import androidx.compose.foundation.selection.toggleable
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
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
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
 * as the PC's updates arrive. Tap a corner of the plot and the sheet opens on
 * that corner, one small plot per category.
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
  /** What it's about: academics, work, personal or other — its colour, and its own small plot when a corner opens. */
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

/** The categories, in the desktop's order (shared/triage.ts TRIAGE_CATEGORIES). */
internal val CATEGORIES = listOf("academics", "work", "personal", "other")
private val CATEGORY_LABELS = mapOf("academics" to "Academics", "work" to "Work", "personal" to "Personal", "other" to "Other")

/** The categories a card's messages have, in order: the legend, and the small plots of an opened corner. */
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

/** A corner's scores: urgency from, to; importance from, to (shared/triage.ts cornerRange). */
internal fun cornerRange(q: Quad): List<Double> {
  val urgent = q == Quad.Now || q == Quad.Quick
  val important = q == Quad.Now || q == Quad.Plan
  return listOf(if (urgent) 5.0 else 0.0, if (urgent) 10.0 else 5.0, if (important) 5.0 else 0.0, if (important) 10.0 else 5.0)
}

/** Where a message sits inside its corner, 0–1 each way: its exact scores, nothing else (shared/triage.ts withinCorner). */
internal fun withinCorner(i: TItem): Pair<Float, Float> {
  val (uLo, uHi, iLo, iHi) = cornerRange(quadOf(i))
  return ((i.urgency - uLo) / (uHi - uLo)).coerceIn(0.0, 1.0).toFloat() to ((i.importance - iLo) / (iHi - iLo)).coerceIn(0.0, 1.0).toFloat()
}

private fun num(d: Double): String = if (d % 1.0 == 0.0) d.toInt().toString() else "%.1f".format(d).trimEnd('0').trimEnd('.')

/** "Urgency 9 · Importance 8": a message's scores in words. */
internal fun scores(i: TItem): String = "Urgency ${num(i.urgency)} · Importance ${num(i.importance)}"

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
  val lanes = lanesOf(items)
  var openAt by remember { mutableStateOf<String?>(null) }
  var openOn by remember { mutableStateOf<Quad?>(null) }
  var focus by remember { mutableStateOf<String?>(null) }
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
        if (lanes.size > 1) Legend(items, lanes, focus) { haptics.tick(); focus = it }
        Overview(
          items, selected = null, focus = focus,
          onSelect = { haptics.click(); openOn = null; openAt = it },
          onZoom = { q -> haptics.click(); openOn = q; openAt = (order.firstOrNull { quadOf(it) == q && !settled(it) } ?: order.first { quadOf(it) == q }).id },
        )
        Text("Tap a corner to see it by category, or a point to answer it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      } else {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
          order.forEach { item -> TriageRow(item, selected = false, onClick = { haptics.click(); openAt = item.id }) }
        }
      }
      val first = order.firstOrNull { !settled(it) }
      if (first != null) {
        Button(onClick = { haptics.click(); openOn = null; openAt = first.id }, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp), shapes = androidx.compose.material3.ButtonDefaults.shapes()) {
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
      title = title, source = source, items = items, order = order, start = start, startOn = openOn, canAnswer = wid != null,
      focus = focus, onFocus = { focus = it }, onAnswer = answer, onDismiss = { openAt = null },
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
    modifier = Modifier.fillMaxWidth().squishOnPress(0.97f).alpha(if (item.state == "skipped") 0.55f else 1f),
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

/*
 * Two levels, as on the desktop (Triage.tsx). The overview is honest: each
 * message sits exactly where its urgency (across) and importance (up) put it
 * in its corner, and its colour says what it's about — a category never moves
 * a point. Tap a corner and it opens as one small plot per category, the same
 * axes with real numbers on them.
 */

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

/** Each message where its scores put it in its box, nudged off any point it would cover without leaving the box (as Triage.tsx does). */
private fun spread(items: List<TItem>, boxOf: (TItem) -> Box4, r: Float): List<Placed> {
  val out = mutableListOf<Placed>()
  for (item in triageOrder(items)) {
    val b = boxOf(item)
    val (fu, fi) = withinCorner(item)
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

/** The categories on the card, as filters: one on fades the rest, in every view. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend(items: List<TItem>, lanes: List<String>, focus: String?, onFocus: (String?) -> Unit) {
  val scheme = MaterialTheme.colorScheme
  FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    lanes.forEach { c ->
      val fill = catColors(c).first
      val on = focus == c
      Row(
        Modifier
          .clip(CircleShape)
          .background(if (on) fill.copy(alpha = 0.2f) else scheme.surfaceContainerHighest.copy(alpha = 0.7f))
          .then(if (on) Modifier.border(1.dp, fill.copy(alpha = 0.7f), CircleShape) else Modifier)
          // One toggle to a screen reader too: "Personal, 3, checked".
          .toggleable(value = on, role = Role.Checkbox) { onFocus(if (on) null else c) }
          .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
      ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(fill))
        Text(CATEGORY_LABELS[c] ?: c, style = MaterialTheme.typography.labelMedium, color = if (on) scheme.onSurface else scheme.onSurfaceVariant)
        Text("${items.count { it.category == c }}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = scheme.outline)
      }
    }
  }
}

/** A message on a plot: its initials in its category's colour, a tick once sent. */
@Composable
private fun PlotPoint(p: Placed, rDp: Int, on: Boolean, dim: Boolean, onSelect: (String) -> Unit) {
  val density = LocalDensity.current
  val r = with(density) { rDp.dp.toPx() }
  Box(
    Modifier
      .offset { IntOffset((p.x - r).roundToInt(), (p.y - r).roundToInt()) }
      .size((rDp * 2).dp)
      .alpha(if (dim) 0.18f else if (p.item.state == "skipped") 0.35f else 1f)
      .then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
      .clip(CircleShape)
      .clickable { onSelect(p.item.id) }
      .semantics { contentDescription = "${p.item.from}${p.item.subject?.let { ": $it" } ?: ""}, ${quadOf(p.item).label}, ${scores(p.item)}, ${CATEGORY_LABELS[p.item.category]}" },
    contentAlignment = Alignment.Center,
  ) {
    Avatar(p.item, size = if (on) rDp * 2 - 4 else rDp * 2)
  }
}

/** All four corners: where each message is, and what each corner is mostly about. */
@Composable
private fun Overview(items: List<TItem>, selected: String?, focus: String?, onSelect: (String) -> Unit, onZoom: (Quad) -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val density = LocalDensity.current
  val colors = CATEGORIES.associateWith { catColors(it).first }
  val quads = Quad.entries.associateWith { quadColor(it) }
  // Compact on a phone: a little taller than wide.
  BoxWithConstraints(Modifier.fillMaxWidth().aspectRatio(1.08f)) {
    val wPx = constraints.maxWidth.toFloat()
    val hPx = constraints.maxHeight.toFloat()
    fun px(d: Dp) = with(density) { d.toPx() }
    val padT = px(16.dp)
    val gap = px(8.dp)
    val head = px(28.dp)
    val inset = px(6.dp)
    val rDp = 11
    val r = px(rDp.dp)
    val plotH = hPx - padT - px(16.dp)
    val cx = wPx / 2
    val cy = padT + plotH / 2
    val placed = remember(items, wPx, hPx) {
      spread(items, { val c = corner(quadOf(it), wPx, padT, plotH, gap); Box4(c.x + inset, c.y + head, c.w - inset * 2, c.h - head - inset) }, r)
    }
    val axis = scheme.outline
    val panel = scheme.surfaceContainerHigh
    val empty = scheme.outlineVariant.copy(alpha = 0.35f)
    Canvas(Modifier.fillMaxSize()) {
      val round = CornerRadius(12.dp.toPx())
      Quad.entries.forEach { q ->
        val c = corner(q, wPx, padT, plotH, gap)
        drawRoundRect(if (q == Quad.Now) quads.getValue(q).copy(alpha = 0.12f) else panel.copy(alpha = 0.55f), Offset(c.x, c.y), Size(c.w, c.h), round)
        // The corner's mix of categories, one thin bar.
        val inQ = items.filter { quadOf(it) == q }
        val bx = c.x + 8.dp.toPx()
        val bw = c.w - 16.dp.toPx()
        val by = c.y + 19.dp.toPx()
        val bh = 3.dp.toPx()
        if (inQ.isEmpty()) drawRoundRect(empty, Offset(bx, by), Size(bw, bh), CornerRadius(bh / 2))
        var at = bx
        CATEGORIES.map { cat -> cat to inQ.count { it.category == cat } }.filter { it.second > 0 }.forEachIndexed { i, (cat, n) ->
          val pw = bw * n / inQ.size
          val gapPx = if (i > 0) 1.5.dp.toPx() else 0f
          drawRoundRect(colors.getValue(cat).copy(alpha = 0.85f), Offset(at + gapPx, by), Size(maxOf(0f, pw - gapPx), bh), CornerRadius(bh / 2))
          at += pw
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
    // Each corner: its name and count, and the whole of it a tap that opens it.
    Quad.entries.forEach { q ->
      val c = corner(q, wPx, padT, plotH, gap)
      val count = items.count { quadOf(it) == q }
      Box(
        Modifier
          .offset { IntOffset(c.x.roundToInt(), c.y.roundToInt()) }
          .size(with(density) { c.w.toDp() }, with(density) { c.h.toDp() })
          .clip(RoundedCornerShape(12.dp))
          .then(if (count > 0) Modifier.clickable { onZoom(q) }.semantics { contentDescription = "Open ${q.label}: $count message${if (count == 1) "" else "s"}, by category" } else Modifier),
      ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(q.short.uppercase(), style = label, fontSize = 9.sp, fontWeight = FontWeight.Bold, color = quads.getValue(q), maxLines = 1, modifier = Modifier.weight(1f))
          if (count > 0) Text("$count ›", style = label, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = scheme.outline)
        }
      }
    }
    Text("Importance", style = label, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant,
      modifier = Modifier.offset { IntOffset((cx + px(8.dp)).roundToInt(), 0) })
    Text("Urgency →", style = label, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant, modifier = Modifier.align(Alignment.BottomEnd))
    placed.forEach { p -> PlotPoint(p, rDp, on = p.item.id == selected, dim = focus != null && p.item.category != focus, onSelect = onSelect) }
  }
}

/** One corner, opened: a small plot per category on the card, two to a row, each on the corner's own axes. */
@Composable
private fun Breakdown(q: Quad, items: List<TItem>, lanes: List<String>, selected: String?, focus: String?, onSelect: (String) -> Unit) {
  val cats = lanes.ifEmpty { listOf("other") }
  val inQ = items.filter { quadOf(it) == q }
  val (uLo, uHi, iLo, iHi) = cornerRange(q)
  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (cats.size == 1) {
      MiniPlot(cats[0], q, inQ, selected, dim = false, onSelect = onSelect, plotHeight = 210.dp)
    } else {
      cats.chunked(2).forEach { row ->
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          row.forEach { c ->
            Box(Modifier.weight(1f)) { MiniPlot(c, q, inQ.filter { it.category == c }, selected, dim = focus != null && focus != c, onSelect = onSelect, plotHeight = 140.dp) }
          }
          if (row.size == 1) Spacer(Modifier.weight(1f))
        }
      }
    }
    Text(
      "In each: urgency ${num(uLo)}–${num(uHi)} across, importance ${num(iLo)}–${num(iHi)} up",
      style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
    )
  }
}

@Composable
private fun MiniPlot(cat: String, q: Quad, items: List<TItem>, selected: String?, dim: Boolean, onSelect: (String) -> Unit, plotHeight: Dp) {
  val scheme = MaterialTheme.colorScheme
  val density = LocalDensity.current
  val fill = catColors(cat).first
  val measurer = rememberTextMeasurer()
  val tick = TextStyle(fontSize = 9.sp, color = scheme.onSurfaceVariant)
  val none = TextStyle(fontSize = 11.sp, color = scheme.outline)
  val grid = scheme.outlineVariant.copy(alpha = 0.45f)
  val (uLo, uHi, iLo, iHi) = cornerRange(q)
  Column(Modifier.alpha(if (dim) 0.4f else 1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Box(Modifier.size(8.dp).clip(CircleShape).background(fill))
      Text(CATEGORY_LABELS[cat] ?: cat, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 1)
      Text("${items.size}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = scheme.outline)
    }
    BoxWithConstraints(Modifier.fillMaxWidth().height(plotHeight + 14.dp)) {
      val wPx = constraints.maxWidth.toFloat()
      fun px(d: Dp) = with(density) { d.toPx() }
      val left = px(18.dp)
      val rDp = 12
      val r = px(rDp.dp)
      val box = Box4(left, 0f, wPx - left, px(plotHeight))
      val placed = remember(items, wPx) { spread(items, { box }, r) }
      Canvas(Modifier.fillMaxSize()) {
        val round = CornerRadius(10.dp.toPx())
        drawRoundRect(fill.copy(alpha = 0.07f), Offset(box.x, box.y), Size(box.w, box.h), round)
        drawRoundRect(fill.copy(alpha = 0.35f), Offset(box.x, box.y), Size(box.w, box.h), round, style = Stroke(1.dp.toPx()))
        val dash = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 4.dp.toPx()))
        listOf(0.25f, 0.5f, 0.75f).forEach { t ->
          drawLine(grid, Offset(box.x + box.w * t, box.y + 4.dp.toPx()), Offset(box.x + box.w * t, box.y + box.h - 4.dp.toPx()), 1.dp.toPx(), pathEffect = dash)
          drawLine(grid, Offset(box.x + 4.dp.toPx(), box.y + box.h * t), Offset(box.x + box.w - 4.dp.toPx(), box.y + box.h * t), 1.dp.toPx(), pathEffect = dash)
        }
        // Real numbers on both axes, where a point at that score would sit.
        listOf(0f, 0.5f, 1f).forEach { t ->
          val u = measurer.measure(num(uLo + (uHi - uLo) * t), tick)
          drawText(u, topLeft = Offset(box.x + r + (box.w - 2 * r) * t - u.size.width / 2f, box.h + 2.dp.toPx()))
          val i = measurer.measure(num(iLo + (iHi - iLo) * t), tick)
          drawText(i, topLeft = Offset(left - 3.dp.toPx() - i.size.width, box.y + r + (box.h - 2 * r) * (1 - t) - i.size.height / 2f))
        }
        if (items.isEmpty()) {
          val n = measurer.measure("None", none)
          drawText(n, topLeft = Offset(box.x + (box.w - n.size.width) / 2f, box.y + (box.h - n.size.height) / 2f))
        }
      }
      placed.forEach { p -> PlotPoint(p, rDp, on = p.item.id == selected, dim = false, onSelect = onSelect) }
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
  startOn: Quad?,
  canAnswer: Boolean,
  focus: String?,
  onFocus: (String?) -> Unit,
  onAnswer: (TItem, String, String?) -> String?,
  onDismiss: () -> Unit,
) {
  val haptics = LocalHaptics.current
  val scheme = MaterialTheme.colorScheme
  val lanes = lanesOf(items)
  var selected by remember { mutableStateOf(start) }
  var zoom by remember { mutableStateOf(startOn) }
  var next by remember { mutableStateOf<String?>(null) }
  // Yes and No settle a message: a beat to see it land, then the next — in the opened corner while it has one.
  LaunchedEffect(next) { next?.let { delay(260); selected = it; next = null } }
  val open = items.firstOrNull { it.id == selected }
  val answered: (TItem, String, String?) -> Unit = { item, d, t ->
    onAnswer(item, d, t)?.let { after ->
      if (after != item.id) next = order.firstOrNull { it.id != item.id && !settled(it) && zoom != null && quadOf(it) == zoom }?.id ?: after
    }
  }
  // Back from an opened corner goes to all four first.
  Dialog(onDismissRequest = { if (zoom != null) zoom = null else onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    Surface(Modifier.fillMaxSize(), color = scheme.surfaceContainerLowest) {
      Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text(title ?: "Messages to answer", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val left = items.count { !settled(it) }
            Text(if (left == 0) "All answered" else "$left of ${items.size} left", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
          }
          FilledTonalIconButton(onClick = { haptics.tick(); onDismiss() }, shapes = androidx.compose.material3.IconButtonDefaults.shapes()) { Icon(Icons.Rounded.Close, "Close") }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
          if (items.size > PLOT_ABOVE) {
            Row(Modifier.heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              val at = zoom
              if (at != null) {
                FilledTonalButton(onClick = { haptics.tick(); zoom = null }, modifier = Modifier.height(32.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp), shapes = androidx.compose.material3.ButtonDefaults.shapes()) {
                  Text("‹ All corners", style = MaterialTheme.typography.labelLarge)
                }
                Text(at.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = quadColor(at).takeIf { at != Quad.Later } ?: scheme.onSurface)
              } else {
                Text("Tap a corner to see it by category", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
              }
            }
            if (lanes.size > 1) Legend(items, lanes, focus) { haptics.tick(); onFocus(it) }
            Crossfade(targetState = zoom, label = "corner") { at ->
              if (at != null) Breakdown(at, items, lanes, selected, focus) { haptics.click(); selected = it }
              else Overview(items, selected, focus, onSelect = { haptics.click(); selected = it }, onZoom = { haptics.click(); zoom = it })
            }
            open?.let { item -> TriageMessage(item, source, canAnswer) { d, t -> answered(item, d, t) } }
          } else {
            order.forEach { item ->
              TriageRow(item, selected = item.id == selected, onClick = { haptics.click(); selected = item.id })
              if (item.id == selected) TriageMessage(item, source, canAnswer, inRow = true) { d, t -> answered(item, d, t) }
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
        Text(scores(item), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterVertically))
      }
      item.why?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant) }
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
            Button(onClick = { onAnswer("change", ask.trim()); ask = ""; asking = false }, enabled = ask.isNotBlank(), shapes = androidx.compose.material3.ButtonDefaults.shapes()) {
              Icon(Icons.Rounded.Edit, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Redraft")
            }
            TextButton(onClick = { asking = false }, shapes = androidx.compose.material3.ButtonDefaults.shapes()) { Text("Cancel") }
          }
        } else {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onAnswer("yes", edited) }, enabled = !busy, modifier = Modifier.heightIn(min = 44.dp), shapes = androidx.compose.material3.ButtonDefaults.shapes()) {
              Icon(Icons.Rounded.Check, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
              Text(if (item.draft != null || draft.isNotBlank()) (if (edited != null) "Send my edit" else "Yes, send") else "Reply anyway")
            }
            FilledTonalButton(onClick = { onAnswer("no", null) }, enabled = !busy && state != "skipped", modifier = Modifier.heightIn(min = 44.dp), shapes = androidx.compose.material3.ButtonDefaults.shapes()) { Text("No") }
            OutlinedButton(onClick = { asking = true }, enabled = !busy, modifier = Modifier.heightIn(min = 44.dp), shapes = androidx.compose.material3.ButtonDefaults.shapes()) { Text("Specify…") }
          }
        }
      }
    }
  }
}
