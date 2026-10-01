package com.chethan616.dex.notify

import android.content.Context
import com.chethan616.dex.data.DexRepository
import com.chethan616.dex.data.Session
import com.chethan616.dex.data.SessionStatus
import com.chethan616.dex.ui.components.markdownToPlain
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Local notifications, straight from the synced sessions — no server needed.
 *
 * While the app process is alive it watches users/{uid}/sessions and notifies
 * on the moments that matter: a task finished (with its answer), failed, or
 * is waiting for your OK (with Approve / Deny). While any task is running,
 * [TaskWatchService] keeps a quiet "working on it" notification up, which is
 * also what keeps the process — and so this watcher — alive in the
 * background until the answer arrives.
 */
object TaskWatcher {
  /** The session on screen right now; it doesn't need a notification. */
  val visibleSession = MutableStateFlow<String?>(null)

  private val _live = MutableStateFlow<List<Session>>(emptyList())
  /** Tasks running right now, for the ongoing notification. */
  val live: StateFlow<List<Session>> = _live.asStateFlow()

  private data class Seen(val status: SessionStatus, val confirmationId: String?)

  suspend fun run(context: Context, repo: DexRepository) {
    val app = context.applicationContext
    val seen = HashMap<String, Seen>()
    var seeded = false
    repo.sessions(40).collect { sessions ->
      _live.value = sessions.filter { it.status.isLive }
      if (_live.value.isNotEmpty()) TaskWatchService.ensureRunning(app)

      for (s in sessions) {
        val before = seen[s.id]
        // The first snapshot is history: only changes after it are news.
        if (seeded) notifyChange(app, before, s)
        seen[s.id] = Seen(s.status, s.pendingConfirmation?.id)
      }
      seeded = true
    }
  }

  private fun notifyChange(context: Context, before: Seen?, s: Session) {
    val title = s.prompt.lineSequence().firstOrNull().orEmpty().take(80).ifBlank { "Your task" }
    val confirmation = s.pendingConfirmation
    if (confirmation != null && confirmation.id != before?.confirmationId) {
      // Approvals always notify — even on screen, the banner is easy to miss.
      Notifications.show(
        context, kind = "approval",
        title = "DEX needs your OK",
        body = listOf(confirmation.title, confirmation.detail).filter { it.isNotBlank() }.joinToString("\n").ifBlank { title },
        sessionId = s.id, confirmationId = confirmation.id,
      )
      return
    }
    val wasLive = before?.status?.isLive == true
    if (!wasLive || s.status.isLive || s.status == SessionStatus.Paused) return
    if (visibleSession.value == s.id) {
      Notifications.cancel(context, s.id)
      return
    }
    when {
      // You pressed Stop (here, on the notification or on the PC): not a failure.
      s.error.equals(com.chethan616.dex.ui.components.USER_STOPPED, ignoreCase = true) -> Notifications.show(
        context, kind = "failed",
        title = "Stopped · $title",
        body = s.lastLine.takeIf { it.isNotBlank() }?.let { "Stopped at: ${it.take(300)}" } ?: "You stopped this task.",
        sessionId = s.id, confirmationId = null,
      )
      !s.error.isNullOrBlank() -> Notifications.show(
        context, kind = "failed",
        title = "Couldn't finish · $title",
        body = s.error.take(400),
        sessionId = s.id, confirmationId = null,
      )
      !s.summary.isNullOrBlank() || s.lastLine.isNotBlank() -> Notifications.show(
        context, kind = "done",
        title = "Done · $title",
        body = markdownToPlain(s.summary ?: s.lastLine).take(1200),
        sessionId = s.id, confirmationId = null,
      )
    }
  }
}
