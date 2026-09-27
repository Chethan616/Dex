package com.chethan616.dex

import android.app.Application
import android.content.Context
import com.chethan616.dex.data.AuthRepository
import com.chethan616.dex.data.DexRepository
import com.chethan616.dex.data.Prefs
import com.chethan616.dex.notify.Notifications
import com.chethan616.dex.notify.TaskWatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/** Hand-wired dependencies — the app is small enough not to need a DI framework. */
class AppContainer(context: Context) {
  val prefs = Prefs(context)
  val firebaseReady: Boolean = BuildConfig.HAS_FIREBASE
  val auth: AuthRepository by lazy { AuthRepository(context) }
  val repo: DexRepository by lazy { DexRepository(context) }
}

class DexApp : Application() {
  lateinit var container: AppContainer
    private set

  private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  override fun onCreate() {
    super.onCreate()
    container = AppContainer(this)
    Notifications.createChannels(this)
    // Local notifications for as long as the process lives (see TaskWatcher).
    if (container.firebaseReady) {
      appScope.launch {
        container.auth.account.collectLatest { account ->
          while (account != null) {
            runCatching { TaskWatcher.run(this@DexApp, container.repo) }
            delay(5_000) // listener dropped (offline, token refresh) — pick it back up
          }
        }
      }
    }
  }
}

val Context.container: AppContainer get() = (applicationContext as DexApp).container
