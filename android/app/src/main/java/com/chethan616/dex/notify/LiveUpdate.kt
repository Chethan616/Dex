package com.chethan616.dex.notify

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.chethan616.dex.R
import com.chethan616.dex.data.PendingConfirmation
import com.chethan616.dex.data.Session
import com.chethan616.dex.data.SessionStatus
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.avatar.botColorArgb
import com.chethan616.dex.ui.avatar.botStill
import com.chethan616.dex.ui.avatar.botTypeFor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A task you started from the phone, as an Android 16 live update — the
 * status-bar pill (OnePlus's Live Alert capsule, a Pixel's chip) that food
 * deliveries and GitHub's agent sessions use.
 *
 * The track runs from your phone to a finish flag, and the task's own bot
 * rides it — the same bot as in the chat, wearing its mood: a thought cloud
 * while it gets going, a grin while it works (hopping a step at a time),
 * wide eyes and an amber "!" when it needs your OK, a sweat drop when stuck.
 * When it's done it sits on the flag, beaming, for a few seconds.
 *
 * The track is honest about what DEX knows: sent (0–10), working (10–90,
 * filling as steps pile up but never reaching the end on its own), done.
 * On older Android it's the same notification without the pill.
 */
object LiveUpdate {
  const val DEMO_ID = 0x0DE6
  private const val SENT = 0xFF35B8FF.toInt()
  private const val GREEN = 0xFF1DB954.toInt()
  private const val BLUE = 0xFF1683FF.toInt()
  private const val CELEBRATE_MS = 6_000L

  /**
   * OnePlus, OPPO and realme (ColorOS) show a live update's sub-text on the
   * card where Pixels show the content text, so the step goes there.
   */
  private val colorOs: Boolean = Build.MANUFACTURER.lowercase().let { m -> listOf("oneplus", "oppo", "realme").any { it in m } }

  /** Where the bot sits on the track, 0–100. */
  fun progressOf(s: Session): Int = when {
    s.blockCount <= 0 -> 6
    else -> 10 + (80.0 * s.blockCount / (s.blockCount + 12.0)).toInt()
  }.coerceIn(0, 89)

  fun moodOf(s: Session): BotMood = when {
    s.pendingConfirmation != null -> BotMood.NeedsYou
    s.status == SessionStatus.Stuck -> BotMood.Sad
    s.blockCount <= 0 -> BotMood.Thinking
    else -> BotMood.Working
  }

  /** The pill's text when a word says more than the timer; null shows the timer. */
  fun chipOf(s: Session): String? = when {
    s.pendingConfirmation != null -> "Approve"
    s.status == SessionStatus.Stuck -> "Stuck"
    else -> null
  }

  fun textOf(s: Session): String = when {
    s.pendingConfirmation != null -> "✋ Needs your OK: ${s.pendingConfirmation.title.ifBlank { "open DEX to answer" }}"
    s.status == SessionStatus.Stuck -> "😅 Stuck — open DEX to help it along"
    s.lastLine.isNotBlank() -> s.lastLine.lineSequence().first().take(200)
    else -> "Getting ready on ${s.deviceName ?: "your PC"}…"
  }

  private fun titleOf(s: Session) = s.prompt.lineSequence().firstOrNull().orEmpty().trim().take(80).ifBlank { "Your task" }

  /** The task's bot as the tracker; working, it hops: every other step it's up and leaning in. */
  private fun tracker(context: Context, s: Session, mood: BotMood): IconCompat {
    val type = botTypeFor(s.engine, s.id)
    val up = mood == BotMood.Working && s.blockCount % 2 == 1
    return runCatching {
      IconCompat.createWithBitmap(
        botStill(
          type, mood, px = 128,
          lookX = if (mood == BotMood.Working || mood == BotMood.Happy) 3f else 0f,
          hop = if (up) 7f else 0f,
          lean = if (up) 7f else 0f,
        ),
      )
    }.getOrElse { IconCompat.createWithResource(context, R.drawable.ic_live_bot) }
  }

  private fun style(context: Context, s: Session, mood: BotMood, progress: Int): NotificationCompat.ProgressStyle {
    // The working stretch is the bot's own colour, its trail — unless the bot
    // is grey or white, which would read as track not yet covered.
    val trail = runCatching { botColorArgb(botTypeFor(s.engine, s.id)) }.getOrDefault(BLUE).let { argb ->
      val hsv = FloatArray(3).also { android.graphics.Color.colorToHSV(argb, it) }
      if (hsv[1] < 0.3f) BLUE else argb
    }
    return NotificationCompat.ProgressStyle()
      .setStyledByProgress(true)
      .setProgressSegments(
        listOf(
          NotificationCompat.ProgressStyle.Segment(10).setColor(SENT),
          NotificationCompat.ProgressStyle.Segment(80).setColor(trail),
          NotificationCompat.ProgressStyle.Segment(10).setColor(GREEN),
        ),
      )
      .setProgressPoints(
        listOf(
          NotificationCompat.ProgressStyle.Point(10).setColor(SENT),
          NotificationCompat.ProgressStyle.Point(90).setColor(GREEN),
        ),
      )
      .setProgressStartIcon(IconCompat.createWithResource(context, R.drawable.ic_live_phone))
      .setProgressEndIcon(IconCompat.createWithResource(context, R.drawable.ic_live_flag))
      .setProgressTrackerIcon(tracker(context, s, mood))
      .setProgress(progress)
  }

  fun build(context: Context, s: Session, others: Int = 0, withActions: Boolean = true): Notification {
    val title = titleOf(s)
    val mood = moodOf(s)
    val text = textOf(s)
    val device = listOfNotNull(s.deviceName, if (others > 0) "+$others more" else null).joinToString(" · ").ifBlank { null }
    val builder = NotificationCompat.Builder(context, Notifications.CHANNEL_LIVE_UPDATES)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setStyle(style(context, s, mood, progressOf(s)))
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
    if (colorOs) builder.setSubText(text) else builder.setContentText(text).setSubText(device)
    chipOf(s)?.let { builder.setShortCriticalText(it) }
    if (withActions) {
      builder.setContentIntent(Notifications.openSession(context, s.id))
      builder.addAction(0, "Stop", Notifications.taskAction(context, TaskActionReceiver.ACTION_STOP, s.id, title))
    }
    return builder.build()
  }

  /**
   * The "delivered!" moment: for a few seconds after a task from this phone
   * finishes, its bot sits on the finish flag, beaming, with the answer's
   * first line. Then it goes, and the usual "Done" notification stays.
   */
  fun finished(context: Context, s: Session, open: Boolean = true) {
    val id = s.id.hashCode() xor 0x5EED
    val title = titleOf(s)
    val answer = (s.summary ?: s.lastLine).lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }?.take(200)
    val text = "🎉 " + (answer ?: "Done")
    val builder = NotificationCompat.Builder(context, Notifications.CHANNEL_LIVE_UPDATES)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setStyle(style(context, s, BotMood.Happy, 100))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setRequestPromotedOngoing(true)
      .setShortCriticalText("Done")
      .setShowWhen(false)
      .setColor(GREEN)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setTimeoutAfter(CELEBRATE_MS)
    if (colorOs) builder.setSubText(text) else builder.setContentText(text).setSubText(s.deviceName)
    if (open) builder.setContentIntent(Notifications.openSession(context, s.id)).setAutoCancel(true)
    val nm = NotificationManagerCompat.from(context)
    runCatching { nm.notify(id, builder.build()) }
    // The timeout is the system's; this is in case it keeps an ongoing one.
    Handler(Looper.getMainLooper()).postDelayed({ runCatching { nm.cancel(id) } }, CELEBRATE_MS)
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
   * A pretend task, about 30 seconds, so you can see the pill without your
   * PC: getting ready, steps (the bot hops along), an approval, then the
   * finish. Nothing is sent anywhere.
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
        s = s.copy(blockCount = 1 + i * 5, lastLine = line)
        post()
        delay(1_500)
        s = s.copy(blockCount = s.blockCount + 2)   // a hop between steps
        post()
        delay(1_500)
      }
      s = s.copy(pendingConfirmation = PendingConfirmation("demo", "Hold the 7:05 am seat for ₹4,850?", ""))
      post()
      delay(4_000)
      s = s.copy(pendingConfirmation = null, blockCount = 41, lastLine = "Holding the seat")
      post()
      delay(2_500)
      nm.cancel(DEMO_ID)
      finished(app, s.copy(status = SessionStatus.Idle, summary = "Held the 7:05 am IndiGo seat for ₹4,850"), open = false)
      delay(CELEBRATE_MS)
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
