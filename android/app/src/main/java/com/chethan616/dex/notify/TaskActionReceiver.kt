package com.chethan616.dex.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import com.chethan616.dex.container
import com.chethan616.dex.data.CommandType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * The buttons on task notifications, without opening the app:
 *   Reply (Done / Couldn't finish) → a follow-up in that task.
 *   Stop  (the live "working" notification) → stop the task on the PC.
 */
class TaskActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_REPLY = "com.chethan616.dex.action.REPLY"
    const val ACTION_STOP = "com.chethan616.dex.action.STOP"
    const val EXTRA_SESSION = "session"
    const val EXTRA_TITLE = "title"
    const val KEY_REPLY = "reply"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val sessionId = intent.getStringExtra(EXTRA_SESSION) ?: return
    val pending = goAsync()
    CoroutineScope(Dispatchers.IO).launch {
      try {
        when (intent.action) {
          ACTION_REPLY -> {
            val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_REPLY)?.toString()?.trim()
            if (!text.isNullOrEmpty()) {
              context.container.repo.send(CommandType.FollowUp, mapOf("sessionId" to sessionId, "prompt" to text))
              // Replace the reply field's spinner with a clear "sent".
              Notifications.replySent(context, sessionId, intent.getStringExtra(EXTRA_TITLE).orEmpty(), text)
            }
          }
          ACTION_STOP -> {
            context.container.repo.send(CommandType.Stop, mapOf("sessionId" to sessionId))
          }
        }
      } catch (_: Throwable) {
        if (intent.action == ACTION_REPLY) Notifications.replySent(context, sessionId, "", null)
      } finally {
        pending.finish()
      }
    }
  }
}
