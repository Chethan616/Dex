package com.chethan616.dex.ui.screens.session

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.chethan616.dex.AppContainer
import com.chethan616.dex.data.Block
import com.chethan616.dex.data.Session
import com.chethan616.dex.data.SessionStatus
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.botTypeFor
import com.chethan616.dex.ui.avatar.moodFor
import com.chethan616.dex.ui.components.BlockView
import com.chethan616.dex.ui.components.ToolGroup
import com.chethan616.dex.ui.components.ErrorCard
import com.chethan616.dex.notify.Notifications
import com.chethan616.dex.ui.files.FilesButton
import com.chethan616.dex.ui.files.FilesSheet
import com.chethan616.dex.ui.files.LocalPcFiles
import com.chethan616.dex.ui.files.collectTaskItems
import com.chethan616.dex.ui.files.rememberPcFiles
import com.chethan616.dex.ui.files.worthPrefetching
import com.chethan616.dex.notify.TaskWatcher
import com.chethan616.dex.ui.components.ENGINE_NAMES
import com.chethan616.dex.ui.components.MetalSendButton
import com.chethan616.dex.ui.components.StatusPill
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.orb.DexOrb
import com.jakubantalik.thinkingorbs.OrbState
import kotlinx.coroutines.launch

@Composable
fun SessionScreen(
  container: AppContainer,
  sessionId: String,
  sharedScope: SharedTransitionScope,
  animatedScope: AnimatedVisibilityScope,
  onBack: () -> Unit,
) {
  val vm: SessionViewModel = viewModel(key = sessionId, factory = SessionViewModel.factory(container, sessionId))
  val state by vm.state.collectAsStateWithLifecycle()
  val sending by vm.sending.collectAsStateWithLifecycle()
  val haptics = LocalHaptics.current
  val session = state.session
  val list = rememberLazyListState()
  val scope = rememberCoroutineScope()
  var confirmStop by remember { mutableStateOf(false) }
  var filesOpen by remember { mutableStateOf(false) }
  val attach = com.chethan616.dex.ui.attach.rememberAttachmentState()
  val pcFiles = rememberPcFiles(androidx.compose.ui.platform.LocalContext.current, container.repo, sessionId)
  val fileCount = remember(state.blocks, session) { collectTaskItems(state.blocks, session).let { (p, f, d) -> p.size + f.size + d.size } }
  // A 3D model the task made comes over to the phone right away, so the tap
  // opens the viewer at once instead of waiting on a download.
  val models = remember(state.blocks, session) { collectTaskItems(state.blocks, session).second.filter { it.worthPrefetching() } }
  LaunchedEffect(models) { models.forEach { pcFiles.prefetch(scope, it) } }

  // Follow the stream while the reader is at the bottom; leave them be otherwise.
  val atBottom by remember { derivedStateOf { !list.canScrollForward } }
  val lastSignature = state.blocks.lastOrNull()?.let { it.seq to (it.text?.length ?: 0) + (it.result?.preview?.length ?: 0) }
  LaunchedEffect(state.blocks.size, lastSignature) {
    if (state.blocks.isNotEmpty() && (atBottom || list.layoutInfo.totalItemsCount < 3)) {
      list.animateScrollToItem(list.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1)
    }
  }

  // On screen, this session needs no notification — and any it had is stale.
  val context = androidx.compose.ui.platform.LocalContext.current
  androidx.lifecycle.compose.LifecycleResumeEffect(sessionId) {
    TaskWatcher.visibleSession.value = sessionId
    Notifications.cancel(context, sessionId)
    onPauseOrDispose { if (TaskWatcher.visibleSession.value == sessionId) TaskWatcher.visibleSession.value = null }
  }

  // Haptic beats for the moments that matter.
  var lastStatus by remember { mutableStateOf<SessionStatus?>(null) }
  LaunchedEffect(session?.status, session?.pendingConfirmation?.id) {
    val s = session ?: return@LaunchedEffect
    if (s.pendingConfirmation != null) haptics.attention()
    else if (lastStatus?.isLive == true && !s.status.isLive) haptics.success()
    lastStatus = s.status
  }

  androidx.compose.runtime.CompositionLocalProvider(LocalPcFiles provides pcFiles) {
  if (filesOpen) FilesSheet(state.blocks, session, onDismiss = { filesOpen = false })
  com.chethan616.dex.ui.files.ModelViewerHost()
  Scaffold(
    topBar = {
      SessionTopBar(
        session, sessionId, sharedScope, animatedScope, onBack,
        onSync = { haptics.click(); vm.sync() },
        fileCount = fileCount,
        onFiles = { haptics.tick(); filesOpen = true },
      )
    },
    bottomBar = {
      Column(Modifier.navigationBarsPadding().imePadding()) {
        AnimatedVisibility(
          visible = session?.pendingConfirmation != null,
          enter = expandVertically() + fadeIn(),
          exit = shrinkVertically() + fadeOut(),
        ) {
          session?.pendingConfirmation?.let { pc ->
            ApprovalBanner(pc.title, pc.detail) { ok ->
              if (ok) haptics.confirm() else haptics.reject()
              vm.answer(ok)
            }
          }
        }
        Composer(
          session = session,
          sending = sending,
          attach = attach,
          onSend = { text ->
            haptics.send()
            val files = attach.items.toList()
            scope.launch {
              val ok = vm.followUp(text, files) { attach.uploadProgress = it }
              if (ok) attach.items.clear() else attach.error = "Couldn’t send that — check your connection and try again."
            }
          },
          onPause = { haptics.click(); vm.pause() },
          onResume = { haptics.click(); vm.resume() },
          onStop = { haptics.longPress(); confirmStop = true },
        )
      }
    },
  ) { inner ->
    Box(Modifier.fillMaxSize()) {
      if (state.loading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator(Modifier.size(64.dp)) }
      } else {
        LazyColumn(
          state = list,
          contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = inner.calculateTopPadding() + 8.dp, bottom = inner.calculateBottomPadding() + 16.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
          modifier = Modifier.fillMaxSize(),
        ) {
          // Runs of tool calls fold into one expandable row; everything else
          // is its own item.
          val live = session?.status?.isLive == true
          val runningSeq = if (live) state.blocks.lastOrNull { it.kind == "tool" && it.result == null }?.seq else null
          items(groupTools(state.blocks), key = { it.first().seq }) { group ->
            Box(Modifier.animateItem()) {
              if (group.first().kind == "tool") ToolGroup(group, runningSeq)
              else BlockView(group.first(), running = false)
            }
          }
          // Why it stopped, when the conversation itself doesn't say (older tasks).
          val failure = session?.error?.takeIf { !live && it.isNotBlank() && state.blocks.none { b -> b.kind == "error" } }
          if (failure != null) {
            item(key = "failure") {
              if (failure.equals(com.chethan616.dex.ui.components.USER_STOPPED, ignoreCase = true)) com.chethan616.dex.ui.components.StoppedCard()
              else ErrorCard(failure.replace(Regex("""^[a-z_]+_error:\s*""", RegexOption.IGNORE_CASE), ""))
            }
          }
          if (session?.status?.isLive == true && state.blocks.lastOrNull().isQuiet()) {
            item(key = "live") { LiveLine(state.blocks.lastOrNull()) }
          }
          if (state.blocks.isEmpty() && session != null) {
            item(key = "empty") {
              Text(
                if (session.blockCount > 0) "Loading the conversation from your PC…" else session.prompt,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
          }
        }
      }

      AnimatedVisibility(
        visible = !atBottom && state.blocks.size > 4,
        enter = scaleIn() + fadeIn(),
        exit = fadeOut(),
        modifier = Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = inner.calculateBottomPadding() + 16.dp),
      ) {
        SmallFloatingActionButton(onClick = {
          haptics.tick()
          scope.launch { list.animateScrollToItem(list.layoutInfo.totalItemsCount - 1) }
        }) { Icon(Icons.Rounded.KeyboardArrowDown, "Latest") }
      }
    }
  }
  }

  if (confirmStop) {
    AlertDialog(
      onDismissRequest = { confirmStop = false },
      icon = { Icon(Icons.Rounded.Stop, null) },
      title = { Text("Stop this task?") },
      text = { Text("DEX will stop what it’s doing on your PC. You can re-run it later from the desktop.") },
      confirmButton = {
        Button(onClick = { confirmStop = false; haptics.reject(); vm.stop() }, shapes = ButtonDefaults.shapes()) { Text("Stop") }
      },
      dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("Keep going") } },
    )
  }
}

/** Nothing visibly moving at the tail — show what the agent is doing. */
/** Consecutive tool blocks become one group; every other block stands alone. */
private fun groupTools(blocks: List<Block>): List<List<Block>> {
  val out = mutableListOf<MutableList<Block>>()
  for (b in blocks) {
    if (b.kind == "tool" && out.lastOrNull()?.first()?.kind == "tool") out.last() += b
    else out += mutableListOf(b)
  }
  return out
}

private fun Block?.isQuiet(): Boolean = this == null || !(kind == "tool" && result == null)

@Composable
private fun LiveLine(last: Block?) {
  val (orb, label) = when (last?.kind) {
    "text" -> OrbState.Composing to "Writing…"
    "user" -> OrbState.Breathing to "Reading your message…"
    else -> OrbState.Solving to "Thinking…"
  }
  val shimmer by rememberInfiniteTransition(label = "shimmer").animateFloat(
    initialValue = -1f,
    targetValue = 2f,
    animationSpec = infiniteRepeatable(tween(1800, easing = LinearEasing), RepeatMode.Restart),
    label = "x",
  )
  val base = MaterialTheme.colorScheme.onSurfaceVariant
  val hi = MaterialTheme.colorScheme.onSurface
  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
    DexOrb(orb, size = 28.dp)
    Spacer(Modifier.size(10.dp))
    Text(
      buildAnnotatedString {
        pushStyle(SpanStyle(brush = Brush.linearGradient(listOf(base, hi, base), start = androidx.compose.ui.geometry.Offset(shimmer * 300f, 0f), end = androidx.compose.ui.geometry.Offset(shimmer * 300f + 300f, 0f))))
        append(label)
        pop()
      },
      style = MaterialTheme.typography.bodyLarge,
    )
  }
}

@Composable
private fun SessionTopBar(
  session: Session?,
  sessionId: String,
  sharedScope: SharedTransitionScope,
  animatedScope: AnimatedVisibilityScope,
  onBack: () -> Unit,
  onSync: () -> Unit,
  fileCount: Int,
  onFiles: () -> Unit,
) {
  var menu by remember { mutableStateOf(false) }
  Surface(color = MaterialTheme.colorScheme.surface) {
    Row(
      Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
      with(sharedScope) {
        BotAvatar(
          type = botTypeFor(session?.engine, sessionId),
          mood = moodFor(session?.status?.id),
          size = 44.dp,
          modifier = Modifier.sharedElement(rememberSharedContentState("avatar-$sessionId"), animatedScope),
        )
      }
      Spacer(Modifier.size(10.dp))
      Column(Modifier.weight(1f)) {
        Text(session?.prompt.orEmpty(), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically) {
          session?.let { StatusPill(it.status, label = com.chethan616.dex.ui.components.sessionStatusLabel(it.status, it.error)) }
          Spacer(Modifier.size(8.dp))
          Text(
            listOfNotNull(ENGINE_NAMES[session?.engine] ?: session?.engine, session?.deviceName).joinToString(" · "),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
      }
      FilesButton(fileCount, onFiles)
      Box {
        IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = RoundedCornerShape(20.dp)) {
          DropdownMenuItem(
            text = { Text("Reload from PC") },
            leadingIcon = { Icon(Icons.Rounded.Sync, null) },
            onClick = { menu = false; onSync() },
          )
        }
      }
    }
  }
}

@Composable
private fun ApprovalBanner(title: String, detail: String, onAnswer: (Boolean) -> Unit) {
  val scheme = MaterialTheme.colorScheme
  Surface(
    shape = RoundedCornerShape(28.dp),
    color = scheme.tertiaryContainer,
    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        DexOrb(OrbState.Listening, size = 28.dp)
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
          Text("Approve this?", style = MaterialTheme.typography.titleSmall, color = scheme.onTertiaryContainer)
          Text(title, style = MaterialTheme.typography.bodyMedium, color = scheme.onTertiaryContainer)
        }
      }
      if (detail.isNotBlank()) {
        Text(detail, style = MaterialTheme.typography.bodySmall, color = scheme.onTertiaryContainer.copy(alpha = 0.75f), maxLines = 4, overflow = TextOverflow.Ellipsis)
      }
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledTonalButton(onClick = { onAnswer(false) }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f)) { Text("Deny") }
        Button(onClick = { onAnswer(true) }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f)) { Text("Approve") }
      }
    }
  }
}

@Composable
private fun Composer(
  session: Session?,
  sending: Boolean,
  attach: com.chethan616.dex.ui.attach.AttachmentState,
  onSend: (String) -> Unit,
  onPause: () -> Unit,
  onResume: () -> Unit,
  onStop: () -> Unit,
) {
  var text by rememberSaveable { mutableStateOf("") }
  val scheme = MaterialTheme.colorScheme
  val live = session?.status?.isLive == true
  val haptics = LocalHaptics.current
  // Speak a follow-up: the recognised text lands in the box to review before sending.
  val voice = androidx.activity.compose.rememberLauncherForActivityResult(
    androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
  ) { res ->
    val spoken = res.data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
    if (res.resultCode == android.app.Activity.RESULT_OK && !spoken.isNullOrBlank()) {
      haptics.confirm()
      text = if (text.isBlank()) spoken else "$text $spoken"
    }
  }
  val paused = session?.status == SessionStatus.Paused
  val pickers = com.chethan616.dex.ui.attach.rememberAttachPickers(attach)
  var attachMenu by remember { mutableStateOf(false) }
  val hasFiles = attach.items.isNotEmpty()
  Surface(
    shape = RoundedCornerShape(32.dp),
    color = scheme.surfaceContainerHigh,
    shadowElevation = 6.dp,
    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
  ) {
    val field: @Composable (Modifier) -> Unit = { m ->
      TextField(
        value = text,
        onValueChange = { text = it },
        placeholder = { Text(if (live) "Steer the task…" else "Follow up…") },
        maxLines = 5,
        colors = TextFieldDefaults.colors(
          focusedContainerColor = Color.Transparent,
          unfocusedContainerColor = Color.Transparent,
          focusedIndicatorColor = Color.Transparent,
          unfocusedIndicatorColor = Color.Transparent,
        ),
        modifier = m,
      )
    }
    val attachButton: @Composable () -> Unit = {
      Box {
        IconButton(onClick = { haptics.tick(); attachMenu = true }, enabled = session != null) {
          Icon(Icons.Rounded.AttachFile, "Attach")
        }
        com.chethan616.dex.ui.attach.AttachMenu(expanded = attachMenu, onDismiss = { attachMenu = false }, pickers = pickers)
      }
    }
    val micAndSend: @Composable () -> Unit = {
      IconButton(
        onClick = {
          haptics.click()
          runCatching {
            voice.launch(
              android.content.Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, if (live) "Steer the task" else "Follow up"),
            )
          }
        },
      ) { Icon(Icons.Rounded.Mic, "Speak") }
      // The desktop's liquid-metal send button.
      MetalSendButton(
        onClick = { val t = text.trim(); if (t.isNotEmpty() || hasFiles) { onSend(t); text = "" } },
        enabled = (text.isNotBlank() || hasFiles) && !attach.preparing && session != null,
        busy = sending,
        size = 48.dp,
      )
    }
    Column {
      com.chethan616.dex.ui.attach.AttachmentStrip(attach, Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp))
      // While it runs there are five buttons: the text keeps the whole top row
      // and the controls move underneath, as on the desktop. The field stays at
      // one call site, so the keyboard survives the switch when a task ends.
      val running = live || paused
      Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (!running) attachButton()
        field(Modifier.weight(1f))
        if (!running) micAndSend()
      }
      if (running) {
        Row(Modifier.padding(start = 6.dp, end = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
          attachButton()
          FilledTonalIconButton(onClick = if (paused) onResume else onPause, shapes = IconButtonDefaults.shapes()) {
            Icon(if (paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause, if (paused) "Resume" else "Pause")
          }
          FilledTonalIconButton(onClick = onStop, shapes = IconButtonDefaults.shapes()) { Icon(Icons.Rounded.Stop, "Stop") }
          Spacer(Modifier.weight(1f))
          micAndSend()
        }
      }
    }
  }
}
