package com.chethan616.dex.ui.components

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.chethan616.dex.ui.theme.LocalStatusColors
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * Gen-UI beyond the kit, as the desktop has it (shared/genui.ts): charts drawn
 * in the phone's own colours, and agent-written views in a locked-down
 * WebView with the same `--dex-*` colour variables, filled from this theme.
 */

data class WSeries(val name: String?, val values: List<Double>)
data class WChart(val kind: String, val title: String?, val note: String?, val labels: List<String>, val series: List<WSeries>, val max: Double?, val unit: String?)
data class WCustom(val title: String?, val html: String, val height: Int?)

/** The desktop has already normalised and checked the spec; this only reads it. */
internal fun parseChart(o: JSONObject): WChart? = runCatching {
  val labels = o.optJSONArray("labels")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: return null
  val series = o.optJSONArray("series")?.let { a ->
    (0 until a.length()).mapNotNull { i ->
      val s = a.optJSONObject(i) ?: return@mapNotNull null
      val v = s.optJSONArray("values") ?: return@mapNotNull null
      WSeries(s.optString("name").takeIf { it.isNotBlank() }, (0 until v.length()).map { v.optDouble(it, 0.0) })
    }
  } ?: return null
  if (series.isEmpty()) return null
  WChart(
    o.optString("kind", "bar"), o.optString("title").takeIf { it.isNotBlank() }, o.optString("note").takeIf { it.isNotBlank() },
    labels, series, if (o.has("max")) o.optDouble("max").takeIf { !it.isNaN() } else null, o.optString("unit").takeIf { it.isNotBlank() },
  )
}.getOrNull()

internal fun parseCustom(o: JSONObject): WCustom? {
  val html = o.optString("html").takeIf { it.isNotBlank() } ?: return null
  return WCustom(o.optString("title").takeIf { it.isNotBlank() }, html, if (o.has("height")) o.optInt("height") else null)
}

/** The scale's top: the spec's max, or the data's top rounded to a tidy step (shared/genui.ts chartMax). */
internal fun chartMax(c: WChart): Double {
  c.max?.let { return it }
  val top = max(0.0, c.series.flatMap { it.values }.maxOrNull() ?: 0.0)
  if (top <= 0) return 1.0
  val step = 10.0.pow(floor(log10(top)))
  return ceil(top / step) * step
}

private fun fmt(v: Double): String = if (v == floor(v) || kotlin.math.abs(v) >= 100) v.roundToInt().toString() else String.format("%.1f", v)

@Composable
private fun seriesColors(): List<Color> {
  val status = LocalStatusColors.current
  return listOf(MaterialTheme.colorScheme.primary, status.running, status.idle, status.stuck)
}

/* ── Charts ─────────────────────────────────────────────────────────── */

@Composable
internal fun ChartCard(c: WChart) {
  val colors = seriesColors()
  val scheme = MaterialTheme.colorScheme
  val grow = remember(c) { Animatable(0f) }
  LaunchedEffect(c) { grow.animateTo(1f, spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessLow)) }
  WidgetSurface {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      c.title?.let { Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
      c.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant) }
      when (c.kind) {
        "radar" -> Radar(c, colors, grow.value)
        "line", "area" -> Lines(c, colors, grow.value, area = c.kind == "area")
        "pie", "donut" -> Pie(c, colors, grow.value, hole = c.kind == "donut")
        "gauge" -> Gauge(c, colors.first(), grow.value)
        else -> Bars(c, colors, grow.value)
      }
      if (c.series.size > 1) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.align(Alignment.CenterHorizontally)) {
          c.series.forEachIndexed { i, s ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(colors[i % colors.size]))
              Text(s.name ?: "Series ${i + 1}", style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun Radar(c: WChart, colors: List<Color>, t: Float) {
  val scheme = MaterialTheme.colorScheme
  val measurer = rememberTextMeasurer()
  val labelStyle = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant)
  val grid = scheme.outlineVariant.copy(alpha = 0.6f)
  val maxV = chartMax(c)
  val n = c.labels.size
  Canvas(Modifier.fillMaxWidth().aspectRatio(1f)) {
    val cx = size.width / 2; val cy = size.height / 2
    val r = min(size.width, size.height) * 0.34f
    fun pt(i: Int, f: Float): Offset { val a = -PI / 2 + i.toDouble() / n * 2 * PI; return Offset(cx + (cos(a) * r * f).toFloat(), cy + (sin(a) * r * f).toFloat()) }
    listOf(0.25f, 0.5f, 0.75f, 1f).forEach { f ->
      val p = Path().apply { (0 until n).forEach { i -> val q = pt(i, f); if (i == 0) moveTo(q.x, q.y) else lineTo(q.x, q.y) }; close() }
      drawPath(p, grid, style = Stroke(1.dp.toPx()))
    }
    (0 until n).forEach { i -> drawLine(grid, Offset(cx, cy), pt(i, 1f), 1.dp.toPx()) }
    c.series.forEachIndexed { si, s ->
      val col = colors[si % colors.size]
      val p = Path().apply { s.values.forEachIndexed { i, v -> val q = pt(i, (v / maxV).toFloat().coerceIn(0f, 1f) * t); if (i == 0) moveTo(q.x, q.y) else lineTo(q.x, q.y) }; close() }
      drawPath(p, col.copy(alpha = 0.22f))
      drawPath(p, col, style = Stroke(2.4.dp.toPx(), join = StrokeJoin.Round))
      s.values.forEachIndexed { i, v -> drawCircle(col, 4.dp.toPx(), pt(i, (v / maxV).toFloat().coerceIn(0f, 1f) * t)) }
    }
    c.labels.forEachIndexed { i, l ->
      val text = if (c.series.size == 1) "$l ${fmt(c.series[0].values[i])}" else l
      val layout = measurer.measure(text, labelStyle, maxLines = 2, softWrap = true, constraints = androidx.compose.ui.unit.Constraints(maxWidth = (size.width * 0.3f).toInt()))
      val q = pt(i, 1.17f)
      val x = when { kotlin.math.abs(q.x - cx) < 8f -> q.x - layout.size.width / 2f; q.x > cx -> q.x; else -> q.x - layout.size.width }
      drawText(layout, topLeft = Offset(x.coerceIn(0f, size.width - layout.size.width), q.y - layout.size.height / 2f))
    }
  }
}

private fun DrawScope.yGrid(maxV: Double, left: Float, right: Float, top: Float, bottom: Float, grid: Color, tick: (String, Offset) -> Unit) {
  listOf(0.0, 0.25, 0.5, 0.75, 1.0).forEach { f ->
    val y = bottom - (f * (bottom - top)).toFloat()
    drawLine(grid, Offset(left, y), Offset(right, y), 1.dp.toPx())
    tick(fmt(maxV * f), Offset(left - 6.dp.toPx(), y))
  }
}

@Composable
private fun Bars(c: WChart, colors: List<Color>, t: Float) {
  val scheme = MaterialTheme.colorScheme
  val measurer = rememberTextMeasurer()
  val small = TextStyle(fontSize = 10.sp, color = scheme.onSurfaceVariant)
  val value = TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Bold, color = scheme.onSurface)
  val grid = scheme.outlineVariant.copy(alpha = 0.5f)
  val maxV = chartMax(c)
  Canvas(Modifier.fillMaxWidth().height(220.dp)) {
    val left = 34.dp.toPx(); val bottom = size.height - 26.dp.toPx(); val top = 14.dp.toPx(); val right = size.width
    yGrid(maxV, left, right, top, bottom, grid) { s, o -> val l = measurer.measure(s, small); drawText(l, topLeft = Offset(o.x - l.size.width, o.y - l.size.height / 2f)) }
    val n = c.labels.size; val k = c.series.size
    val band = (right - left) / n
    val bw = min(30.dp.toPx(), band * 0.72f / k)
    c.labels.forEachIndexed { i, label ->
      val x0 = left + i * band + (band - bw * k) / 2
      c.series.forEachIndexed { si, s ->
        val h = ((s.values[i] / maxV).toFloat().coerceIn(0f, 1f) * (bottom - top)) * t
        drawRoundRect(colors[si % colors.size], Offset(x0 + si * bw, bottom - h), Size(bw - 2.dp.toPx(), h), androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()))
        if (k == 1 && t > 0.9f) { val l = measurer.measure(fmt(s.values[i]), value); drawText(l, topLeft = Offset(x0 + bw / 2 - l.size.width / 2f, bottom - h - l.size.height - 2.dp.toPx())) }
      }
      val l = measurer.measure(label, small, maxLines = 1, overflow = TextOverflow.Ellipsis, constraints = androidx.compose.ui.unit.Constraints(maxWidth = max(1, band.toInt())))
      drawText(l, topLeft = Offset(left + i * band + band / 2 - l.size.width / 2f, bottom + 6.dp.toPx()))
    }
  }
}

@Composable
private fun Lines(c: WChart, colors: List<Color>, t: Float, area: Boolean) {
  val scheme = MaterialTheme.colorScheme
  val measurer = rememberTextMeasurer()
  val small = TextStyle(fontSize = 10.sp, color = scheme.onSurfaceVariant)
  val grid = scheme.outlineVariant.copy(alpha = 0.5f)
  val maxV = chartMax(c)
  Canvas(Modifier.fillMaxWidth().height(220.dp)) {
    val left = 34.dp.toPx(); val bottom = size.height - 26.dp.toPx(); val top = 14.dp.toPx(); val right = size.width - 8.dp.toPx()
    yGrid(maxV, left, right, top, bottom, grid) { s, o -> val l = measurer.measure(s, small); drawText(l, topLeft = Offset(o.x - l.size.width, o.y - l.size.height / 2f)) }
    val n = c.labels.size
    fun x(i: Int) = if (n == 1) (left + right) / 2 else left + i.toFloat() / (n - 1) * (right - left)
    fun y(v: Double) = bottom - (v / maxV).toFloat().coerceIn(0f, 1f) * (bottom - top)
    // Drawn left to right as it springs in.
    clipRect(right = left + (right - left) * t.coerceIn(0f, 1f) + 6.dp.toPx()) {
      c.series.forEachIndexed { si, s ->
        val col = colors[si % colors.size]
        val p = Path().apply { s.values.forEachIndexed { i, v -> if (i == 0) moveTo(x(i), y(v)) else lineTo(x(i), y(v)) } }
        if (area) {
          val fill = Path().apply { addPath(p); lineTo(x(n - 1), bottom); lineTo(x(0), bottom); close() }
          drawPath(fill, androidx.compose.ui.graphics.Brush.verticalGradient(listOf(col.copy(alpha = 0.3f), col.copy(alpha = 0f)), top, bottom))
        }
        drawPath(p, col, style = Stroke(2.6.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        s.values.forEachIndexed { i, v -> drawCircle(col, 3.5.dp.toPx(), Offset(x(i), y(v))) }
      }
    }
    val every = max(1, ceil(n / 8.0).toInt())
    c.labels.forEachIndexed { i, label ->
      if (i % every != 0) return@forEachIndexed
      val l = measurer.measure(label, small, maxLines = 1, overflow = TextOverflow.Ellipsis, constraints = androidx.compose.ui.unit.Constraints(maxWidth = 80.dp.roundToPx()))
      drawText(l, topLeft = Offset(x(i) - l.size.width / 2f, bottom + 6.dp.toPx()))
    }
  }
}

@Composable
private fun Pie(c: WChart, colors: List<Color>, t: Float, hole: Boolean) {
  val scheme = MaterialTheme.colorScheme
  val vals = c.series[0].values.map { max(0.0, it) }
  val total = vals.sum().takeIf { it > 0 } ?: 1.0
  val measurer = rememberTextMeasurer()
  val big = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold, color = scheme.onSurface)
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
    Canvas(Modifier.size(140.dp)) {
      var a = -90f
      vals.forEachIndexed { i, v ->
        val sweep = (v / total * 360).toFloat() * t
        if (hole) drawArc(colors[i % colors.size], a, max(0f, sweep - 1.5f), false, style = Stroke(26.dp.toPx()), topLeft = Offset(13.dp.toPx(), 13.dp.toPx()), size = Size(size.width - 26.dp.toPx(), size.height - 26.dp.toPx()))
        else drawArc(colors[i % colors.size], a, max(0f, sweep - 1f), true)
        a += sweep
      }
      if (hole) { val l = measurer.measure(fmt(total), big); drawText(l, topLeft = Offset(size.width / 2 - l.size.width / 2f, size.height / 2 - l.size.height / 2f)) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      c.labels.forEachIndexed { i, l ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(colors[i % colors.size]))
          Text(l, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(96.dp))
          Text("${fmt(vals[i])}${c.unit ?: ""}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
          Text("${(vals[i] / total * 100).roundToInt()}%", style = MaterialTheme.typography.labelSmall, color = scheme.outline)
        }
      }
    }
  }
}

@Composable
private fun Gauge(c: WChart, color: Color, t: Float) {
  val scheme = MaterialTheme.colorScheme
  val v = c.series[0].values.firstOrNull() ?: 0.0
  val maxV = chartMax(c)
  val f = (v / maxV).toFloat().coerceIn(0f, 1f)
  val measurer = rememberTextMeasurer()
  val big = TextStyle(fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, color = scheme.onSurface)
  val small = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant)
  val track = scheme.surfaceContainerHighest
  Canvas(Modifier.fillMaxWidth().height(150.dp)) {
    val w = min(size.width, size.height * 1.8f)
    val stroke = 16.dp.toPx()
    val tl = Offset((size.width - w) / 2 + stroke, stroke)
    val sz = Size(w - stroke * 2, w - stroke * 2)
    drawArc(track, 180f, 180f, false, tl, sz, style = Stroke(stroke, cap = StrokeCap.Round))
    drawArc(color, 180f, 180f * f * t, false, tl, sz, style = Stroke(stroke, cap = StrokeCap.Round))
    val l = measurer.measure("${fmt(v)}${c.unit ?: ""}", big)
    drawText(l, topLeft = Offset(size.width / 2 - l.size.width / 2f, tl.y + sz.height / 2 - l.size.height * 1.1f))
    c.labels.firstOrNull()?.let { lab -> val m = measurer.measure(lab, small); drawText(m, topLeft = Offset(size.width / 2 - m.size.width / 2f, tl.y + sz.height / 2 + 2.dp.toPx())) }
  }
}

/* ── Agent-written views ────────────────────────────────────────────── */

private fun Color.css(): String {
  val argb = toArgb()
  val a = (argb ushr 24) and 0xff
  val r = (argb shr 16) and 0xff; val g = (argb shr 8) and 0xff; val b = argb and 0xff
  return if (a == 255) String.format("#%02x%02x%02x", r, g, b) else "rgba($r,$g,$b,${String.format("%.3f", a / 255f)})"
}

/** The same page the desktop builds (shared/genui.ts customDocument), with this theme's colours. */
internal fun customDocument(html: String, tokens: Map<String, String>): String {
  val vars = tokens.entries.joinToString("") { (k, v) -> "--dex-$k:$v;" }
  return """<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com https://cdn.jsdelivr.net; script-src 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'none'; frame-src 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root{${vars}--dex-radius:14px;--dex-font:system-ui,Roboto,sans-serif}
html,body{margin:0;padding:0;background:transparent;color:var(--dex-fg);font-family:var(--dex-font);font-size:14px;line-height:1.45}
*{box-sizing:border-box}button{font:inherit}a{color:var(--dex-accent)}</style>
<script>(function(){function send(m){try{window.DexBridge&&window.DexBridge.post(JSON.stringify(m))}catch(e){}}
window.dex={reply:function(t){if(typeof t==='string'&&t.trim())send({kind:'reply',text:t.slice(0,2000)})},open:function(u){if(typeof u==='string'&&/^https?:\/\//i.test(u))send({kind:'open',url:u})}};
function size(){send({kind:'height',height:Math.ceil(document.documentElement.scrollHeight)})}
window.addEventListener('load',size);new ResizeObserver(size).observe(document.documentElement);
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a){e.preventDefault();window.dex.open(a.href)}});})();</script>
</head><body>$html</body></html>"""
}

/** Only these three messages come out of the page. */
private class DexBridge(val onReply: (String) -> Unit, val onOpen: (String) -> Unit, val onHeight: (Int) -> Unit) {
  private val main = Handler(Looper.getMainLooper())
  @JavascriptInterface
  fun post(json: String) {
    val m = runCatching { JSONObject(json) }.getOrNull() ?: return
    main.post {
      when (m.optString("kind")) {
        "reply" -> m.optString("text").trim().takeIf { it.isNotEmpty() }?.let { onReply(it.take(2000)) }
        "open" -> m.optString("url").takeIf { Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(it) }?.let(onOpen)
        "height" -> onHeight(m.optInt("height").coerceIn(60, 1600))
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun CustomCard(w: WCustom, open: (String) -> Unit, reply: (String) -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val status = LocalStatusColors.current
  val tokens = mapOf(
    "bg" to scheme.surface.css(), "surface" to scheme.surfaceContainerLow.css(), "surface-2" to scheme.surfaceContainerHigh.css(),
    "line" to scheme.outlineVariant.css(), "fg" to scheme.onSurface.css(), "muted" to scheme.onSurfaceVariant.css(),
    "accent" to scheme.primary.css(), "accent-fg" to scheme.onPrimary.css(),
    "good" to status.running.css(), "warn" to status.idle.css(), "bad" to status.stuck.css(),
    "series-1" to scheme.primary.css(), "series-2" to status.running.css(), "series-3" to status.idle.css(), "series-4" to status.stuck.css(),
  )
  val doc = remember(w.html, tokens) { customDocument(w.html, tokens) }
  var height by remember(w) { mutableIntStateOf(w.height ?: 240) }
  WidgetSurface {
    Column {
      w.title?.let {
        Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
          Text("made by DEX", style = MaterialTheme.typography.labelSmall, color = scheme.outline)
        }
      }
      AndroidView(
        modifier = Modifier.fillMaxWidth().height(height.dp),
        factory = { ctx ->
          WebView(ctx).apply {
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.domStorageEnabled = false
            settings.setGeolocationEnabled(false)
            settings.mediaPlaybackRequiresUserGesture = true
            isVerticalScrollBarEnabled = false
            addJavascriptInterface(DexBridge(onReply = reply, onOpen = open, onHeight = { height = it }), "DexBridge")
            // Nothing navigates: links go out through dex.open, to the phone's browser.
            webViewClient = object : WebViewClient() {
              override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
            }
            loadDataWithBaseURL("https://widget.dex.invalid/", doc, "text/html", "utf-8", null)
            tag = doc
          }
        },
        update = { view -> if (view.tag != doc) { view.tag = doc; view.loadDataWithBaseURL("https://widget.dex.invalid/", doc, "text/html", "utf-8", null) } },
      )
    }
  }
}
