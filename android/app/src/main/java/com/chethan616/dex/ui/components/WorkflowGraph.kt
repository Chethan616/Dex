package com.chethan616.dex.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountTree
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.HourglassEmpty
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.QuestionAnswer
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.WebAsset
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.chethan616.dex.ui.haptics.LocalHaptics
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/*
 * Workflows on the phone: the cards `/workflow` (or `dex-workflow show`) puts
 * in the chat, and View's graph — the same as the desktop's
 * (desktop/app/src/renderer/hub/workflows/), from the same widget JSON.
 *
 * The graph is the desktop's snake layout (layout.ts), one column at phone
 * width. Fluid first: pan and zoom are read only in the layer and draw
 * phases (graphicsLayer, drawBehind, Canvas), never in composition.
 */

data class WStep(val id: String, val kind: String, val title: String, val detail: String?)
data class WTrigger(val kind: String, val time: String?, val days: List<String>)
data class WWorkflow(val id: String, val name: String, val description: String?, val trigger: WTrigger, val steps: List<WStep>, val enabled: Boolean)

private fun JSONObject.text(k: String): String? = if (has(k) && !isNull(k)) optString(k).takeIf { it.isNotBlank() } else null

internal fun parseWorkflow(o: JSONObject): WWorkflow? {
  val t = o.optJSONObject("trigger") ?: JSONObject().put("kind", "manual")
  val days = t.optJSONArray("days")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
  val steps = o.optJSONArray("steps")?.let { a ->
    (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let { s -> WStep(s.optString("id"), s.optString("kind", "task"), s.optString("title"), s.text("detail")) } }
  } ?: emptyList()
  if (steps.isEmpty()) return null
  return WWorkflow(o.optString("id"), o.optString("name"), o.text("description"), WTrigger(t.optString("kind", "manual"), t.text("time"), days), steps, o.optBoolean("enabled", true))
}

private val WEEK = listOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")
private val SHORT = mapOf("mon" to "Mon", "tue" to "Tue", "wed" to "Wed", "thu" to "Thu", "fri" to "Fri", "sat" to "Sat", "sun" to "Sun")

private fun clock(hhmm: String?): String {
  val (h, m) = (hhmm ?: "00:00").split(":").map { it.toIntOrNull() ?: 0 }.let { it.getOrElse(0) { 0 } to it.getOrElse(1) { 0 } }
  val h12 = if (h % 12 == 0) 12 else h % 12
  return "$h12:${m.toString().padStart(2, '0')} ${if (h >= 12) "pm" else "am"}"
}

/** "Every day at 7:30 am", "Weekdays at 9:00 am" — the desktop's triggerText. */
fun triggerText(t: WTrigger): String = when (t.kind) {
  "daily" -> "Every day at ${clock(t.time)}"
  "weekly" -> {
    val set = t.days.toSet()
    val ordered = WEEK.filter { it in set }
    val days = when {
      ordered.size == 5 && "sat" !in set && "sun" !in set -> "Weekdays"
      ordered.size == 2 && "sat" in set && "sun" in set -> "Weekends"
      ordered.size == 1 -> "Every ${SHORT[ordered[0]]}"
      else -> ordered.joinToString(", ") { SHORT[it] ?: it }
    }
    "$days at ${clock(t.time)}"
  }
  else -> "When you run it"
}

private fun stepIcon(kind: String): ImageVector = when (kind) {
  "app" -> Icons.Rounded.WebAsset
  "web" -> Icons.Rounded.Language
  "pc" -> Icons.Rounded.Computer
  "notify" -> Icons.Rounded.Notifications
  "wait" -> Icons.Rounded.HourglassEmpty
  "ask" -> Icons.Rounded.QuestionAnswer
  else -> Icons.Rounded.AutoAwesome
}

private fun kindLabel(kind: String): String = when (kind) {
  "app" -> "App"; "web" -> "Web"; "pc" -> "PC"; "notify" -> "Tell you"; "wait" -> "Wait"; "ask" -> "Ask you"; else -> "Task"
}

/* ── The cards ───────────────────────────────────────────────────────── */

@Composable
internal fun WorkflowsCard(title: String?, items: List<WWorkflow>, reply: (String) -> Unit) {
  val haptics = LocalHaptics.current
  var open by remember { mutableStateOf<WWorkflow?>(null) }
  // Run now asks the PC in words: the agent starts it with `dex-workflow run`.
  val run: (WWorkflow) -> Unit = { w -> haptics.confirm(); reply("Run my workflow “${w.name}” now.") }
  WidgetSurface {
    Column {
      Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Rounded.AccountTree, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title ?: if (items.size == 1) "Workflow" else "Your workflows", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      if (items.isEmpty()) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text("No workflows yet", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
          Text("Ask DEX to make one — “every weekday at 7:30, check the weather and summarise my mail”.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      items.forEach { w ->
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GlyphTile(if (w.trigger.kind == "manual") Icons.Rounded.AccountTree else Icons.Rounded.Schedule, size = 40)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
              Text(w.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
              Text(triggerText(w.trigger), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
              val paused = !w.enabled && w.trigger.kind != "manual"
              Text("${w.steps.size} step${if (w.steps.size == 1) "" else "s"}${if (paused) " · Paused" else ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
          Row(Modifier.padding(start = 52.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val pad = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
            Button(onClick = { haptics.click(); open = w }, contentPadding = pad, modifier = Modifier.heightIn(min = 36.dp), shapes = androidx.compose.material3.ButtonDefaults.shapes()) {
              Icon(Icons.Rounded.AccountTree, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("View")
            }
            FilledTonalButton(onClick = { run(w) }, contentPadding = pad, modifier = Modifier.heightIn(min = 36.dp), shapes = androidx.compose.material3.ButtonDefaults.shapes()) {
              Icon(Icons.Rounded.PlayArrow, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Run now")
            }
          }
        }
      }
    }
  }
  open?.let { w -> WorkflowGraphDialog(w, onRun = { run(w); open = null }, onDismiss = { open = null }) }
}

/* ── The graph ───────────────────────────────────────────────────────── */

private val NODE_W = 232.dp
private val NODE_H = 84.dp
private val GAP_X = 64.dp
private val GAP_Y = 56.dp

private data class GNode(val x: Float, val y: Float, val row: Int, val col: Int)

/** The desktop's snake layout (layout.ts), in pixels. */
private fun snake(count: Int, cols: Int, w: Float, h: Float, gx: Float, gy: Float): List<GNode> {
  val c = cols.coerceIn(1, maxOf(1, count))
  return (0 until count).map { i ->
    val row = i / c
    val pos = i % c
    val col = if (row % 2 == 0) pos else c - 1 - pos
    GNode(col * (w + gx), row * (h + gy), row, col)
  }
}

@Composable
fun WorkflowGraphDialog(workflow: WWorkflow, onRun: () -> Unit, onDismiss: () -> Unit) {
  val haptics = LocalHaptics.current
  val scheme = MaterialTheme.colorScheme
  val density = LocalDensity.current
  Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    BoxWithConstraints(Modifier.fillMaxSize().background(scheme.surfaceContainerLowest)) {
      val viewW = constraints.maxWidth.toFloat()
      val nw = with(density) { NODE_W.toPx() }
      val nh = with(density) { NODE_H.toPx() }
      val gx = with(density) { GAP_X.toPx() }
      val gy = with(density) { GAP_Y.toPx() }
      val pad = with(density) { 20.dp.toPx() }
      val top = with(density) { 168.dp.toPx() }
      val count = workflow.steps.size + 1
      // As many side by side as fit (1 to 4): one column on a phone held upright.
      val cols = ((viewW - pad * 2 + gx) / (nw + gx)).toInt().coerceIn(1, minOf(4, count))
      val nodes = remember(count, cols, nw, nh) { snake(count, cols, nw, nh, gx, gy) }
      val layoutW = cols * nw + (cols - 1) * gx
      val rows = nodes.last().row + 1
      val layoutH = rows * nh + (rows - 1) * gy
      // Fit the width, start at the top: a long routine scrolls rather than shrinking to dots.
      val fitK = min(1f, (viewW - pad * 2) / layoutW)
      val home = Offset((viewW - layoutW * fitK) / 2f, top)
      var k by remember(cols) { mutableFloatStateOf(fitK) }
      var off by remember(cols) { mutableStateOf(home) }
      val edge = scheme.outline.copy(alpha = 0.7f)
      val dot = scheme.outlineVariant.copy(alpha = 0.55f)
      val bg = scheme.surfaceContainerLowest

      Box(
        Modifier
          .fillMaxSize()
          .pointerInput(cols) {
            detectTransformGestures { centroid, pan, zoom, _ ->
              val nk = (k * zoom).coerceIn(0.4f, 2f)
              off = centroid - (centroid - off) * (nk / k) + pan
              k = nk
            }
          }
          .pointerInput(cols) { detectTapGestures(onDoubleTap = { haptics.tick(); k = fitK; off = home }) }
          .drawBehind {
            // The dotted sheet moves with the graph.
            val step = 22.dp.toPx() * k
            val r = 1.2.dp.toPx()
            var x = off.x % step
            while (x < size.width) {
              var y = off.y % step
              while (y < size.height) { drawCircle(dot, r, Offset(x, y)); y += step }
              x += step
            }
          },
      ) {
        Box(
          Modifier
            .wrapContentSize(Alignment.TopStart, unbounded = true)
            .requiredSize(with(density) { layoutW.toDp() }, with(density) { layoutH.toDp() })
            .graphicsLayer {
              transformOrigin = TransformOrigin(0f, 0f)
              scaleX = k; scaleY = k
              translationX = off.x; translationY = off.y
            },
        ) {
          Canvas(Modifier.requiredSize(with(density) { layoutW.toDp() }, with(density) { layoutH.toDp() })) {
            val stroke = Stroke(width = 1.6.dp.toPx())
            val r = 4.dp.toPx()
            for (i in 0 until nodes.size - 1) {
              val a = nodes[i]; val b = nodes[i + 1]
              val path = Path()
              val (start, end) = if (a.row == b.row) {
                val right = b.col > a.col
                val s = Offset(if (right) a.x + nw else a.x, a.y + nh / 2)
                val e = Offset(if (right) b.x else b.x + nw, b.y + nh / 2)
                val c = abs(e.x - s.x) / 2 * (if (right) 1 else -1)
                path.moveTo(s.x, s.y); path.cubicTo(s.x + c, s.y, e.x - c, e.y, e.x, e.y)
                s to e
              } else {
                val s = Offset(a.x + nw / 2, a.y + nh)
                val e = Offset(b.x + nw / 2, b.y)
                val c = (e.y - s.y) / 2
                path.moveTo(s.x, s.y); path.cubicTo(s.x, s.y + c, e.x, e.y - c, e.x, e.y)
                s to e
              }
              drawPath(path, edge, style = stroke)
              drawCircle(bg, r, start); drawCircle(edge, r, start, style = Stroke(1.5.dp.toPx()))
              drawCircle(edge, r, end)
            }
          }
          nodes.forEachIndexed { i, n ->
            val m = Modifier.offset { IntOffset(n.x.roundToInt(), n.y.roundToInt()) }.requiredSize(NODE_W, NODE_H)
            if (i == 0) GraphNode(m, if (workflow.trigger.kind == "manual") Icons.Rounded.PlayArrow else Icons.Rounded.Schedule, if (workflow.trigger.kind == "manual") "Start" else "Schedule", triggerText(workflow.trigger), null, trigger = true)
            else workflow.steps[i - 1].let { s -> GraphNode(m, stepIcon(s.kind), "$i · ${kindLabel(s.kind)}", s.title, s.detail, trigger = false) }
          }
        }
      }

      // The top bar: close, the name, and when it runs.
      Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          FilledTonalIconButton(onClick = { haptics.tick(); onDismiss() }, shapes = IconButtonDefaults.shapes()) { Icon(Icons.Rounded.Close, "Close") }
          Spacer(Modifier.size(10.dp))
          Surface(shape = RoundedCornerShape(50), color = scheme.surfaceContainerHigh.copy(alpha = 0.92f), modifier = Modifier.weight(1f)) {
            Text(workflow.name, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
        }
        Surface(shape = RoundedCornerShape(16.dp), color = scheme.surfaceContainerHigh.copy(alpha = 0.92f), modifier = Modifier.fillMaxWidth()) {
          Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${triggerText(workflow.trigger)} · ${workflow.steps.size} step${if (workflow.steps.size == 1) "" else "s"}", style = MaterialTheme.typography.labelLarge, color = scheme.onSurface)
            workflow.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
          }
        }
      }

      Button(
        onClick = onRun,
        modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 20.dp).heightIn(min = 48.dp),
        shapes = androidx.compose.material3.ButtonDefaults.shapes(),
      ) {
        Icon(Icons.Rounded.PlayArrow, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Run now")
      }
    }
  }
}

@Composable
private fun GraphNode(modifier: Modifier, icon: ImageVector, kind: String, title: String, detail: String?, trigger: Boolean) {
  val scheme = MaterialTheme.colorScheme
  Surface(
    modifier = modifier,
    shape = RoundedCornerShape(16.dp),
    color = if (trigger) scheme.primary else scheme.surfaceContainerHigh,
    border = if (trigger) null else BorderStroke(1.dp, scheme.outlineVariant.copy(alpha = 0.6f)),
  ) {
    Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      Box(
        Modifier.size(32.dp).background(if (trigger) scheme.onPrimary.copy(alpha = 0.16f) else scheme.secondaryContainer, RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center,
      ) {
        Icon(icon, null, Modifier.size(18.dp), tint = if (trigger) scheme.onPrimary else scheme.onSecondaryContainer)
      }
      Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(kind, style = MaterialTheme.typography.labelSmall, color = if (trigger) scheme.onPrimary.copy(alpha = 0.7f) else scheme.onSurfaceVariant)
        Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = if (trigger) scheme.onPrimary else scheme.onSurface, maxLines = 2, overflow = TextOverflow.Ellipsis)
        detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
      }
    }
  }
}
