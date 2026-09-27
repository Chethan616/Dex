package com.chethan616.dex.notify

import com.chethan616.dex.container
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Remote pushes, if a server ever sends them. DEX itself doesn't need one:
 * notifications are local (TaskWatcher), because Cloud Functions require
 * Firebase's paid Blaze plan. Kept so a push with the same payload still
 * renders — Approve / Deny work from the shade either way.
 */
class DexMessagingService : FirebaseMessagingService() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun onNewToken(token: String) {
    scope.launch { runCatching { applicationContext.container.repo.updateFcmToken(token) } }
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val sessionId = message.data["sessionId"] ?: return
    Notifications.show(
      context = this,
      kind = message.data["kind"] ?: "done",
      title = message.notification?.title ?: "DEX",
      body = message.notification?.body ?: "",
      sessionId = sessionId,
      confirmationId = message.data["confirmationId"],
    )
  }
}
