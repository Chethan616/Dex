package com.chethan616.dex.ui.screens.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.theme.MonoStyle

/** Shown by builds without google-services.json: says exactly what's missing. */
@Composable
fun FirebaseSetupScreen() {
  Surface(Modifier.fillMaxSize()) {
    Column(
      Modifier.safeDrawingPadding().padding(24.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center,
    ) {
      BotAvatar(type = "droid", mood = BotMood.Sleeping, size = 120.dp)
      Spacer(Modifier.height(20.dp))
      Text("One step left", style = MaterialTheme.typography.headlineMedium)
      Spacer(Modifier.height(8.dp))
      Text(
        "This build isn’t connected to a Firebase project yet, so it can’t reach your PC.",
        style = MaterialTheme.typography.bodyLarge,
        textAlign = TextAlign.Center,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Spacer(Modifier.height(20.dp))
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text("1. Run firebase/setup.ps1 from the DEX repo", style = MonoStyle)
          Text("2. Put google-services.json in android/app/", style = MonoStyle)
          Text("3. Rebuild the app", style = MonoStyle)
        }
      }
    }
  }
}
