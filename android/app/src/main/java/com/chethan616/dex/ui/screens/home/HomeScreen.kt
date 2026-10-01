package com.chethan616.dex.ui.screens.home

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.speech.RecognizerIntent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Mail
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.VideoCall
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FloatingActionButtonMenu
import androidx.compose.material3.FloatingActionButtonMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleFloatingActionButton
import androidx.compose.material3.ToggleFloatingActionButtonDefaults.animateIcon
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.chethan616.dex.AppContainer
import com.chethan616.dex.data.Account
import com.chethan616.dex.data.CommandState
import com.chethan616.dex.data.Device
import com.chethan616.dex.data.Session
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.avatar.botTypeFor
import com.chethan616.dex.ui.avatar.rememberBotMood
import com.chethan616.dex.ui.components.ShapeBadge
import androidx.compose.material3.MaterialShapes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.delay
import com.chethan616.dex.ui.components.ENGINE_NAMES
import com.chethan616.dex.ui.components.PromptBar
import com.chethan616.dex.ui.components.StatusDot
import com.chethan616.dex.ui.components.StatusPill
import com.chethan616.dex.ui.components.relativeTime
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.orb.DexOrb
import com.chethan616.dex.ui.theme.LocalStatusColors
import com.jakubantalik.thinkingorbs.OrbState
import java.util.Calendar
import kotlinx.coroutines.launch

private data class Suggestion(val icon: ImageVector, val label: String, val prompt: String)

/** Each suggestion tile wears its own shape and colour. */
private val TILE_SHAPES = listOf(MaterialShapes.Cookie9Sided, MaterialShapes.Clover4Leaf, MaterialShapes.Sunny, MaterialShapes.Pill)

private val SUGGESTIONS = listOf(
  Suggestion(Icons.Rounded.Mail, "Unread email", "Summarize my unread email from today and flag anything urgent."),
  Suggestion(Icons.Rounded.CalendarMonth, "Today’s calendar", "What’s on my calendar today? List times and who I’m meeting."),
  Suggestion(Icons.Rounded.VideoCall, "Start a Meet", "Create a Google Meet for 30 minutes starting now and give me the link."),
  Suggestion(Icons.Rounded.Edit, "Draft a reply", "Draft a polite reply to the most recent email that needs a response."),
)

@Composable
fun HomeScreen(
  container: AppContainer,
  account: Account,
  sharedScope: SharedTransitionScope,
  animatedScope: AnimatedVisibilityScope,
  onOpenSession: (String) -> Unit,
  onOpenSettings: () -> Unit,
  shared: kotlinx.coroutines.flow.MutableStateFlow<com.chethan616.dex.share.SharedContent?> = kotlinx.coroutines.flow.MutableStateFlow(null),
) {
  val vm: HomeViewModel = viewModel(factory = HomeViewModel.factory(container))
  // One set of attachments for the prompt bar and the full sheet alike.
  val attach = com.chethan616.dex.ui.attach.rememberAttachmentState()
  val pickers = com.chethan616.dex.ui.attach.rememberAttachPickers(attach)
  var sharedNow by remember { mutableStateOf<com.chethan616.dex.share.SharedContent?>(null)}
  val state by vm.state.collectAsStateWithLifecycle()
  val refreshing by vm.refreshing.collectAsStateWithLifecycle()
  val haptics = LocalHaptics.current

  var sheetOpen by rememberSaveable { mutableStateOf(false) }
  var prefill by rememberSaveable { mutableStateOf("") }
  var fabExpanded by rememberSaveable { mutableStateOf(false) }
  BackHandler(fabExpanded) { fabExpanded = false }

  // The inline prompt bar sends straight away and follows the command until
  // the PC answers with a session id — then opens that session.
  val scope = rememberCoroutineScope()
  var sending by remember { mutableStateOf(false) }
  var sendStatus by remember { mutableStateOf<String?>(null) }
  fun startTask(prompt: String, engine: String?, model: String?) {
    val pc = state.desktop
    val files = attach.items.toList()
    sending = true
    sendStatus = when {
      files.isNotEmpty() -> "Sending ${files.size} file${if (files.size > 1) "s" else ""} to ${pc?.name ?: "your PC"}…"
      pc?.isReachable == true -> "Sending to ${pc.name}…"
      else -> "Queued — ${pc?.name ?: "your PC"} is offline; it starts when it’s back"
    }
    scope.launch {
      vm.newTask(prompt, engine, model, files) { attach.uploadProgress = it }.collect { cmd ->
        when (cmd) {
          CommandState.Pending -> Unit
          CommandState.Running -> sendStatus = "Starting on ${pc?.name ?: "your PC"}…"
          is CommandState.Done -> {
            sending = false
            val id = cmd.result["sessionId"] as? String
            if (id != null) { sendStatus = null; attach.items.clear(); haptics.success(); onOpenSession(id) }
            else { haptics.reject(); sendStatus = cmd.result["error"] as? String ?: "Your PC couldn’t start that." }
          }
          is CommandState.Failed -> { sending = false; haptics.reject(); sendStatus = cmd.error }
        }
      }
    }
  }

  fun openComposer(text: String = "") {
    prefill = text
    sharedNow = null
    sheetOpen = true
  }

  // Share → DEX from another app: copy what came in, open the sheet with it.
  val incoming by shared.collectAsStateWithLifecycle()
  LaunchedEffect(incoming) {
    val s = incoming ?: return@LaunchedEffect
    shared.value = null
    attach.items.clear()
    prefill = listOfNotNull(s.subject?.takeIf { it != s.text }, s.text).joinToString("\n")
    sharedNow = s
    sheetOpen = true
    attach.add(s.uris)
  }

  // Newer APK on GitHub Releases? (checked once per launch)
  val update by androidx.compose.runtime.produceState<com.chethan616.dex.update.AppUpdate?>(null) {
    value = com.chethan616.dex.update.ReleaseChecker.check()
  }

  val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
  LaunchedEffect(Unit) {
    if (Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
  }

  val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
    val text = res.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
    if (res.resultCode == Activity.RESULT_OK && !text.isNullOrBlank()) {
      haptics.confirm()
      openComposer(text)
    }
  }
  fun startVoice() {
    haptics.click()
    runCatching {
      voice.launch(
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
          .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          .putExtra(RecognizerIntent.EXTRA_PROMPT, "What should DEX do?"),
      )
    }
  }

  Scaffold(
    floatingActionButton = {
      FloatingActionButtonMenu(
        expanded = fabExpanded,
        button = {
          ToggleFloatingActionButton(
            checked = fabExpanded,
            onCheckedChange = { haptics.toggle(it); fabExpanded = it },
          ) {
            val icon = if (checkedProgress > 0.5f) Icons.Rounded.Close else Icons.Rounded.Add
            Icon(rememberVectorPainter(icon), contentDescription = "New", modifier = Modifier.animateIcon({ checkedProgress }))
          }
        },
      ) {
        FloatingActionButtonMenuItem(
          onClick = { fabExpanded = false; haptics.click(); openComposer() },
          text = { Text("New task") },
          icon = { Icon(Icons.Rounded.Edit, null) },
        )
        FloatingActionButtonMenuItem(
          onClick = { fabExpanded = false; startVoice() },
          text = { Text("Say it") },
          icon = { Icon(Icons.Rounded.Mic, null) },
        )
        FloatingActionButtonMenuItem(
          onClick = { fabExpanded = false; haptics.click(); openComposer(SUGGESTIONS[0].prompt) },
          text = { Text("Check my email") },
          icon = { Icon(Icons.Rounded.Mail, null) },
        )
        FloatingActionButtonMenuItem(
          onClick = { fabExpanded = false; haptics.click(); openComposer(SUGGESTIONS[2].prompt) },
          text = { Text("Start a Meet") },
          icon = { Icon(Icons.Rounded.VideoCall, null) },
        )
      }
    },
  ) { inner ->
    val pull = rememberPullToRefreshState()
    PullToRefreshBox(
      isRefreshing = refreshing,
      onRefresh = { haptics.tick(); vm.refresh() },
      state = pull,
      modifier = Modifier.fillMaxSize(),
      indicator = {
        PullToRefreshDefaults.LoadingIndicator(
          state = pull,
          isRefreshing = refreshing,
          modifier = Modifier.align(Alignment.TopCenter).padding(top = inner.calculateTopPadding()),
        )
      },
    ) {
      val insets = WindowInsets.safeDrawing.asPaddingValues()
      LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = insets.calculateTopPadding() + 8.dp, bottom = 120.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
      ) {
        item(key = "header") { Header(account, onOpenSettings) }
        update?.let { u -> item(key = "update") { UpdateBanner(u) } }
        item(key = "desktop") { DesktopCard(state.desktop, state.loading) }
        item(key = "composer") {
          PromptBar(
            engines = state.desktop?.engines?.takeIf { it.isNotEmpty() } ?: FALLBACK_ENGINES,
            initialEngine = container.prefs.lastEngine.value,
            busy = sending,
            status = sendStatus,
            onSend = ::startTask,
            onVoice = ::startVoice,
            onMore = { openComposer() },
            attachments = attach,
            pickers = pickers,
          )
        }
        item(key = "suggestions") {
          LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(SUGGESTIONS.size) { i ->
              SuggestionTile(SUGGESTIONS[i], i) { haptics.tick(); openComposer(SUGGESTIONS[i].prompt) }
            }
          }
        }

        if (state.loading) {
          item(key = "loading") {
            Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { LoadingIndicator(Modifier.size(56.dp)) }
          }
        }

        if (state.needsYou.isNotEmpty()) {
          item(key = "h-needs") { SectionTitle("Needs you", state.needsYou.size) }
          items(state.needsYou, key = { "n-" + it.id }) { s ->
            Box(Modifier.animateItem()) {
              ApprovalCard(s, onOpen = { onOpenSession(s.id) }, onAnswer = { ok ->
                if (ok) haptics.confirm() else haptics.reject()
                vm.answer(s, ok)
              })
            }
          }
        }
        if (state.running.isNotEmpty()) {
          item(key = "h-running") { SectionTitle("Running", state.running.size) }
          items(state.running, key = { "r-" + it.id }) { s ->
            Box(Modifier.animateItem()) {
              RunningCard(s, sharedScope, animatedScope) { haptics.tick(); onOpenSession(s.id) }
            }
          }
        }
        if (state.recent.isNotEmpty()) {
          item(key = "h-recent") { SectionTitle("Recent", null) }
          item(key = "recent") {
            // One grouped card: tight 3dp seams, big outer corners.
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
              state.recent.forEachIndexed { i, s ->
                androidx.compose.runtime.key(s.id) {
                  SessionRow(s, i, state.recent.size, sharedScope, animatedScope) { haptics.tick(); onOpenSession(s.id) }
                }
              }
            }
          }
        }
        if (!state.loading && state.sessions.isEmpty()) {
          item(key = "empty") { EmptyState(onStart = { openComposer() }) }
        }
      }
    }
  }

  if (sheetOpen) {
    NewTaskSheet(
      prefill = prefill,
      desktop = state.desktop,
      lastEngine = container.prefs.lastEngine.value,
      send = { p, e, m -> vm.newTask(p, e, m, attach.items.toList()) { attach.uploadProgress = it } },
      onDismiss = { sheetOpen = false; sharedNow = null },
      onStarted = { id -> sheetOpen = false; sharedNow = null; attach.items.clear(); onOpenSession(id) },
      onVoice = ::startVoice,
      attachments = attach,
      pickers = pickers,
      shared = sharedNow,
    )
  }
}

@Composable
private fun Header(account: Account, onOpenSettings: () -> Unit) {
  val haptics = LocalHaptics.current
  val hour = remember { Calendar.getInstance().get(Calendar.HOUR_OF_DAY) }
  val greeting = when (hour) { in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; in 17..21 -> "Good evening"; else -> "Up late" }
  // It's pleased to see you, then settles down.
  var hello by remember { mutableStateOf(true) }
  LaunchedEffect(Unit) { delay(2800); hello = false }
  val scheme = MaterialTheme.colorScheme
  val (backdrop, tone) = when (hour) {
    in 5..11 -> MaterialShapes.Sunny to scheme.tertiaryContainer
    in 12..16 -> MaterialShapes.SoftBurst to scheme.primaryContainer
    in 17..21 -> MaterialShapes.Cookie12Sided to scheme.secondaryContainer
    else -> MaterialShapes.Puffy to scheme.surfaceContainerHighest
  }
  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)) {
    ShapeBadge(backdrop, tone, 64.dp, spinMs = 30_000) {
      com.chethan616.dex.ui.profile.DexAvatar(size = 50.dp, mood = if (hello) BotMood.Happy else BotMood.Idle)
    }
    Spacer(Modifier.size(12.dp))
    Column(Modifier.weight(1f)) {
      Text(greeting + ",", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(account.firstName, style = MaterialTheme.typography.headlineLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    FilledTonalIconButton(
      onClick = { haptics.click(); onOpenSettings() },
      shapes = IconButtonDefaults.shapes(),
    ) { Icon(Icons.Rounded.Settings, "Settings") }
  }
}

@Composable
private fun DesktopCard(desktop: Device?, loading: Boolean) {
  val scheme = MaterialTheme.colorScheme
  val status = LocalStatusColors.current
  Surface(shape = RoundedCornerShape(28.dp), color = scheme.surfaceContainer, modifier = Modifier.fillMaxWidth().animateContentSize()) {
    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
      val online = desktop?.isReachable == true
      ShapeBadge(
        if (online) MaterialShapes.Cookie6Sided else MaterialShapes.Circle,
        if (online) scheme.secondaryContainer else scheme.surfaceContainerHighest,
        52.dp,
        spinMs = if (online) 20_000 else 0,
      ) {
        if (loading) DexOrb(OrbState.Connecting, size = 28.dp)
        else Icon(Icons.Rounded.Computer, null, tint = if (online) scheme.onSecondaryContainer else scheme.onSurfaceVariant)
      }
      Spacer(Modifier.size(14.dp))
      Column(Modifier.weight(1f)) {
        when {
          loading -> Text("Looking for your PC…", style = MaterialTheme.typography.titleMedium)
          desktop == null -> {
            Text("No PC connected yet", style = MaterialTheme.typography.titleMedium)
            Text(
              "On your PC: DEX → Settings → Accounts → DEX on your phone — sign in with this same email and password.",
              style = MaterialTheme.typography.bodySmall,
              color = scheme.onSurfaceVariant,
            )
          }
          else -> {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(desktop.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
              Spacer(Modifier.size(8.dp))
              Box(Modifier.size(8.dp).background(if (desktop.isReachable) status.running else status.stopped, RoundedCornerShape(50)))
            }
            Text(
              if (desktop.isReachable) desktop.engines.joinToString(" · ") { it.name }.ifBlank { "Online" }
              else "Offline · last seen ${relativeTime(desktop.lastSeenMs)} — tasks start when it’s back",
              style = MaterialTheme.typography.bodySmall,
              color = scheme.onSurfaceVariant,
              maxLines = 2,
            )
          }
        }
      }
    }
  }
}

@Composable
private fun UpdateBanner(update: com.chethan616.dex.update.AppUpdate) {
  val context = androidx.compose.ui.platform.LocalContext.current
  val haptics = LocalHaptics.current
  Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.tertiaryContainer, modifier = Modifier.fillMaxWidth()) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text("DEX ${update.version} is out", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onTertiaryContainer)
        Text("Download and install over this version.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.75f))
      }
      Button(
        onClick = {
          haptics.click()
          context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(update.downloadUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        },
        shapes = ButtonDefaults.shapes(),
      ) { Text("Update") }
    }
  }
}

@Composable
private fun SectionTitle(title: String, count: Int?) {
  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 12.dp, start = 4.dp)) {
    Text(title, style = MaterialTheme.typography.titleLarge)
    if (count != null) {
      Spacer(Modifier.size(8.dp))
      ShapeBadge(MaterialShapes.Clover4Leaf, MaterialTheme.colorScheme.secondaryContainer, 28.dp, spinMs = 16_000) {
        Text("$count", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSecondaryContainer)
      }
    }
  }
}

@Composable
private fun ApprovalCard(session: Session, onOpen: () -> Unit, onAnswer: (Boolean) -> Unit) {
  val pc = session.pendingConfirmation ?: return
  val scheme = MaterialTheme.colorScheme
  // A little wiggle now and then, like a tap on the shoulder.
  val wiggle = remember { Animatable(0f) }
  LaunchedEffect(session.id, pc.id) {
    while (true) {
      for (deg in floatArrayOf(-2.2f, 2f, -1.4f, 0.8f, 0f)) wiggle.animateTo(deg, tween(70))
      delay(4200)
    }
  }
  Surface(
    onClick = onOpen,
    shape = RoundedCornerShape(28.dp),
    color = scheme.tertiaryContainer,
    modifier = Modifier.fillMaxWidth().graphicsLayer { rotationZ = wiggle.value },
  ) {
    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        BotAvatar(type = botTypeFor(session.engine, session.id), mood = BotMood.NeedsYou, size = 44.dp)
        Spacer(Modifier.size(10.dp))
        Text("DEX needs your OK", style = MaterialTheme.typography.titleMedium, color = scheme.onTertiaryContainer)
      }
      Text(pc.title, style = MaterialTheme.typography.bodyLarge, color = scheme.onTertiaryContainer)
      if (pc.detail.isNotBlank()) {
        Text(pc.detail, style = MaterialTheme.typography.bodySmall, color = scheme.onTertiaryContainer.copy(alpha = 0.75f), maxLines = 3, overflow = TextOverflow.Ellipsis)
      }
      Text(session.prompt, style = MaterialTheme.typography.labelMedium, color = scheme.onTertiaryContainer.copy(alpha = 0.6f), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledTonalButton(onClick = { onAnswer(false) }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f)) { Text("Deny") }
        Button(onClick = { onAnswer(true) }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f)) { Text("Approve") }
      }
    }
  }
}

@Composable
private fun RunningCard(session: Session, sharedScope: SharedTransitionScope, animatedScope: AnimatedVisibilityScope, onClick: () -> Unit) {
  val scheme = MaterialTheme.colorScheme
  Surface(onClick = onClick, shape = RoundedCornerShape(28.dp), color = scheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        with(sharedScope) {
          BotAvatar(
            type = botTypeFor(session.engine, session.id),
            mood = rememberBotMood(session),
            size = 48.dp,
            interactive = false,
            modifier = Modifier.sharedElement(rememberSharedContentState("avatar-${session.id}"), animatedScope),
          )
        }
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
          Text(session.prompt, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
          Text(ENGINE_NAMES[session.engine] ?: session.engine.orEmpty(), style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
        }
        StatusPill(session.status, label = com.chethan616.dex.ui.components.sessionStatusLabel(session.status, session.error))
      }
      Row(verticalAlignment = Alignment.CenterVertically) {
        DexOrb(OrbState.Working, size = 22.dp)
        Spacer(Modifier.size(8.dp))
        Text(
          session.lastLine.ifBlank { "Getting started…" },
          style = MaterialTheme.typography.bodyMedium,
          color = scheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
      LinearWavyProgressIndicator(modifier = Modifier.fillMaxWidth())
    }
  }
}

@Composable
private fun SessionRow(
  session: Session,
  index: Int,
  count: Int,
  sharedScope: SharedTransitionScope,
  animatedScope: AnimatedVisibilityScope,
  onClick: () -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  // Expressive grouped list: the group reads as one card with tight inner seams.
  val big = 24.dp
  val small = 6.dp
  val shape = RoundedCornerShape(
    topStart = if (index == 0) big else small,
    topEnd = if (index == 0) big else small,
    bottomStart = if (index == count - 1) big else small,
    bottomEnd = if (index == count - 1) big else small,
  )
  Surface(onClick = onClick, shape = shape, color = scheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
      with(sharedScope) {
        BotAvatar(
          type = botTypeFor(session.engine, session.id),
          mood = rememberBotMood(session),
          size = 40.dp,
          interactive = false,
          modifier = Modifier.sharedElement(rememberSharedContentState("avatar-${session.id}"), animatedScope),
        )
      }
      Spacer(Modifier.size(12.dp))
      Column(Modifier.weight(1f)) {
        Text(session.prompt, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
          session.summary?.lineSequence()?.firstOrNull()?.takeIf { it.isNotBlank() } ?: session.lastLine.ifBlank { session.error.orEmpty() },
          style = MaterialTheme.typography.bodySmall,
          color = scheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
      Spacer(Modifier.size(8.dp))
      Column(horizontalAlignment = Alignment.End) {
        Text(relativeTime(session.lastActivityAt), style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant)
        Spacer(Modifier.height(4.dp))
        StatusDot(session.status)
      }
    }
  }
}

/** A suggestion: its icon on a shape of its own, the label under it; it bounces when tapped. */
@Composable
private fun SuggestionTile(s: Suggestion, index: Int, onClick: () -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val tones = listOf(
    scheme.primaryContainer to scheme.onPrimaryContainer,
    scheme.tertiaryContainer to scheme.onTertiaryContainer,
    scheme.secondaryContainer to scheme.onSecondaryContainer,
    scheme.surfaceContainerHighest to scheme.onSurface,
  )
  val (bg, fg) = tones[index % tones.size]
  val squish = remember { Animatable(1f) }
  val scope = rememberCoroutineScope()
  Surface(
    onClick = {
      scope.launch {
        squish.animateTo(0.9f, tween(80))
        squish.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
      }
      onClick()
    },
    shape = RoundedCornerShape(24.dp),
    color = scheme.surfaceContainer,
    modifier = Modifier.size(width = 118.dp, height = 112.dp).graphicsLayer { scaleX = squish.value; scaleY = squish.value },
  ) {
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.SpaceBetween) {
      ShapeBadge(TILE_SHAPES[index % TILE_SHAPES.size], bg, 44.dp, spinMs = 24_000 + index * 5_000) {
        Icon(s.icon, null, tint = fg, modifier = Modifier.size(22.dp))
      }
      Text(s.label, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
  }
}

@Composable
private fun EmptyState(onStart: () -> Unit) {
  Column(
    Modifier.fillMaxWidth().padding(vertical = 32.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    ShapeBadge(MaterialShapes.SoftBurst, MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f), 170.dp, spinMs = 40_000) {
      BotAvatar(type = "cloud", mood = BotMood.Sleeping, size = 112.dp)
    }
    Text("All quiet", style = MaterialTheme.typography.headlineSmall)
    Text(
      "Your DEX is napping. Give it a job — it runs on your PC and reports back here.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Button(onClick = onStart, shapes = ButtonDefaults.shapes()) {
      Icon(Icons.Rounded.Add, null)
      Spacer(Modifier.size(8.dp))
      Text("New task")
    }
  }
}
