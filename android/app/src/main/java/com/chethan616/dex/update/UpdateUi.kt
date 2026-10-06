package com.chethan616.dex.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chethan616.dex.BuildConfig
import com.chethan616.dex.ui.haptics.LocalHaptics

/** The words for each step, shared by Settings › About and Home's banner. */
internal fun UpdateState.status(canInstall: Boolean): String = when (this) {
  UpdateState.Idle -> "Updates come from GitHub Releases, like the desktop’s."
  UpdateState.Checking -> "Checking GitHub for a new version…"
  is UpdateState.UpToDate -> "You’re on the latest version."
  is UpdateState.Available -> "DEX ${update.version} is out" + (if (update.size > 0) " · ${update.size / (1024 * 1024)} MB." else ".")
  is UpdateState.Downloading -> "Downloading ${update.version}…" + (if (progress >= 0f) " ${(progress * 100).toInt()}%" else "")
  is UpdateState.Ready ->
    if (canInstall) "${update.version} is downloaded. Install it over this version."
    else "${update.version} is downloaded. Allow DEX to install apps, then come back."
  is UpdateState.Failed -> message
}

/** The button's label, or null while it's working (checking, downloading). */
internal fun UpdateState.action(): String? = when (this) {
  UpdateState.Checking, is UpdateState.Downloading -> null
  is UpdateState.Available -> "Update"
  is UpdateState.Ready -> "Install"
  is UpdateState.Failed -> if (update != null) "Retry" else "Check"
  else -> "Check for updates"
}

/** Settings' one-line status: short enough to never wrap the title. */
internal fun UpdateState.rowStatus(canInstall: Boolean): String {
  val mine = "Version ${BuildConfig.VERSION_NAME}"
  return when (this) {
    UpdateState.Idle -> mine
    UpdateState.Checking -> "$mine · checking…"
    is UpdateState.UpToDate -> "$mine · up to date"
    is UpdateState.Available -> "${update.version} is out" + (if (update.size > 0) " · ${update.size / (1024 * 1024)} MB" else "")
    is UpdateState.Downloading -> "Getting ${update.version}" + (if (progress >= 0f) " · ${(progress * 100).toInt()}%" else "…")
    is UpdateState.Ready -> if (canInstall) "${update.version} is ready to install" else "Allow DEX to install apps, then come back"
    is UpdateState.Failed -> message
  }
}

/**
 * Settings › Updates: one quiet row, like the rest of Settings — the app and
 * its version, what GitHub says, and a small control on the end. A filled
 * button only when there's something to get; otherwise a round "check again".
 */
@Composable
fun UpdateRow(icon: @Composable () -> Unit) {
  val context = LocalContext.current
  val haptics = LocalHaptics.current
  val state = AppUpdater.state.collectAsStateWithLifecycle().value
  androidx.compose.runtime.LaunchedEffect(Unit) { AppUpdater.check(context) }
  androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
    AppUpdater.resumed(context)
    onPauseOrDispose { }
  }
  val busy = state is UpdateState.Checking || state is UpdateState.Downloading
  Column(Modifier.fillMaxWidth()) {
    Row(
      Modifier
        .fillMaxWidth()
        .clickable(enabled = !busy) { haptics.tick(); AppUpdater.act(context) }
        .padding(16.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      icon()
      Spacer(Modifier.size(14.dp))
      Column(Modifier.weight(1f)) {
        Text("DEX for Android", style = MaterialTheme.typography.titleSmall, maxLines = 1)
        Text(
          state.rowStatus(AppUpdater.canInstall(context)),
          style = MaterialTheme.typography.bodySmall,
          color = if (state is UpdateState.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
      Spacer(Modifier.size(8.dp))
      when {
        // Downloading shows its own bar below; a spinner too would say it twice.
        state is UpdateState.Downloading -> Unit
        busy -> LoadingIndicator(Modifier.size(32.dp))
        state is UpdateState.Available || state is UpdateState.Ready ->
          Button(
            onClick = { haptics.click(); AppUpdater.act(context) },
            shapes = ButtonDefaults.shapes(),
            contentPadding = ButtonDefaults.SmallContentPadding,
          ) { Text(state.action().orEmpty()) }
        else ->
          FilledTonalIconButton(
            onClick = { haptics.tick(); AppUpdater.act(context) },
            shapes = IconButtonDefaults.shapes(),
          ) { Icon(Icons.Rounded.Refresh, contentDescription = "Check for updates") }
      }
    }
    if (state is UpdateState.Downloading) {
      Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) { DownloadBar(state.progress) }
    }
  }
}

/** Home: shown only while there's an update to get (or one coming in). */
@Composable
fun UpdateBanner(state: UpdateState) {
  val context = LocalContext.current
  val haptics = LocalHaptics.current
  androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
    AppUpdater.resumed(context)
    onPauseOrDispose { }
  }
  val scheme = MaterialTheme.colorScheme
  val title = when (state) {
    is UpdateState.Available -> "DEX ${state.update.version} is out"
    is UpdateState.Downloading -> "Getting DEX ${state.update.version}"
    is UpdateState.Ready -> "DEX ${state.update.version} is ready"
    else -> "DEX update"
  }
  val label = state.action()
  androidx.compose.material3.Surface(
    shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
    color = scheme.tertiaryContainer,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text(title, style = MaterialTheme.typography.titleSmall, color = scheme.onTertiaryContainer)
          Text(
            state.status(AppUpdater.canInstall(context)),
            style = MaterialTheme.typography.bodySmall,
            color = if (state is UpdateState.Failed) scheme.error else scheme.onTertiaryContainer.copy(alpha = 0.75f),
          )
        }
        if (label != null) {
          androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp))
          Button(onClick = { haptics.click(); AppUpdater.act(context) }, shapes = ButtonDefaults.shapes()) { Text(label) }
        }
      }
      if (state is UpdateState.Downloading) DownloadBar(state.progress, color = scheme.onTertiaryContainer)
    }
  }
}

@Composable
private fun DownloadBar(progress: Float, color: Color = MaterialTheme.colorScheme.primary) {
  if (progress >= 0f) LinearWavyProgressIndicator(progress = { progress }, color = color, modifier = Modifier.fillMaxWidth())
  else LinearWavyProgressIndicator(color = color, modifier = Modifier.fillMaxWidth())
}
