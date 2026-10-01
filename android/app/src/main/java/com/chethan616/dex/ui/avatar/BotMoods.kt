package com.chethan616.dex.ui.avatar

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.chethan616.dex.data.Block
import com.chethan616.dex.data.Session
import com.chethan616.dex.data.SessionStatus
import com.chethan616.dex.ui.components.USER_STOPPED
import kotlinx.coroutines.delay

/**
 * How long a finished task's bot beams before it dozes off. Longer than the
 * desktop's few seconds: you often open the phone a little after the fact,
 * and the happy bot is how you see "that one's done".
 */
const val HAPPY_WINDOW_MS = 60_000L

/** What a live run is doing right now, from the tail of its conversation. */
fun liveMood(blocks: List<Block>): BotMood {
  for (b in blocks.asReversed()) {
    when (b.kind) {
      "tool" -> return if (b.result == null) BotMood.Working else BotMood.Thinking
      "notice" -> if (b.level == "blocking") return BotMood.NeedsYou
      "text", "user" -> return BotMood.Thinking
      "error" -> return BotMood.Thinking // it's still going: working it out
    }
  }
  return BotMood.Working
}

private fun endedBadly(session: Session, blocks: List<Block>?): Boolean {
  val error = session.error?.takeIf { it.isNotBlank() }
  if (error != null && !error.equals(USER_STOPPED, ignoreCase = true) && !error.contains("cancel", ignoreCase = true)) return true
  // The last turn ended on an error it didn't recover from.
  val tail = blocks?.lastOrNull { it.kind != "notice" && it.kind != "file" && it.kind != "image" } ?: return false
  return tail.kind == "error" && !tail.text.equals(USER_STOPPED, ignoreCase = true)
}

/**
 * The mood a task's bot wears. `blocks` (the conversation, where it's loaded)
 * sharpens a live run into thinking vs working.
 */
fun moodFor(session: Session?, now: Long, blocks: List<Block>? = null): BotMood = when {
  session == null -> BotMood.Idle
  session.pendingConfirmation != null -> BotMood.NeedsYou
  session.status.isLive -> blocks?.takeIf { it.isNotEmpty() }?.let(::liveMood) ?: BotMood.Working
  session.status == SessionStatus.Paused -> BotMood.Sleeping
  session.status == SessionStatus.Draft -> BotMood.Idle
  endedBadly(session, blocks) -> BotMood.Sad
  // The PC's clock and the phone's can disagree a little either way.
  now - session.lastActivityAt in -HAPPY_WINDOW_MS until HAPPY_WINDOW_MS -> BotMood.Happy
  else -> BotMood.Sleeping
}

/** The mood, kept current: a happy bot falls asleep when its minute is up. */
@Composable
fun rememberBotMood(session: Session?, blocks: List<Block>? = null): BotMood {
  var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
  val mood = moodFor(session, now, blocks)
  LaunchedEffect(session?.status, session?.lastActivityAt) {
    now = System.currentTimeMillis()
    val last = session?.lastActivityAt ?: return@LaunchedEffect
    if (moodFor(session, now, blocks) == BotMood.Happy) {
      delay((last + HAPPY_WINDOW_MS - now).coerceIn(0L, HAPPY_WINDOW_MS * 2) + 100)
      now = System.currentTimeMillis()
    }
  }
  return mood
}
