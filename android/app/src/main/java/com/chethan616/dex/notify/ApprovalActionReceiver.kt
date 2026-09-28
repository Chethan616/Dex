package com.chethan616.dex.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.chethan616.dex.container
import com.chethan616.dex.data.CommandType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** "Approve" / "Deny" on an approval notification → a command for the desktop. */
class ApprovalActionReceiver : BroadcastReceiver() {
  companion object {
    const val EXTRA_SESSION = "session"
    const val EXTRA_CONFIRMATION = "confirmation"
    const val EXTRA_APPROVED = "approved"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val sessionId = intent.getStringExtra(EXTRA_SESSION) ?: return
    val confirmationId = intent.getStringExtra(EXTRA_CONFIRMATION) ?: return
    val approved = intent.getBooleanExtra(EXTRA_APPROVED, false)
    val pending = goAsync()
    CoroutineScope(Dispatchers.IO).launch {
      try {
        context.container.repo.send(
          CommandType.AnswerConfirmation,
          mapOf("sessionId" to sessionId, "confirmationId" to confirmationId, "approved" to approved, "lifetime" to "once"),
        )
        Notifications.cancel(context, sessionId)
      } catch (_: Throwable) {
        // Signed out or offline: leave the notification up so the user can open the app.
      } finally {
        pending.finish()
      }
    }
  }
}
