package com.chethan616.dex.notify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Up only while a task is running on the PC: a quiet ongoing notification
 * ("Working on your PC · <task>") that updates with the agent's latest step
 * and goes away the moment nothing is running. Being a foreground service is
 * what lets [TaskWatcher] keep listening when the app is in the background,
 * so the "Done" notification actually arrives.
 */
class TaskWatchService : Service() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var watch: Job? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val first = TaskWatcher.live.value
    ServiceCompat.startForeground(
      this,
      Notifications.LIVE_ID,
      Notifications.live(this, first),
      if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
    )
    running = true
    if (watch == null) {
      watch = scope.launch {
        TaskWatcher.live.collect { live ->
          if (live.isEmpty()) {
            ServiceCompat.stopForeground(this@TaskWatchService, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
          } else {
            runCatching { NotificationManagerCompat.from(this@TaskWatchService).notify(Notifications.LIVE_ID, Notifications.live(this@TaskWatchService, live)) }
          }
        }
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    scope.cancel()
    super.onDestroy()
  }

  companion object {
    @Volatile private var running = false

    fun ensureRunning(context: Context) {
      if (running) return
      // Android only lets an app start a foreground service while it's in
      // the foreground; a task started on the PC while the phone app sits in
      // the background just gets the normal notifications while alive.
      runCatching { ContextCompat.startForegroundService(context, Intent(context, TaskWatchService::class.java)) }
    }
  }
}
