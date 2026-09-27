package com.chethan616.dex

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chethan616.dex.notify.Notifications
import com.chethan616.dex.ui.DexRoot
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.haptics.rememberHaptics
import com.chethan616.dex.ui.theme.DexTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {

  /** A session to open, from a notification tap. Consumed by the nav host. */
  private val openSession = MutableStateFlow<String?>(null)

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    openSession.value = intent.getStringExtra(Notifications.EXTRA_SESSION_ID)

    val c = container
    setContent {
      val theme by c.prefs.theme.collectAsStateWithLifecycle()
      val dynamic by c.prefs.dynamicColor.collectAsStateWithLifecycle()
      DexTheme(mode = theme, dynamicColor = dynamic) {
        val haptics = rememberHaptics { c.prefs.haptics.value }
        CompositionLocalProvider(LocalHaptics provides haptics) {
          DexRoot(container = c, openSession = openSession)
        }
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    intent.getStringExtra(Notifications.EXTRA_SESSION_ID)?.let { openSession.value = it }
  }
}
