package com.chethan616.dex.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.ConfirmationNumber
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Directions
import androidx.compose.material.icons.rounded.DirectionsCar
import androidx.compose.material.icons.rounded.Flight
import androidx.compose.material.icons.rounded.Hotel
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Mail
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Payments
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.Restaurant
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.ShoppingCart
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Train
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import com.chethan616.dex.data.Block
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.theme.LocalStatusColors
import com.chethan616.dex.ui.theme.Sizes
import com.chethan616.dex.ui.theme.Space
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * Widgets — DEX's generative UI kit on the phone, the same specs the desktop
 * renders (desktop/app/src/shared/widgets.ts, hub/chat/Widgets.tsx).
 *
 * A question comes with real controls: choice pills, a place with
 * suggestions, a strip of days (and Material's date picker behind "Other"),
 * time slots (and the time picker), a stepper. A one-field question answers
 * in one tap; a form sends with its button. The answer goes out as your next
 * message and the question folds to one quiet line. Results come as cards,
 * link buttons and fact tables.
 */

/** What widgets need from the screen they're on. */
class WidgetHost(
  /** Send text as the user's next message. */
  val reply: (String) -> Unit,
  /** A later message exists after this block: its question was answered. */
  val answered: (Long) -> Boolean,
)

val LocalWidgetHost = staticCompositionLocalOf<WidgetHost?> { null }

/* ── The spec ────────────────────────────────────────────────────────── */

data class WAction(val label: String, val url: String?, val reply: String?, val primary: Boolean, val icon: String?)
data class WOption(val label: String, val detail: String?, val value: String?, val icon: String?)
data class WField(
  val id: String,
  val kind: String,
  val label: String?,
  val optional: Boolean,
  val options: List<WOption> = emptyList(),
  val multi: Boolean = false,
  val other: Boolean = false,
  val suggestions: List<String> = emptyList(),
  val placeholder: String? = null,
  val min: String? = null,
  val max: String? = null,
  val default: String? = null,
  val range: Boolean = false,
  val slots: List<String> = emptyList(),
  val numMin: Double? = null,
  val numMax: Double? = null,
  val step: Double? = null,
  val numDefault: Double? = null,
  val unit: String? = null,
  val multiline: Boolean = false,
)
data class WCard(val title: String, val subtitle: String?, val lines: List<String>, val price: String?, val badge: String?, val icon: String?, val actions: List<WAction>)

sealed interface Widget {
  data class Ask(val title: String, val note: String?, val icon: String?, val fields: List<WField>, val submit: String?) : Widget
  data class Cards(val title: String?, val icon: String?, val items: List<WCard>) : Widget
  data class Buttons(val title: String?, val buttons: List<WAction>) : Widget
  data class Facts(val title: String?, val icon: String?, val rows: List<Pair<String, String>>, val actions: List<WAction>) : Widget
}

private fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) optString(k).takeIf { it.isNotBlank() } else null
private fun JSONObject.num(k: String): Double? = if (has(k) && !isNull(k)) optDouble(k).takeIf { !it.isNaN() } else null
private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it).takeIf { s -> s.isNotBlank() } }

private fun JSONObject.action() = WAction(optString("label"), str("url"), str("reply"), optBoolean("primary"), str("icon"))

/** The desktop has already checked the spec; this only reads it. */
fun parseWidget(json: String?): Widget? = runCatching {
  val o = JSONObject(json ?: return null)
  when (o.optString("type")) {
    "ask" -> Widget.Ask(
      title = o.optString("title"),
      note = o.str("note"),
      icon = o.str("icon"),
      submit = o.str("submit"),
      fields = o.optJSONArray("fields").objects().mapIndexed { i, f ->
        val opts = f.optJSONArray("options")
        WField(
          id = f.str("id") ?: "f${i + 1}",
          kind = f.optString("kind"),
          label = f.str("label"),
          optional = f.optBoolean("optional"),
          options = if (opts == null) emptyList() else (0 until opts.length()).mapNotNull { j ->
            opts.optJSONObject(j)?.let { WOption(it.optString("label"), it.str("detail"), it.str("value"), it.str("icon")) }
              ?: opts.optString(j).takeIf { it.isNotBlank() }?.let { WOption(it, null, null, null) }
          },
          multi = f.optBoolean("multi"),
          other = f.optBoolean("other"),
          suggestions = f.optJSONArray("suggestions").strings(),
          placeholder = f.str("placeholder"),
          min = f.str("min").takeIf { f.optString("kind") == "date" },
          max = f.str("max").takeIf { f.optString("kind") == "date" },
          default = if (f.optString("kind") == "number") null else f.str("default"),
          range = f.optBoolean("range"),
          slots = f.optJSONArray("slots").strings(),
          numMin = f.num("min").takeIf { f.optString("kind") == "number" },
          numMax = f.num("max").takeIf { f.optString("kind") == "number" },
          step = f.num("step"),
          numDefault = f.num("default").takeIf { f.optString("kind") == "number" },
          unit = f.str("unit"),
          multiline = f.optBoolean("multiline"),
        )
      },
    )
    "cards" -> Widget.Cards(o.str("title"), o.str("icon"), o.optJSONArray("items").objects().map { c ->
      WCard(c.optString("title"), c.str("subtitle"), c.optJSONArray("lines").strings(), c.str("price"), c.str("badge"), c.str("icon"), c.optJSONArray("actions").objects().map { it.action() })
    })
    "buttons" -> Widget.Buttons(o.str("title"), o.optJSONArray("buttons").objects().map { it.action() })
    "facts" -> Widget.Facts(
      o.str("title"), o.str("icon"),
      o.optJSONArray("rows").objects().map { it.optString("label") to it.optString("value") },
      o.optJSONArray("actions").objects().map { it.action() },
    )
    else -> null
  }
}.getOrNull()

/* ── Answers (the same wording as shared/widgets.ts's formatAnswer) ──── */

sealed interface Answer {
  data class Choice(val picked: List<String>) : Answer
  data class Words(val text: String) : Answer
  data class Day(val start: String, val end: String? = null) : Answer
  data class Clock(val hhmm: String) : Answer
  data class Num(val n: Double) : Answer
}

private val DAY = DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.UK)
fun formatDay(iso: String): String = runCatching { LocalDate.parse(iso).format(DAY) }.getOrDefault(iso)
fun formatTime(hhmm: String): String {
  val (h, m) = hhmm.split(":").map { it.toIntOrNull() ?: 0 }
  return "${if (h % 12 == 0) 12 else h % 12}:${m.toString().padStart(2, '0')} ${if (h >= 12) "pm" else "am"}"
}
private fun numText(n: Double) = if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()
fun unitFor(unit: String, n: Double): String = if (n == 1.0 && Regex("[^s]s$", RegexOption.IGNORE_CASE).containsMatchIn(unit)) unit.dropLast(1) else unit

private fun valueText(f: WField, a: Answer): String = when (a) {
  is Answer.Choice -> a.picked.joinToString(", ") { p ->
    val o = f.options.firstOrNull { it.label == p }
    if (o?.value != null && o.value != p) "$p (${o.value})" else p
  }
  is Answer.Words -> a.text.trim()
  is Answer.Day -> if (a.end != null) "${formatDay(a.start)} – ${formatDay(a.end)} (${a.start} to ${a.end})" else "${formatDay(a.start)} (${a.start})"
  is Answer.Clock -> "${formatTime(a.hhmm)} (${a.hhmm})"
  is Answer.Num -> numText(a.n) + (f.unit?.let { " ${unitFor(it, a.n)}" } ?: "")
}

fun formatAnswer(w: Widget.Ask, values: Map<String, Answer>): String {
  val parts = w.fields.mapNotNull { f -> values[f.id]?.let { f to valueText(f, it) } }.filter { it.second.isNotBlank() }
  if (w.fields.size == 1) return parts.firstOrNull()?.second.orEmpty()
  return parts.joinToString("\n") { (f, v) -> "${f.label ?: f.id}: $v" }
}

/* ── Glyphs ──────────────────────────────────────────────────────────── */

fun widgetIcon(name: String?): ImageVector = when (name) {
  "flight" -> Icons.Rounded.Flight
  "hotel" -> Icons.Rounded.Hotel
  "food" -> Icons.Rounded.Restaurant
  "place" -> Icons.Rounded.Place
  "directions" -> Icons.Rounded.Directions
  "calendar" -> Icons.Rounded.CalendarMonth
  "time" -> Icons.Rounded.Schedule
  "mail" -> Icons.Rounded.Mail
  "call" -> Icons.Rounded.Call
  "cart" -> Icons.Rounded.ShoppingCart
  "money" -> Icons.Rounded.Payments
  "doc" -> Icons.Rounded.Description
  "code" -> Icons.Rounded.Code
  "music" -> Icons.Rounded.MusicNote
  "person" -> Icons.Rounded.Person
  "ticket" -> Icons.Rounded.ConfirmationNumber
  "car" -> Icons.Rounded.DirectionsCar
  "train" -> Icons.Rounded.Train
  "weather" -> Icons.Rounded.WbSunny
  "pc" -> Icons.Rounded.Computer
  "check" -> Icons.Rounded.Check
  "link" -> Icons.Rounded.Link
  else -> Icons.Rounded.Star
}

private fun actionIcon(a: WAction): ImageVector {
  a.icon?.let { return widgetIcon(it) }
  if (a.reply != null) return Icons.AutoMirrored.Rounded.ArrowForward
  val u = a.url.orEmpty()
  return when {
    u.startsWith("tel:", true) -> Icons.Rounded.Call
    u.startsWith("mailto:", true) -> Icons.Rounded.Mail
    Regex("^geo:|maps\\.google|google\\.[a-z.]+/maps|maps\\.app\\.goo\\.gl", RegexOption.IGNORE_CASE).containsMatchIn(u) -> Icons.Rounded.Directions
    Regex("/travel/flights|flights?\\b", RegexOption.IGNORE_CASE).containsMatchIn(u) -> Icons.Rounded.Flight
    Regex("/travel/hotels|booking\\.com|airbnb", RegexOption.IGNORE_CASE).containsMatchIn(u) -> Icons.Rounded.Hotel
    else -> Icons.Rounded.Link
  }
}

private fun askIcon(w: Widget.Ask): ImageVector = when {
  w.icon != null -> widgetIcon(w.icon)
  w.fields.any { it.kind == "place" } -> Icons.Rounded.Place
  w.fields.any { it.kind == "date" } -> Icons.Rounded.CalendarMonth
  w.fields.any { it.kind == "time" } -> Icons.Rounded.Schedule
  else -> Icons.Rounded.Check
}

/* ── The block ───────────────────────────────────────────────────────── */

@Composable
fun WidgetBlock(block: Block) {
  val widget = remember(block.widget) { parseWidget(block.widget) } ?: return
  val host = LocalWidgetHost.current
  val uri = LocalUriHandler.current
  val haptics = LocalHaptics.current
  val open: (String) -> Unit = { url -> haptics.click(); runCatching { uri.openUri(url) } }
  val reply: (String) -> Unit = { text -> host?.reply?.invoke(text) }
  when (widget) {
    is Widget.Ask -> AskCard(widget, answered = host?.answered?.invoke(block.seq) == true, key = block.seq, reply = reply)
    is Widget.Cards -> CardsCard(widget, open, reply)
    is Widget.Buttons -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      widget.title?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      ActionRow(widget.buttons, open, reply, small = false)
    }
    is Widget.Facts -> FactsCard(widget, open, reply)
  }
}

/** The chat's own card: the filled surface tool cards use, the theme's medium corner, no outline. */
@Composable
private fun WidgetSurface(content: @Composable () -> Unit) {
  Surface(
    shape = MaterialTheme.shapes.medium,
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    modifier = Modifier.fillMaxWidth(),
  ) { content() }
}

/** An icon on an Expressive shape, as Home's quick chips wear theirs. */
@Composable
private fun GlyphTile(icon: ImageVector, size: Int = 36) {
  ShapeBadge(MaterialShapes.Cookie9Sided, MaterialTheme.colorScheme.primaryContainer, size.dp) {
    Icon(icon, null, tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size((size * 0.5f).dp))
  }
}

/** A pill you can pick: tonal when off, the primary container when on, with a springy press. */
@Composable
private fun Pill(text: String, on: Boolean, icon: ImageVector? = null, dashed: Boolean = false, onClick: () -> Unit) {
  val press = remember { MutableInteractionSource() }
  val scheme = MaterialTheme.colorScheme
  val bg by animateColorAsState(if (on) scheme.secondaryContainer else scheme.surfaceContainerHigh, tween(160), label = "pill")
  val fg = if (on) scheme.onSecondaryContainer else scheme.onSurface
  Surface(
    onClick = onClick,
    shape = CircleShape,
    color = if (dashed) Color.Transparent else bg,
    border = if (dashed) BorderStroke(1.dp, scheme.outlineVariant) else null,
    interactionSource = press,
    modifier = Modifier.heightIn(min = Sizes.chip).springPress(press, 0.94f),
  ) {
    Row(Modifier.padding(horizontal = Space.l, vertical = Space.s), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.xs + 2.dp)) {
      icon?.let { Icon(it, null, Modifier.size(16.dp), tint = if (on) fg else MaterialTheme.colorScheme.onSurfaceVariant) }
      Text(text, style = MaterialTheme.typography.labelLarge, color = if (dashed) MaterialTheme.colorScheme.onSurfaceVariant else fg)
      if (on && icon == null) Icon(Icons.Rounded.Check, null, Modifier.size(16.dp), tint = fg)
    }
  }
}

/* ── Ask ─────────────────────────────────────────────────────────────── */

private fun filled(f: WField, a: Answer?): Boolean = when {
  a == null -> false
  f.kind == "date" && f.range -> (a as? Answer.Day)?.end != null
  else -> true
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AskCard(w: Widget.Ask, answered: Boolean, key: Long, reply: (String) -> Unit) {
  val haptics = LocalHaptics.current
  var sent by rememberSaveable(key) { mutableStateOf(false) }
  val values = remember(key) {
    mutableStateMapOf<String, Answer>().apply {
      w.fields.forEach { f ->
        when (f.kind) {
          "number" -> put(f.id, Answer.Num(f.numDefault ?: f.numMin ?: 0.0))
          "date" -> f.default?.let { put(f.id, Answer.Day(it)) }
          "time" -> f.default?.let { put(f.id, Answer.Clock(it)) }
        }
      }
    }
  }
  val solo = w.fields.size == 1
  fun send() {
    val text = formatAnswer(w, values)
    if (text.isBlank()) return
    haptics.send()
    sent = true
    reply(text)
  }

  AnimatedContent(answered || sent, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(160)) }, label = "ask") { done ->
    if (done) {
      Row(Modifier.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val good = LocalStatusColors.current.running
        Surface(shape = CircleShape, color = good.copy(alpha = 0.16f), modifier = Modifier.size(22.dp)) {
          Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Check, null, Modifier.size(14.dp), tint = good) }
        }
        Text(w.title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    } else {
      WidgetSurface {
        Column(Modifier.padding(Space.l), verticalArrangement = Arrangement.spacedBy(Space.l)) {
          Row(horizontalArrangement = Arrangement.spacedBy(Space.m), verticalAlignment = Alignment.CenterVertically) {
            GlyphTile(askIcon(w))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
              Text(w.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
              w.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
          }
          w.fields.forEach { f ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
              if (!solo && f.label != null) {
                Text(
                  f.label + if (f.optional) " · optional" else "",
                  style = MaterialTheme.typography.labelMedium,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
              }
              val onChange: (Answer?, Boolean) -> Unit = { a, commit ->
                // A tap is felt; typing isn't (a tick per letter was the field buzzing).
                if (a !is Answer.Words || commit) haptics.tick()
                if (a == null) values.remove(f.id) else values[f.id] = a
                if (commit && a != null) send()
              }
              when (f.kind) {
                "choice" -> ChoiceInput(f, values[f.id], solo, onChange)
                "place" -> PlaceInput(f, values[f.id], solo, onChange)
                "date" -> DateInput(f, values[f.id], solo, onChange)
                "time" -> TimeInput(f, values[f.id], solo, onChange)
                "number" -> NumberInput(f, values[f.id], solo, onChange)
                else -> WordsInput(f, solo, onChange)
              }
            }
          }
          if (!solo || (w.fields.first().kind == "choice" && w.fields.first().multi)) {
            val ready = w.fields.all { it.optional || filled(it, values[it.id]) }
            Button(onClick = { send() }, enabled = ready, modifier = Modifier.align(Alignment.End).heightIn(min = Sizes.control)) {
              Text(w.submit ?: "Send")
              Spacer(Modifier.width(8.dp))
              Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(18.dp))
            }
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChoiceInput(f: WField, value: Answer?, solo: Boolean, onChange: (Answer?, Boolean) -> Unit) {
  val picked = (value as? Answer.Choice)?.picked ?: emptyList()
  var other by remember { mutableStateOf<String?>(null) }
  fun pick(label: String) {
    if (f.multi) {
      val next = if (label in picked) picked - label else picked + label
      onChange(if (next.isEmpty()) null else Answer.Choice(next), false)
    } else onChange(Answer.Choice(listOf(label)), solo)
  }
  val rich = f.options.any { it.detail != null }
  if (rich) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      f.options.forEach { o ->
        val on = o.label in picked
        val press = remember { MutableInteractionSource() }
        Surface(
          onClick = { pick(o.label) },
          shape = MaterialTheme.shapes.small,
          color = if (on) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
          interactionSource = press,
          modifier = Modifier.fillMaxWidth().springPress(press, 0.98f),
        ) {
          Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            o.icon?.let { Icon(widgetIcon(it), null, Modifier.size(20.dp)) }
            Column(Modifier.weight(1f)) {
              Text(o.label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
              o.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (on) Icon(Icons.Rounded.Check, null, Modifier.size(18.dp))
          }
        }
      }
    }
  } else {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      f.options.forEach { o -> Pill(o.label, o.label in picked, o.icon?.let(::widgetIcon)) { pick(o.label) } }
      if (f.other && other == null) Pill("Something else…", on = false, dashed = true) { other = "" }
    }
  }
  if (f.other && other != null) {
    TypeField(other.orEmpty(), { other = it }, "Say what you'd like", null, send = solo && !f.multi) {
      onChange(Answer.Choice((if (f.multi) picked else emptyList()) + it), solo && !f.multi)
    }
  }
}

@Composable
private fun PlaceInput(f: WField, value: Answer?, solo: Boolean, onChange: (Answer?, Boolean) -> Unit) {
  val current = (value as? Answer.Words)?.text
  var typed by remember { mutableStateOf("") }
  if (f.suggestions.isNotEmpty()) {
    // One swipeable row, like Maps' chips: ragged wrapping reads worse on a phone.
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      f.suggestions.forEach { s -> Pill(s, current == s, Icons.Rounded.Place) { typed = ""; onChange(Answer.Words(s), solo) } }
    }
  }
  TypeField(typed, { typed = it; if (!solo) onChange(if (it.isBlank()) null else Answer.Words(it), false) }, f.placeholder ?: "A city, airport or address", Icons.Rounded.Place, send = solo) {
    onChange(Answer.Words(it), solo)
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateInput(f: WField, value: Answer?, solo: Boolean, onChange: (Answer?, Boolean) -> Unit) {
  val today = LocalDate.now()
  val min = f.min?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: today
  val max = f.max?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
  val from = if (min.isAfter(today)) min else today
  val strip = (0 until 7).map { from.plusDays(it.toLong()) }.filter { max == null || !it.isAfter(max) }
  val sel = value as? Answer.Day
  var rangeStart by remember { mutableStateOf<String?>(null) }
  var picker by remember { mutableStateOf(false) }

  fun pick(day: LocalDate) {
    val iso = day.toString()
    if (!f.range) { onChange(Answer.Day(iso), solo); return }
    val start = rangeStart
    if (start == null || iso < start) { rangeStart = iso; onChange(Answer.Day(iso), false); return }
    rangeStart = null
    onChange(Answer.Day(start, iso), solo)
  }

  Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    strip.forEach { d ->
      val iso = d.toString()
      val on = sel?.start == iso || sel?.end == iso
      val press = remember { MutableInteractionSource() }
      Surface(
        onClick = { pick(d) },
        shape = MaterialTheme.shapes.medium,
        color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh,
        interactionSource = press,
        modifier = Modifier.width(60.dp).springPress(press, 0.94f),
      ) {
        val fg = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
        val dim = if (on) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f) else MaterialTheme.colorScheme.onSurfaceVariant
        Column(Modifier.padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
          Text(
            when (d) { today -> "Today"; today.plusDays(1) -> "Tmrw"; else -> d.format(DateTimeFormatter.ofPattern("EEE", Locale.UK)) },
            style = MaterialTheme.typography.labelSmall, color = dim, maxLines = 1,
          )
          Text(d.dayOfMonth.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = fg)
          Text(d.format(DateTimeFormatter.ofPattern("MMM", Locale.UK)), style = MaterialTheme.typography.labelSmall, color = dim)
        }
      }
    }
    val press = remember { MutableInteractionSource() }
    Surface(
      onClick = { picker = true },
      shape = MaterialTheme.shapes.medium,
      color = Color.Transparent,
      border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
      interactionSource = press,
      modifier = Modifier.width(60.dp).height(78.dp).springPress(press, 0.94f),
    ) {
      Column(verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Other", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
  if (f.range) {
    Text(
      when {
        sel?.end != null -> "${formatDay(sel.start)} → ${formatDay(sel.end)}"
        rangeStart != null -> "From ${formatDay(rangeStart!!)} — now pick the last day"
        else -> "Pick the first day, then the last"
      },
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }

  if (picker) {
    val selectable = object : SelectableDates {
      override fun isSelectableDate(utcTimeMillis: Long): Boolean {
        val d = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
        return !d.isBefore(min) && (max == null || !d.isAfter(max))
      }
    }
    fun LocalDate.millis() = atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    fun Long.day() = Instant.ofEpochMilli(this).atZone(ZoneOffset.UTC).toLocalDate().toString()
    if (f.range) {
      val state = rememberDateRangePickerState(selectableDates = selectable)
      DatePickerDialog(
        onDismissRequest = { picker = false },
        confirmButton = {
          TextButton(enabled = state.selectedStartDateMillis != null && state.selectedEndDateMillis != null, onClick = {
            picker = false
            onChange(Answer.Day(state.selectedStartDateMillis!!.day(), state.selectedEndDateMillis!!.day()), solo)
          }) { Text("Done") }
        },
        dismissButton = { TextButton(onClick = { picker = false }) { Text("Cancel") } },
      ) { DateRangePicker(state, modifier = Modifier.heightIn(max = 520.dp)) }
    } else {
      val state = rememberDatePickerState(initialSelectedDateMillis = sel?.start?.let { runCatching { LocalDate.parse(it).millis() }.getOrNull() }, selectableDates = selectable)
      DatePickerDialog(
        onDismissRequest = { picker = false },
        confirmButton = {
          TextButton(enabled = state.selectedDateMillis != null, onClick = {
            picker = false
            onChange(Answer.Day(state.selectedDateMillis!!.day()), solo)
          }) { Text("Done") }
        },
        dismissButton = { TextButton(onClick = { picker = false }) { Text("Cancel") } },
      ) { DatePicker(state) }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeInput(f: WField, value: Answer?, solo: Boolean, onChange: (Answer?, Boolean) -> Unit) {
  val current = (value as? Answer.Clock)?.hhmm
  var picker by remember { mutableStateOf(false) }
  Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    f.slots.forEach { t -> Pill(formatTime(t), current == t) { onChange(Answer.Clock(t), solo) } }
    val custom = current?.takeIf { it !in f.slots }
    Pill(custom?.let { formatTime(it) } ?: if (f.slots.isEmpty()) "Pick a time" else "Other time", on = custom != null, icon = Icons.Rounded.Schedule) { picker = true }
  }
  if (picker) {
    val (h, m) = (current ?: "19:00").split(":").map { it.toIntOrNull() ?: 0 }
    val state = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = false)
    AlertDialog(
      onDismissRequest = { picker = false },
      confirmButton = {
        TextButton(onClick = {
          picker = false
          onChange(Answer.Clock("${state.hour.toString().padStart(2, '0')}:${state.minute.toString().padStart(2, '0')}"), solo)
        }) { Text("Done") }
      },
      dismissButton = { TextButton(onClick = { picker = false }) { Text("Cancel") } },
      text = { TimePicker(state) },
    )
  }
}

@Composable
private fun NumberInput(f: WField, value: Answer?, solo: Boolean, onChange: (Answer?, Boolean) -> Unit) {
  val min = f.numMin ?: 0.0
  val max = f.numMax ?: 99.0
  val step = f.step ?: 1.0
  val n = (value as? Answer.Num)?.n ?: f.numDefault ?: min
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
      Row(Modifier.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        FilledTonalIconButton(onClick = { onChange(Answer.Num(maxOf(min, n - step)), false) }, enabled = n > min) { Icon(Icons.Rounded.Remove, "Less") }
        Text(
          numText(n) + (f.unit?.let { " ${unitFor(it, n)}" } ?: ""),
          style = MaterialTheme.typography.titleMedium,
          modifier = Modifier.widthIn(min = 88.dp).padding(horizontal = 8.dp),
          textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        FilledTonalIconButton(onClick = { onChange(Answer.Num(minOf(max, n + step)), false) }, enabled = n < max) { Icon(Icons.Rounded.Add, "More") }
      }
    }
    if (solo) {
      Spacer(Modifier.weight(1f))
      Button(onClick = { onChange(Answer.Num(n), true) }) { Text("Send") }
    }
  }
}

@Composable
private fun WordsInput(f: WField, solo: Boolean, onChange: (Answer?, Boolean) -> Unit) {
  var typed by remember { mutableStateOf("") }
  TypeField(typed, { typed = it; if (!solo) onChange(if (it.isBlank()) null else Answer.Words(it), false) }, f.placeholder ?: "Type here", null, send = solo, multiline = f.multiline) {
    onChange(Answer.Words(it), solo)
  }
}

/** A filled field, shaped like the app's prompt bar: no outline, no focus ring. */
@Composable
private fun TypeField(value: String, onValue: (String) -> Unit, placeholder: String, icon: ImageVector?, send: Boolean, multiline: Boolean = false, onSend: (String) -> Unit) {
  val scheme = MaterialTheme.colorScheme
  TextField(
    value = value,
    onValueChange = onValue,
    placeholder = { Text(placeholder) },
    leadingIcon = icon?.let { { Icon(it, null, tint = scheme.onSurfaceVariant) } },
    trailingIcon = if (send) {
      { IconButton(onClick = { if (value.isNotBlank()) onSend(value.trim()) }, enabled = value.isNotBlank()) { Icon(Icons.AutoMirrored.Rounded.Send, "Send") } }
    } else null,
    singleLine = !multiline,
    minLines = if (multiline) 3 else 1,
    shape = if (multiline) MaterialTheme.shapes.medium else CircleShape,
    colors = TextFieldDefaults.colors(
      focusedContainerColor = scheme.surfaceContainerHigh,
      unfocusedContainerColor = scheme.surfaceContainerHigh,
      focusedIndicatorColor = Color.Transparent,
      unfocusedIndicatorColor = Color.Transparent,
      disabledIndicatorColor = Color.Transparent,
    ),
    keyboardOptions = KeyboardOptions(imeAction = if (send && !multiline) ImeAction.Send else ImeAction.Default),
    keyboardActions = KeyboardActions(onSend = { if (value.isNotBlank()) onSend(value.trim()) }),
    modifier = Modifier.fillMaxWidth(),
  )
}

/* ── Show ────────────────────────────────────────────────────────────── */

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActionRow(actions: List<WAction>, open: (String) -> Unit, reply: (String) -> Unit, small: Boolean) {
  FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    actions.forEach { a ->
      val onClick = { if (a.url != null) open(a.url) else if (a.reply != null) reply(a.reply) }
      val padding = if (small) PaddingValues(horizontal = 14.dp, vertical = 6.dp) else ButtonDefaults.ContentPadding
      val content: @Composable () -> Unit = {
        Icon(actionIcon(a), null, Modifier.size(if (small) 16.dp else 18.dp))
        Spacer(Modifier.width(6.dp))
        Text(a.label, maxLines = 1)
        if (a.url != null && !small) {
          Spacer(Modifier.width(6.dp))
          Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(14.dp))
        }
      }
      when {
        a.primary -> Button(onClick = onClick, contentPadding = padding, modifier = Modifier.heightIn(min = if (small) 36.dp else 44.dp)) { content() }
        small -> FilledTonalButton(onClick = onClick, contentPadding = padding, modifier = Modifier.heightIn(min = 36.dp)) { content() }
        else -> FilledTonalButton(onClick = onClick, contentPadding = padding, modifier = Modifier.heightIn(min = 44.dp)) { content() }
      }
    }
  }
}

@Composable
private fun CardHeader(title: String?, icon: String?) {
  if (title == null) return
  Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    icon?.let { Icon(widgetIcon(it), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun CardsCard(w: Widget.Cards, open: (String) -> Unit, reply: (String) -> Unit) {
  WidgetSurface {
    Column {
      CardHeader(w.title, w.icon)
      w.items.forEachIndexed { i, c ->
        if (i > 0 || w.title != null) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GlyphTile(widgetIcon(c.icon ?: w.icon), size = 40)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
              Text(c.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
              c.subtitle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
              c.lines.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (c.price != null || c.badge != null) {
              Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                c.price?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                c.badge?.let {
                  val good = LocalStatusColors.current.running
                  Surface(shape = CircleShape, color = good.copy(alpha = 0.14f)) {
                    Text(it, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = good, modifier = Modifier.padding(horizontal = Space.s, vertical = 3.dp))
                  }
                }
              }
            }
          }
          if (c.actions.isNotEmpty()) Box(Modifier.padding(start = 52.dp)) { ActionRow(c.actions, open, reply, small = true) }
        }
      }
    }
  }
}

@Composable
private fun FactsCard(w: Widget.Facts, open: (String) -> Unit, reply: (String) -> Unit) {
  WidgetSurface {
    Column {
      CardHeader(w.title, w.icon)
      Column(Modifier.padding(horizontal = 16.dp)) {
        w.rows.forEachIndexed { i, (label, value) ->
          if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
          Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.4f))
            Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(0.6f))
          }
        }
      }
      if (w.actions.isNotEmpty()) Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp, top = 4.dp)) { ActionRow(w.actions, open, reply, small = true) }
      else Spacer(Modifier.height(6.dp))
    }
  }
}
