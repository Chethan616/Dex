package com.chethan616.dex.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.chethan616.dex.ui.theme.MonoStyle

/**
 * Enough Markdown for agent replies: headings, bullet/numbered lists, fenced
 * code, quotes, GFM tables, rules, **bold**, *italic*, ~~strike~~, `code` and
 * [links](url). Parsed once per text change; no WebView, no dependency.
 */
private sealed interface MdBlock {
  data class Heading(val level: Int, val text: String) : MdBlock
  data class Para(val text: String) : MdBlock
  data class Bullet(val marker: String, val text: String) : MdBlock
  data class Code(val text: String) : MdBlock
  data class Quote(val text: String) : MdBlock
  data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock
  data object Rule : MdBlock
}

private val TABLE_SEPARATOR = Regex("^\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?\\s*$")

private fun cells(line: String): List<String> =
  line.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }

private fun parse(source: String): List<MdBlock> {
  val out = mutableListOf<MdBlock>()
  val lines = source.replace("\r\n", "\n").split("\n")
  var i = 0
  val para = StringBuilder()
  fun flush() { if (para.isNotBlank()) out += MdBlock.Para(para.toString().trim()); para.clear() }
  while (i < lines.size) {
    val line = lines[i]
    val trimmed = line.trimStart()
    when {
      trimmed.startsWith("```") -> {
        flush()
        val code = StringBuilder()
        i++
        while (i < lines.size && !lines[i].trimStart().startsWith("```")) { code.appendLine(lines[i]); i++ }
        out += MdBlock.Code(code.toString().trimEnd())
      }
      // | a | b |  followed by  |---|---|  — a GFM table.
      trimmed.startsWith("|") && i + 1 < lines.size && TABLE_SEPARATOR.matches(lines[i + 1].trim()) -> {
        flush()
        val header = cells(trimmed)
        i += 2
        val rows = mutableListOf<List<String>>()
        while (i < lines.size && lines[i].trimStart().startsWith("|")) {
          rows += cells(lines[i]).let { r -> List(header.size) { c -> r.getOrElse(c) { "" } } }
          i++
        }
        out += MdBlock.Table(header, rows)
        continue
      }
      Regex("^(-{3,}|\\*{3,}|_{3,})$").matches(trimmed) -> { flush(); out += MdBlock.Rule }
      Regex("^#{1,6} ").containsMatchIn(trimmed) -> {
        flush()
        val level = trimmed.takeWhile { it == '#' }.length
        out += MdBlock.Heading(level, trimmed.drop(level).trim())
      }
      Regex("^([-*+]|\\d+[.)]) ").containsMatchIn(trimmed) -> {
        flush()
        val marker = trimmed.substringBefore(' ')
        out += MdBlock.Bullet(if (marker.first().isDigit()) marker else "•", trimmed.substringAfter(' '))
      }
      trimmed.startsWith(">") -> { flush(); out += MdBlock.Quote(trimmed.removePrefix(">").trim()) }
      trimmed.isBlank() -> flush()
      else -> para.append(line.trim()).append(' ')
    }
    i++
  }
  flush()
  return out
}

// Bold may hold single-star italics ("**the *real* one**"); spans nest, so
// the inside of bold, strike, italic and link labels is parsed again.
private val INLINE = Regex("""(\*\*(?:[^*]|\*(?!\*))+?\*\*|~~[^~]+~~|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))""")

@Composable
private fun inline(text: String): AnnotatedString {
  val code = MaterialTheme.colorScheme.surfaceContainerHighest
  val link = MaterialTheme.colorScheme.primary
  return remember(text, code, link) { buildAnnotatedString { appendInline(text, code, link) } }
}

private fun AnnotatedString.Builder.appendInline(text: String, code: Color, link: Color) {
  var last = 0
  for (m in INLINE.findAll(text)) {
    append(text.substring(last, m.range.first))
    val t = m.value
    when {
      t.startsWith("**") -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { appendInline(t.removeSurrounding("**"), code, link) }
      t.startsWith("~~") -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { appendInline(t.removeSurrounding("~~"), code, link) }
      t.startsWith("`") -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = code)) { append(" ${t.removeSurrounding("`")} ") }
      t.startsWith("[") -> {
        val label = t.substringAfter('[').substringBefore(']')
        val url = t.substringAfter("](").removeSuffix(")")
        withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline)))) { appendInline(label, code, link) }
      }
      else -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInline(t.substring(1, t.length - 1), code, link) }
    }
    last = m.range.last + 1
  }
  append(text.substring(last))
}

@Composable
fun Markdown(source: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
  val blocks = remember(source) { parse(source) }
  val type = MaterialTheme.typography
  Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    blocks.forEach { b ->
      when (b) {
        is MdBlock.Heading -> Text(inline(b.text), style = if (b.level <= 2) type.titleLarge else type.titleMedium, color = color)
        is MdBlock.Para -> Text(inline(b.text), style = type.bodyLarge, color = color)
        is MdBlock.Bullet -> Row {
          Text(b.marker, style = type.bodyLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(end = 10.dp))
          Text(inline(b.text), style = type.bodyLarge, color = color)
        }
        is MdBlock.Quote -> Text(
          inline(b.text),
          style = type.bodyLarge,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier
            .background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        )
        is MdBlock.Table -> MdTable(b, color)
        MdBlock.Rule -> Box(
          Modifier.fillMaxWidth().padding(vertical = 4.dp).background(MaterialTheme.colorScheme.outlineVariant).padding(top = 1.dp),
        )
        is MdBlock.Code -> Text(
          b.text,
          style = MonoStyle,
          color = color,
          modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(14.dp))
            .horizontalScroll(rememberScrollState())
            .padding(12.dp),
          softWrap = false,
        )
      }
    }
  }
}

/**
 * A real table: every column as wide as its widest cell (capped, then text
 * wraps), rows as tall as their tallest cell, header shaded, the whole thing
 * scrolling sideways when it's wider than the phone.
 */
@Composable
private fun MdTable(table: MdBlock.Table, color: Color) {
  val scheme = MaterialTheme.colorScheme
  val type = MaterialTheme.typography
  val line = scheme.outlineVariant
  val cols = table.header.size
  val rows = listOf(table.header) + table.rows
  val shape = RoundedCornerShape(14.dp)
  Box(
    Modifier
      .fillMaxWidth()
      .clip(shape)
      .border(1.dp, line, shape)
      .horizontalScroll(rememberScrollState()),
  ) {
    Layout(
      content = {
        rows.forEachIndexed { r, row ->
          row.forEach { cell ->
            Box(
              Modifier
                .background(if (r == 0) scheme.surfaceContainerHigh else if (r % 2 == 0) scheme.surfaceContainerLow else Color.Transparent)
                .border(0.5.dp, line.copy(alpha = 0.6f))
                .padding(horizontal = 12.dp, vertical = 9.dp),
            ) {
              Text(
                inline(cell),
                style = if (r == 0) type.labelLarge.copy(fontWeight = FontWeight.SemiBold) else type.bodyMedium,
                color = color,
              )
            }
          }
        }
      },
    ) { measurables, _ ->
      val maxCol = 220.dp.roundToPx()
      val widths = IntArray(cols) { c ->
        rows.indices.maxOf { r -> measurables[r * cols + c].maxIntrinsicWidth(Constraints.Infinity) }.coerceAtMost(maxCol)
      }
      val heights = IntArray(rows.size) { r ->
        (0 until cols).maxOf { c -> measurables[r * cols + c].minIntrinsicHeight(widths[c]) }
      }
      val placeables = measurables.mapIndexed { i, m -> m.measure(Constraints.fixed(widths[i % cols], heights[i / cols])) }
      layout(widths.sum(), heights.sum()) {
        var y = 0
        for (r in rows.indices) {
          var x = 0
          for (c in 0 until cols) {
            placeables[r * cols + c].place(x, y)
            x += widths[c]
          }
          y += heights[r]
        }
      }
    }
  }
}

/** Markdown flattened to readable plain text — for notifications. */
fun markdownToPlain(source: String): String = parse(source).joinToString("\n") { b ->
  fun strip(t: String) = t.replace(Regex("""\*\*|~~|`|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)"""), "")
    .replace(Regex("""\[([^\]]+)\]\([^)]+\)"""), "$1")
  when (b) {
    is MdBlock.Heading -> strip(b.text)
    is MdBlock.Para -> strip(b.text)
    is MdBlock.Bullet -> "${b.marker} ${strip(b.text)}"
    is MdBlock.Quote -> strip(b.text)
    is MdBlock.Code -> b.text
    is MdBlock.Table -> b.rows.joinToString("\n") { row -> row.joinToString(" · ") { strip(it) } }
    MdBlock.Rule -> ""
  }
}.trim()
