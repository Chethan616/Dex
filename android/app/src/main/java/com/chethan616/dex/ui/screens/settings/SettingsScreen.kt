package com.chethan616.dex.ui.screens.settings

import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.chethan616.dex.notify.LiveUpdate
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.SystemUpdate
import com.chethan616.dex.ui.components.springPress
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.Vibration
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.chethan616.dex.AppContainer
import com.chethan616.dex.BuildConfig
import com.chethan616.dex.data.Account
import com.chethan616.dex.data.ThemeMode
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.components.relativeTime
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.theme.LocalStatusColors
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
  container: AppContainer,
  account: Account,
  onBack: () -> Unit,
  onOpenTour: () -> Unit = {},
) {
  val haptics = LocalHaptics.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val theme by container.prefs.theme.collectAsStateWithLifecycle()
  val dynamic by container.prefs.dynamicColor.collectAsStateWithLifecycle()
  val hapticsOn by container.prefs.haptics.collectAsStateWithLifecycle()
  val desktopsFlow = androidx.compose.runtime.remember { container.repo.desktops() }
  val desktops by desktopsFlow.collectAsStateWithLifecycle(initialValue = emptyList())
  val status = LocalStatusColors.current
  val profile = com.chethan616.dex.ui.profile.LocalDexProfile.current
  var pickerOpen by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf(false) }
  val desktop = desktops.firstOrNull { it.isReachable } ?: desktops.firstOrNull()
  // Optimistic: the desktop confirms by re-publishing its device row.
  var pendingMode by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
  val approvalMode = pendingMode ?: desktop?.approvalMode
  androidx.compose.runtime.LaunchedEffect(desktop?.approvalMode) { if (desktop?.approvalMode == pendingMode) pendingMode = null }

  // A Surface, not a background modifier: it also sets the content colour, so
  // the title and back arrow are onSurface instead of the default black.
  Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
  Column(
    Modifier
      .fillMaxSize()
      .statusBarsPadding()
      .navigationBarsPadding()
      .verticalScroll(rememberScrollState())
      .padding(horizontal = 16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
      IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
      Text("Settings", style = MaterialTheme.typography.headlineMedium)
    }

    // Account
    Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.primaryContainer) {
      Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
        com.chethan616.dex.ui.components.ShapeBadge(
          androidx.compose.material3.MaterialShapes.Cookie12Sided,
          MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.12f),
          76.dp,
          spinMs = 36_000,
        ) {
          com.chethan616.dex.ui.profile.DexAvatar(size = 58.dp)
        }
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
          Text(profile?.name ?: account.displayName, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
          Text(account.email.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.75f))
        }
      }
    }

    Group("Your PCs") {
      if (desktops.isEmpty()) {
        Row(Modifier.padding(16.dp)) {
          Text(
            "None yet — in DEX on your PC, open Settings → Accounts → DEX on your phone and sign in with this same email and password.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
      desktops.forEach { d ->
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
          RowIcon(Icons.Rounded.Computer)
          Spacer(Modifier.size(14.dp))
          Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(d.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
              Spacer(Modifier.size(8.dp))
              val color = if (d.isReachable) status.running else status.stopped
              Row(
                Modifier.background(color.copy(alpha = 0.14f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
              ) {
                Box(Modifier.size(6.dp).background(color, CircleShape))
                Spacer(Modifier.size(5.dp))
                Text(if (d.isReachable) "Online" else "Offline", style = MaterialTheme.typography.labelSmall, color = color)
              }
            }
            Text(
              if (d.isReachable) d.engines.joinToString(" · ") { it.name } else "Last seen ${relativeTime(d.lastSeenMs)}",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
        }
      }
    }

    Group("Agent approval") {
      Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val modes = listOf(
          Triple("ask", "Ask", "Anything sensitive waits for your OK — on the PC or right here."),
          Triple("auto", "Approve for me", "Only asks when a command or path looks risky."),
          Triple("full", "Full access", "Nothing gated except Windows registry writes."),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween), modifier = Modifier.fillMaxWidth()) {
          modes.forEachIndexed { i, (id, label, _) ->
            ToggleButton(
              checked = approvalMode == id,
              enabled = desktop?.isReachable == true,
              onCheckedChange = {
                haptics.tick()
                pendingMode = id
                scope.launch { runCatching { container.repo.send(com.chethan616.dex.data.CommandType.SetApprovalMode, mapOf("mode" to id)) } }
              },
              shapes = when (i) {
                0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                modes.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
              },
              contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp),
              modifier = Modifier.weight(1f),
            ) { Text(label, maxLines = 1, softWrap = false, style = MaterialTheme.typography.labelLarge) }
          }
        }
        Text(
          when {
            desktop == null -> "Connect DEX on your PC to change how much it can do on its own."
            !desktop.isReachable -> "Your PC is offline — this changes when it’s back."
            else -> modes.firstOrNull { it.first == approvalMode }?.third ?: "Reading your PC’s setting…"
          },
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }

    Group("Appearance") {
      Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          com.chethan616.dex.ui.profile.DexAvatar(size = 52.dp)
          Spacer(Modifier.size(14.dp))
          Column(Modifier.weight(1f)) {
            Text(profile?.name ?: "Your DEX", style = MaterialTheme.typography.titleSmall)
            Text("The bot that represents you, here and on your PC.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          androidx.compose.material3.FilledTonalButton(onClick = { haptics.click(); pickerOpen = true }, shapes = ButtonDefaults.shapes()) { Text("Change") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween), modifier = Modifier.fillMaxWidth()) {
          val options = listOf(
            Triple(ThemeMode.System, "System", Icons.Rounded.PhoneAndroid),
            Triple(ThemeMode.Light, "Light", Icons.Rounded.LightMode),
            Triple(ThemeMode.Dark, "Dark", Icons.Rounded.DarkMode),
          )
          options.forEachIndexed { i, (mode, label, icon) ->
            ToggleButton(
              checked = theme == mode,
              onCheckedChange = { haptics.tick(); container.prefs.setTheme(mode) },
              shapes = when (i) {
                0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                options.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
              },
              contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp),
              modifier = Modifier.weight(1f),
            ) {
              // Icon only on the chosen option, so three labels fit one line on any phone.
              androidx.compose.animation.AnimatedVisibility(theme == mode) {
                Row {
                  Icon(icon, null, Modifier.size(18.dp))
                  Spacer(Modifier.size(ToggleButtonDefaults.IconSpacing))
                }
              }
              Text(label, maxLines = 1, softWrap = false)
            }
          }
        }
        if (Build.VERSION.SDK_INT >= 31) {
          SwitchRow(Icons.Rounded.Palette, "Colours from your wallpaper", "Material You dynamic colour", dynamic) {
            haptics.toggle(it); container.prefs.setDynamicColor(it)
          }
        }
      }
    }

    Group("Feel") {
      SwitchRow(Icons.Rounded.Vibration, "Haptics", "Taps, sends, approvals and finished tasks", hapticsOn) {
        container.prefs.setHaptics(it)
        if (it) haptics.success()
      }
      SettingRow(Icons.Rounded.Notifications, "Notifications", "Task updates and approvals") {
        haptics.click()
        context.startActivity(
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
      // Android 16's status-bar pill for tasks started from this phone (notify/LiveUpdate.kt).
      var live by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(LiveUpdate.status(context)) }
      androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
        live = LiveUpdate.status(context)
        onPauseOrDispose { }
      }
      fun openNotificationSettings(promotion: Boolean) {
        val action = if (promotion && Build.VERSION.SDK_INT >= 36 && Build.VERSION.SDK_INT_FULL >= Build.VERSION_CODES_FULL.BAKLAVA_1) {
          Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS
        } else {
          Settings.ACTION_APP_NOTIFICATION_SETTINGS
        }
        runCatching {
          context.startActivity(Intent(action).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
      }
      SettingRow(
        Icons.Rounded.Timer,
        "Live updates",
        when (live) {
          LiveUpdate.Status.On -> "On · tasks you start here show in the status bar until they're done"
          LiveUpdate.Status.Off -> "Off · tap to let DEX show tasks in the status bar"
          LiveUpdate.Status.NeedsAndroid16 -> "Needs Android 16 · tasks still show as a notification"
          LiveUpdate.Status.NotificationsOff -> "Notifications are off · tap to turn them on"
        },
      ) {
        haptics.click()
        openNotificationSettings(promotion = live == LiveUpdate.Status.Off)
      }
      SettingRow(Icons.Rounded.PlayCircle, "Try a live update", "A 30-second pretend task. Go to your home screen to watch it") {
        if (live == LiveUpdate.Status.NotificationsOff) {
          haptics.reject()
          openNotificationSettings(promotion = false)
        } else {
          haptics.success()
          LiveUpdate.demo(context)
        }
      }
    }

    // Like the desktop's: checks GitHub Releases, downloads in the app, installs over this one.
    Group("Updates") {
      com.chethan616.dex.update.UpdateRow { RowIcon(Icons.Rounded.SystemUpdate) }
    }

    Group("About") {
      SettingRow(Icons.Rounded.AutoAwesome, "Welcome tour", "What DEX on your phone can do") {
        haptics.click()
        onOpenTour()
      }
      Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
          "Thinking orbs and bot avatars from Libraries.dev (MIT, Jakub Antalik). Material 3 Expressive patterns after meticha/material-3-expressive-catalog (Apache 2.0).",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }

    if (pickerOpen && profile != null) {
      val sheetMax = com.chethan616.dex.ui.components.rememberSheetMaxHeight()
      androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = { pickerOpen = false },
        shape = RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp),
        // See rememberSheetMaxHeight: a fixed-height sheet settles, so taps work after a swipe.
        contentWindowInsets = { com.chethan616.dex.ui.components.NoSheetInsets },
      ) {
        // No scroll here: the picker scrolls its own avatars and keeps the
        // buttons pinned (pinActions) above the navigation bar.
        Column(Modifier.heightIn(max = sheetMax).padding(horizontal = 20.dp)) {
          Text("Your DEX", style = MaterialTheme.typography.headlineSmall)
          Spacer(Modifier.size(16.dp))
          com.chethan616.dex.ui.profile.ProfilePicker(
            initial = profile,
            saveLabel = "Save",
            pinActions = true,
            onCancel = { pickerOpen = false },
            onSave = { bot, color, name -> runCatching { container.repo.setProfile(bot, color, name) }; pickerOpen = false },
          )
        }
      }
    }

    OutlinedButton(
      onClick = { haptics.reject(); container.auth.signOut() },
      shapes = ButtonDefaults.shapes(),
      modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
    ) {
      Icon(Icons.AutoMirrored.Rounded.Logout, null)
      Spacer(Modifier.size(8.dp))
      Text("Sign out")
    }
    Spacer(Modifier.size(24.dp))
  }
  }
}

@Composable
private fun Group(title: String, content: @Composable () -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 8.dp, top = 8.dp))
    Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
      Column { content() }
    }
  }
}

@Composable
private fun SwitchRow(icon: ImageVector, title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
  Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
    RowIcon(icon)
    Spacer(Modifier.size(14.dp))
    Column(Modifier.weight(1f)) {
      Text(title, style = MaterialTheme.typography.titleSmall)
      Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Switch(
      checked = checked,
      onCheckedChange = onChange,
      thumbContent = {
        Icon(
          if (checked) Icons.Rounded.Check else Icons.Rounded.Close,
          null,
          Modifier.size(androidx.compose.material3.SwitchDefaults.IconSize),
        )
      },
    )
  }
}

@Composable
private fun SettingRow(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
  val press = androidx.compose.runtime.remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
  Surface(
    onClick = onClick,
    color = androidx.compose.ui.graphics.Color.Transparent,
    interactionSource = press,
    modifier = Modifier.springPress(press, 0.98f),
  ) {
    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
      RowIcon(icon)
      Spacer(Modifier.size(14.dp))
      Column(Modifier.weight(1f)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

private val ROW_SHAPES = listOf(
  androidx.compose.material3.MaterialShapes.Cookie4Sided,
  androidx.compose.material3.MaterialShapes.Clover4Leaf,
  androidx.compose.material3.MaterialShapes.Sunny,
  androidx.compose.material3.MaterialShapes.Cookie6Sided,
  androidx.compose.material3.MaterialShapes.Pill,
)

/** A row's icon on a shape of its own (picked from the icon, so it never changes). */
@Composable
private fun RowIcon(icon: ImageVector) {
  val i = (icon.name.hashCode() and 0x7fffffff) % ROW_SHAPES.size
  com.chethan616.dex.ui.components.ShapeBadge(
    ROW_SHAPES[i],
    MaterialTheme.colorScheme.secondaryContainer,
    40.dp,
    spinMs = 22_000 + i * 4_000,
  ) { Icon(icon, null, tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(20.dp)) }
}
