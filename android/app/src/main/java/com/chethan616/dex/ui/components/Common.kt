package com.chethan616.dex.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.SessionStatus
import com.chethan616.dex.ui.theme.LocalStatusColors

fun relativeTime(ms: Long, now: Long = System.currentTimeMillis()): String {
  if (ms <= 0) return ""
  val s = (now - ms) / 1000
  return when {
    s < 45 -> "now"
    s < 3600 -> "${s / 60}m"
    s < 86_400 -> "${s / 3600}h"
    s < 7 * 86_400 -> "${s / 86_400}d"
    else -> java.text.SimpleDateFormat("d MMM", java.util.Locale.getDefault()).format(java.util.Date(ms))
  }
}

val ENGINE_NAMES = mapOf("claude-code" to "Claude Code", "codex" to "Codex", "browsercode" to "BrowserCode", "opencode" to "OpenCode")

@Composable
fun statusColor(status: SessionStatus): Color {
  val c = LocalStatusColors.current
  return when (status) {
    SessionStatus.Running -> c.running
    SessionStatus.Stuck -> c.stuck
    SessionStatus.Idle -> c.idle
    SessionStatus.Paused -> c.paused
    else -> c.stopped
  }
}

fun statusLabel(status: SessionStatus): String = when (status) {
  SessionStatus.Running -> "Working"
  SessionStatus.Stuck -> "Stuck"
  SessionStatus.Idle -> "Waiting for you"
  SessionStatus.Paused -> "Paused"
  SessionStatus.Draft -> "Draft"
  SessionStatus.Stopped -> "Done"
}

/** Status dot that pulses while the task is live. */
@Composable
fun StatusDot(status: SessionStatus, modifier: Modifier = Modifier) {
  val color = statusColor(status)
  val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
    initialValue = 1f,
    targetValue = 0.35f,
    animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
    label = "a",
  )
  Box(
    modifier
      .size(8.dp)
      .alpha(if (status.isLive) pulse else 1f)
      .background(color, CircleShape),
  )
}

@Composable
fun StatusPill(status: SessionStatus, modifier: Modifier = Modifier) {
  val color = statusColor(status)
  Row(
    modifier
      .background(color.copy(alpha = 0.14f), RoundedCornerShape(50))
      .padding(horizontal = 10.dp, vertical = 4.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    StatusDot(status)
    Text(statusLabel(status), style = MaterialTheme.typography.labelMedium, color = color)
  }
}
