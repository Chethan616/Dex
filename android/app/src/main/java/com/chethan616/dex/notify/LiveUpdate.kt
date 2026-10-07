package com.chethan616.dex.notify

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.chethan616.dex.R
import com.chethan616.dex.data.PendingConfirmation
import com.chethan616.dex.data.Session
import com.chethan616.dex.data.SessionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A task you started from the phone, as an Android 16 live update — the
 * status-bar pill (OnePlus's Live Alert capsule, a Pixel's chip) that food
 * deliveries and GitHub's agent sessions use: a progress track with DEX's
 * bot riding it, a ticking timer since it started, and "Approve" when it
 * needs your OK.
 *
 * The track is honest about what DEX knows: sent (0–10), working (10–90,
 * filling as steps pile up but never reaching the end on its own), done.
 * On older Android it's the same notification without the pill.
 */
object LiveUpdate {
  const val DEMO_ID = 0x0DE6
  private const val BLUE = 0xFF1683FF.toInt()
  private const val GREEN = 0xFF1DB954.toInt()

  /** Where the bot sits on the track, 0–100. */
  fun progressOf(s: Session): Int = when {
    s.blockCount <= 0 -> 6
    else -> 10 + (80.0 * s.blockCount / (s.blockCount + 12.0)).toInt()
  }.coerceIn(0, 89)

  /** The pill's text when a word says more than the timer; null shows the timer. */
  fun chipOf(s: Session): String? = when {
    s.pendingConfirmation != null -> "Approve"
    s.status == SessionStatus.Stuck -> "Stuck"
    else -> null
  }

  fun textOf(s: Session): String = when {
    s.pendingConfirmation != null -> "Needs your OK: ${s.pendingConfirmation.title.ifBlank { "open DEX to answer" }}"
    s.lastLine.isNotBlank() -> s.lastLine.lineSequence().first().take(200)
    else -> "Starting on ${s.deviceName ?: "your PC"}…"
  }

  fun build(context: Context, s: Session, others: Int = 0, withActions: Boolean = true): Notification {
    val title = s.prompt.lineSequence().firstOrNull().orEmpty().trim().take(80).ifBlank { "Your task" }
    val style = NotificationCompat.ProgressStyle()
      .setStyledByProgress(true)
      .setProgressSegments(
        listOf(
          NotificationCompat.ProgressStyle.Segment(10).setColor(BLUE),
          NotificationCompat.ProgressStyle.Segment(80).setColor(BLUE),
          NotificationCompat.ProgressStyle.Segment(10).setColor(GREEN),
        ),
      )
      .setProgressPoints(
        listOf(
          NotificationCompat.ProgressStyle.Point(10).setColor(BLUE),
          NotificationCompat.ProgressStyle.Point(90).setColor(GREEN),
        ),
      )
      .setProgressTrackerIcon(IconCompat.createWithResource(context, R.drawable.ic_live_bot))
      .setProgress(progressOf(s))
    val builder = NotificationCompat.Builder(context, Notifications.CHANNEL_LIVE_UPDATES)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(textOf(s))
      .setSubText(listOfNotNull(s.deviceName, if (others > 0) "+$others more" else null).joinToString(" · ").ifBlank { null })
      .setStyle(style)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setRequestPromotedOngoing(true)
      // The timer in the pill and the header: how long it's been at it.
      .setWhen(s.createdAt.takeIf { it > 0 } ?: System.currentTimeMillis())
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setColor(BLUE)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    chipOf(s)?.let { builder.setShortCriticalText(it) }
    if (withActions) {
      builder.setContentIntent(Notifications.openSession(context, s.id))
      builder.addAction(0, "Stop", Notifications.taskAction(context, TaskActionReceiver.ACTION_STOP, s.id, title))
    }
    return builder.build()
  }

  /** Re-post the ongoing notification now (a task just became "from this phone"). */
  fun refresh(context: Context) {
    val live = TaskWatcher.live.value
    if (live.isEmpty()) return
    runCatching { NotificationManagerCompat.from(context).notify(Notifications.LIVE_ID, Notifications.live(context, live)) }
  }

  enum class Status { On, Off, NeedsAndroid16, NotificationsOff }

  fun status(context: Context): Status {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return Status.NotificationsOff
    if (Build.VERSION.SDK_INT < 36 || Build.VERSION.SDK_INT_FULL < Build.VERSION_CODES_FULL.BAKLAVA_1) return Status.NeedsAndroid16
    val nm = context.getSystemService(NotificationManager::class.java) ?: return Status.Off
    return if (nm.canPostPromotedNotifications()) Status.On else Status.Off
  }

  private var demo: Job? = null

  /**
   * A pretend task, about 25 seconds, so you can see the pill without your
   * PC: steps, an approval, then done. Nothing is sent anywhere.
   */
  fun demo(context: Context) {
    val app = context.applicationContext
    demo?.cancel()
    demo = CoroutineScope(SupervisorJob() + Dispatchers.Main).launch {
      val nm = NotificationManagerCompat.from(app)
      val started = System.currentTimeMillis()
      var s = Session(
        id = "demo", prompt = "Find the cheapest flight to Delhi on Friday", status = SessionStatus.Running,
        engine = null, model = null, createdAt = started, lastActivityAt = started, lastLine = "", summary = null,
        error = null, costUsd = 0.0, tokens = 0, blockCount = 0, pendingConfirmation = null, deviceName = "Your PC (demo)",
      )
      fun post() { runCatching { nm.notify(DEMO_ID, build(app, s, withActions = false)) } }
      post()
      delay(3_000)
      val steps = listOf(
        "Opening Google Flights",
        "Searching Hyderabad → Delhi for Friday",
        "Comparing 14 flights",
        "Checking baggage and refund rules",
        "Picking the cheapest morning flight",
      )
      for ((i, line) in steps.withIndex()) {
        s = s.copy(blockCount = (i + 1) * 5, lastLine = line)
        post()
        delay(3_000)
      }
      s = s.copy(pendingConfirmation = PendingConfirmation("demo", "Hold the 7:05 am seat for ₹4,850?", ""))
      post()
      delay(4_000)
      s = s.copy(pendingConfirmation = null, blockCount = 40, lastLine = "Holding the seat")
      post()
      delay(3_000)
      nm.cancel(DEMO_ID)
      runCatching {
        nm.notify(
          DEMO_ID,
          NotificationCompat.Builder(app, Notifications.CHANNEL_TASKS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Done · Find the cheapest flight to Delhi on Friday")
            .setContentText("That was a demo — tasks you start from this phone look like this.")
            .setColor(BLUE)
            .setAutoCancel(true)
            .setTimeoutAfter(15_000)
            .build(),
        )
      }
    }
  }
}
