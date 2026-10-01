package com.chethan616.dex.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.chethan616.dex.MainActivity
import com.chethan616.dex.R
import com.chethan616.dex.data.Session

object Notifications {
  const val CHANNEL_TASKS = "tasks"
  const val CHANNEL_APPROVALS = "approvals"
  const val CHANNEL_LIVE = "live"
  const val LIVE_ID = 0x0DE5
  const val EXTRA_SESSION_ID = "sessionId"

  fun createChannels(context: Context) {
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_TASKS, "Task updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "When a task on your PC finishes or runs into trouble."
      },
    )
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "When DEX needs your OK before it continues."
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 40, 80, 40)
      },
    )
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_LIVE, "Working now", NotificationManager.IMPORTANCE_LOW).apply {
        description = "A quiet, ongoing notification while a task runs on your PC."
        setShowBadge(false)
      },
    )
  }

  /** The ongoing "working on it" notification [TaskWatchService] keeps up. */
  fun live(context: Context, running: List<Session>): Notification {
    val first = running.firstOrNull()
    val title = when {
      first == null -> "DEX"
      running.size == 1 -> first.prompt.lineSequence().firstOrNull().orEmpty().take(80)
      else -> "${running.size} tasks running on your PC"
    }
    val body = first?.lastLine?.takeIf { it.isNotBlank() } ?: "Working on your PC…"
    val builder = NotificationCompat.Builder(context, CHANNEL_LIVE)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setSubText(first?.deviceName)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setProgress(0, 0, true)
      .setColor(0xFF1683FF.toInt())
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    first?.let { builder.setContentIntent(openSession(context, it.id)) }
    // One task running: stop it from the shade (several: open the app to choose).
    if (running.size == 1 && first != null) {
      builder.addAction(0, "Stop", taskAction(context, TaskActionReceiver.ACTION_STOP, first.id, title))
    }
    return builder.build()
  }

  private fun taskAction(context: Context, action: String, sessionId: String, title: String, mutable: Boolean = false): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      (action + sessionId).hashCode(),
      Intent(context, TaskActionReceiver::class.java)
        .setAction(action)
        .putExtra(TaskActionReceiver.EXTRA_SESSION, sessionId)
        .putExtra(TaskActionReceiver.EXTRA_TITLE, title),
      // A reply carries typed text back in the intent, so it must be mutable.
      (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE) or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** After a reply from the shade: confirm it, then let the notification go. */
  fun replySent(context: Context, sessionId: String, title: String, text: String?) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    val n = NotificationCompat.Builder(context, CHANNEL_TASKS)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(if (text != null) "Sent to your PC" else "Couldn’t send that")
      .setContentText(text ?: "Open DEX to try again.")
      .setSubText(title.takeIf { it.isNotBlank() })
      .setColor(0xFF1683FF.toInt())
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setAutoCancel(true)
      .setContentIntent(openSession(context, sessionId))
      .setTimeoutAfter(if (text != null) 6_000 else 0)
      .build()
    NotificationManagerCompat.from(context).notify(sessionId.hashCode(), n)
  }

  private fun openSession(context: Context, sessionId: String): PendingIntent =
    PendingIntent.getActivity(
      context,
      sessionId.hashCode(),
      Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(EXTRA_SESSION_ID, sessionId),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun answer(context: Context, sessionId: String, confirmationId: String, approved: Boolean): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      (confirmationId + approved).hashCode(),
      Intent(context, ApprovalActionReceiver::class.java)
        .putExtra(ApprovalActionReceiver.EXTRA_SESSION, sessionId)
        .putExtra(ApprovalActionReceiver.EXTRA_CONFIRMATION, confirmationId)
        .putExtra(ApprovalActionReceiver.EXTRA_APPROVED, approved),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  fun show(context: Context, kind: String, title: String, body: String, sessionId: String, confirmationId: String?) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return

    val approval = kind == "approval" && !confirmationId.isNullOrBlank()
    val builder = NotificationCompat.Builder(context, if (approval) CHANNEL_APPROVALS else CHANNEL_TASKS)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setContentIntent(openSession(context, sessionId))
      .setColor(0xFF1683FF.toInt())
      .setCategory(if (approval) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
      .setPriority(if (approval) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
    // Done / couldn't finish: follow up right from the notification.
    if (!approval && (kind == "done" || kind == "failed")) {
      val input = androidx.core.app.RemoteInput.Builder(TaskActionReceiver.KEY_REPLY)
        .setLabel(if (kind == "failed") "Tell DEX what to try…" else "Follow up…")
        .build()
      builder.addAction(
        NotificationCompat.Action.Builder(0, "Reply", taskAction(context, TaskActionReceiver.ACTION_REPLY, sessionId, title, mutable = true))
          .addRemoteInput(input)
          .setAllowGeneratedReplies(false)
          .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
          .build(),
      )
    }
    if (approval) {
      builder.addAction(0, "Approve", answer(context, sessionId, confirmationId, true))
      builder.addAction(0, "Deny", answer(context, sessionId, confirmationId, false))
    }
    NotificationManagerCompat.from(context).notify(sessionId.hashCode(), builder.build())
  }

  fun cancel(context: Context, sessionId: String) {
    NotificationManagerCompat.from(context).cancel(sessionId.hashCode())
  }
}
