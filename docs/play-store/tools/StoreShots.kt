package com.chethan616.dex.ui.screens.session

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.Block
import com.chethan616.dex.data.Device
import com.chethan616.dex.data.DexProfile
import com.chethan616.dex.data.Engine
import com.chethan616.dex.data.PendingConfirmation
import com.chethan616.dex.data.Session
import com.chethan616.dex.data.SessionStatus
import com.chethan616.dex.data.ThemeMode
import com.chethan616.dex.data.ToolResult
import com.chethan616.dex.data.Account
import com.chethan616.dex.ui.avatar.LocalTaskBot
import com.chethan616.dex.ui.avatar.TaskBot
import com.chethan616.dex.ui.avatar.botTypeFor
import com.chethan616.dex.ui.avatar.rememberBotMood
import com.chethan616.dex.ui.components.BlockView
import com.chethan616.dex.ui.components.LocalReactions
import com.chethan616.dex.ui.components.LocalWidgetHost
import com.chethan616.dex.ui.components.ReactionsState
import com.chethan616.dex.ui.components.ToolGroup
import com.chethan616.dex.ui.components.WidgetHost
import com.chethan616.dex.ui.components.withTurnExtras
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.haptics.rememberHaptics
import com.chethan616.dex.ui.profile.LocalDexProfile
import com.chethan616.dex.ui.screens.home.HomeContent
import com.chethan616.dex.ui.screens.home.HomeState
import com.chethan616.dex.ui.theme.DexTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

private const val MIN = 60_000L

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w392dp-h850dp-xxhdpi", application = android.app.Application::class)
class StoreShots {
  @get:Rule val rule = createComposeRule()
  private val now = System.currentTimeMillis()

  private fun save(name: String, bmp: Bitmap) {
    val dir = File(System.getenv("DEX_SHOTS") ?: "build/shots").apply { mkdirs() }
    File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  private fun shoot(name: String, settleMs: Long = 3000, content: @Composable () -> Unit) {
    rule.mainClock.autoAdvance = false
    rule.setContent {
      DexTheme(ThemeMode.Dark, dynamicColor = false) {
        CompositionLocalProvider(
          LocalHaptics provides rememberHaptics { false },
          LocalDexProfile provides DexProfile("flower", null, "Alex", 0),
        ) { content() }
      }
    }
    rule.mainClock.advanceTimeBy(settleMs)
    save(name, rule.onRoot().captureToImage().asAndroidBitmap())
  }

  private fun session(id: String, prompt: String, status: SessionStatus, lastLine: String, agoMin: Long, pc: PendingConfirmation? = null, summary: String? = null) =
    Session(id, prompt, status, "claude-code", null, now - (agoMin + 3) * MIN, now - agoMin * MIN, lastLine, summary, null, 0.0, 0, 12, pc, "Studio PC")

  private val pc = Device("desktop-1", "desktop", "Studio PC", "win32", true, now, listOf(Engine("claude-code", "Claude Code", emptyList())), "auto")

  /** The session screen as SessionScreen lays it out, from fixed blocks. */
  @Composable
  private fun SessionLayout(s: Session, blocks: List<Block>) {
    val mood = rememberBotMood(s, blocks)
    CompositionLocalProvider(
      LocalTaskBot provides TaskBot(botTypeFor(s.engine, s.id), mood, blocks.lastOrNull()?.seq),
      LocalReactions provides ReactionsState(emptyMap()),
      LocalWidgetHost provides WidgetHost(reply = {}, answered = { false }),
    ) {
      val live = s.status.isLive
      val groups = groupTools(withTurnExtras(widgetsLast(blocks), live))
      val runningSeq = if (live) blocks.lastOrNull { it.kind == "tool" && it.result == null }?.seq else null
      Scaffold(
        topBar = { SessionTopBar(s, s.id, mood, onBack = {}, onSync = {}, fileCount = 0, onFiles = {}) },
        bottomBar = {
          Column {
            s.pendingConfirmation?.let { ApprovalBanner(it.title, it.detail, it.tierLabel, it.inAppOnly) {} }
            Composer(s, sending = false, attach = com.chethan616.dex.ui.attach.rememberAttachmentState(), onSend = {}, onPause = {}, onResume = {}, onStop = {})
          }
        },
      ) { inner ->
        LazyColumn(
          contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = inner.calculateTopPadding() + 8.dp, bottom = inner.calculateBottomPadding() + 16.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
          modifier = Modifier.fillMaxSize(),
        ) {
          items(groups) { g -> Box { if (g.first().kind == "tool") ToolGroup(g, runningSeq) else BlockView(g.first(), running = false) } }
          if (live && blocks.lastOrNull().isQuiet()) item { LiveLine(blocks.lastOrNull()) }
        }
      }
    }
  }

  private var seq = 0L
  private fun user(t: String) = Block(seq++, "user", at = now - 6 * MIN, text = t)
  private fun text(t: String) = Block(seq++, "text", at = now - 4 * MIN, text = t)
  private fun tool(kind: String, verb: String, active: String, target: String, ms: Long?, ok: Boolean = true) =
    Block(seq++, "tool", at = now - 5 * MIN, name = verb, toolKind = kind, verb = verb, activeVerb = active, display = target, result = ms?.let { ToolResult(ok, "", it) })
  private fun widget(json: String) = Block(seq++, "widget", at = now - 3 * MIN, widget = json)
  private fun done(t: String) = Block(seq++, "done", at = now - 3 * MIN, text = t, echo = true)

  @Test fun home() = shoot("1-home") {
    val sessions = listOf(
      session("s1", "Find the cheapest flight from Hyderabad to Goa this Friday for 2", SessionStatus.Running, "Comparing 38 flights on Kiwi.com", 1),
      session("s2", "Fix my Wi-Fi: it keeps dropping", SessionStatus.Running, "Waiting for you", 2,
        pc = PendingConfirmation("c1", "Turn off power saving for the Wi-Fi adapter", "Intel Wi-Fi 6 AX201", tier = 2)),
      session("s3", "Reply to my landlord and put the inspection in my calendar", SessionStatus.Idle, "Sent, and added Thu 23 Oct at 10:00", 38, summary = "Replied to Priya and added the inspection to your calendar."),
      session("s4", "Turn Lease.pdf into a one-page summary", SessionStatus.Idle, "Saved Lease summary.pdf", 95, summary = "A one-page summary is in Documents."),
      session("s5", "Book a table for 4 at a rooftop place on Saturday", SessionStatus.Idle, "Found 3 places with tables at 8 pm", 260),
    )
    HomeContent(
      account = Account("uid", "alex@example.com", null, null),
      state = HomeState(loading = false, sessions = sessions, desktops = listOf(pc)),
      refreshing = false, update = null,
      onRefresh = {}, onOpenSession = {}, onOpenSettings = {}, onNewTask = {}, onSuggestion = {}, onVoice = {}, onAnswer = { _, _ -> },
      promptBar = {},
    )
  }

  @Test fun flights() = shoot("2-flights") {
    seq = 0
    val s = session("s1", "Find the cheapest flight from Hyderabad to Goa this Friday for 2", SessionStatus.Idle, "", 1)
    SessionLayout(s, listOf(
      user("Find the cheapest flight from Hyderabad to Goa this Friday for 2"),
      tool("mcp", "Searched flights", "Searching flights", "Kiwi.com · HYD → GOI · Fri 17 Oct · 2 adults", 2100),
      tool("mcp", "Compared fares", "Comparing fares", "38 flights", 900),
      text("The cheapest is IndiGo at 6:10 am, ₹15,680 for both of you. Air India Express is ₹750 more and leaves later."),
      widget("""{"type":"cards","title":"Hyderabad → Goa · Fri 17 Oct · 2 adults","icon":"flight","items":[
        {"title":"IndiGo 6E 6421","subtitle":"06:10 → 07:25 · 1h 15m · Non-stop","lines":["HYD → GOI","Cabin bag included"],"price":"₹15,680","badge":"Cheapest","icon":"flight","actions":[{"label":"Select","reply":"Select IndiGo 6E 6421","primary":true},{"label":"Open","url":"https://www.kiwi.com"}]},
        {"title":"Air India Express IX 2934","subtitle":"09:45 → 11:05 · 1h 20m · Non-stop","lines":["HYD → GOX (Mopa)","Cabin bag included"],"price":"₹16,430","icon":"flight","actions":[{"label":"Select","reply":"Select IX 2934","primary":true},{"label":"Open","url":"https://www.kiwi.com"}]},
        {"title":"Akasa Air QP 1347","subtitle":"13:30 → 14:50 · 1h 20m · Non-stop","lines":["HYD → GOI"],"price":"₹17,180","badge":"Best time","icon":"flight","actions":[{"label":"Select","reply":"Select QP 1347","primary":true},{"label":"Open","url":"https://www.kiwi.com"}]}
      ]}"""),
    ))
  }

  @Config(qualifiers = "w392dp-h720dp-xxhdpi")
  @Test fun approval() = shoot("3-approval") {
    seq = 0
    val s = session("s2", "My Wi-Fi keeps dropping. Find out why and fix it.", SessionStatus.Running, "", 1,
      pc = PendingConfirmation("c1", "Turn off power saving for the Wi-Fi adapter", "Intel Wi-Fi 6 AX201 · Device Manager › Power management", tier = 2))
    SessionLayout(s, listOf(
      user("My Wi-Fi keeps dropping. Find out why and fix it."),
      tool("desktop", "Read the network log", "Reading the network log", "WLAN-AutoConfig · last 24 hours", 1400),
      tool("desktop", "Checked the adapter", "Checking the adapter", "Intel Wi-Fi 6 AX201", 600),
      tool("desktop", "Checked power settings", "Checking power settings", "Wi-Fi adapter", 500),
      text("Found it. Windows turns your Wi-Fi adapter off to save power, 14 times since yesterday, and each time the connection drops. I can turn that setting off. You can undo it any time."),
      tool("desktop", "Changed the power setting", "Changing the power setting", "Intel Wi-Fi 6 AX201", null),
    ))
  }

  @Test fun routines() = shoot("4-routines") {
    seq = 0
    val s = session("s6", "Show my routines", SessionStatus.Idle, "", 1)
    SessionLayout(s, listOf(
      user("/workflow"),
      widget("""{"type":"workflows","title":"Your routines","items":[
        {"id":"w1","name":"Morning briefing","description":"Mail, calendar and weather before work","trigger":{"kind":"daily","time":"07:30"},"enabled":true,"steps":[
          {"id":"a","kind":"task","title":"Check unread email"},{"id":"b","kind":"web","title":"Today's weather"},{"id":"c","kind":"task","title":"Summarise my calendar"},{"id":"d","kind":"notify","title":"Send me the summary"}]},
        {"id":"w2","name":"Weekly tidy-up","description":"Downloads sorted, bin emptied","trigger":{"kind":"weekly","time":"18:00","days":["sun"]},"enabled":true,"steps":[
          {"id":"a","kind":"pc","title":"Sort the Downloads folder"},{"id":"b","kind":"pc","title":"Empty the recycle bin"},{"id":"c","kind":"notify","title":"Tell me what moved"}]},
        {"id":"w3","name":"Pay-day check","description":"Bills due this week","trigger":{"kind":"weekly","time":"09:00","days":["fri"]},"enabled":true,"steps":[
          {"id":"a","kind":"web","title":"Check my bills"},{"id":"b","kind":"ask","title":"Ask before paying"}]}
      ]}"""),
    ))
  }

  @Test fun routineGraph() {
    seq = 0
    shoot("4b-routine-screen") {
      val s = session("s6", "Show my routines", SessionStatus.Idle, "", 1)
      SessionLayout(s, listOf(
        user("/workflow"),
        widget("""{"type":"workflows","title":"Your routines","items":[
          {"id":"w1","name":"Morning briefing","description":"Mail, calendar and weather before work","trigger":{"kind":"daily","time":"07:30"},"enabled":true,"steps":[
            {"id":"a","kind":"task","title":"Check unread email","detail":"Gmail and Outlook"},{"id":"b","kind":"web","title":"Today's weather","detail":"Hyderabad"},{"id":"c","kind":"task","title":"Summarise my calendar"},{"id":"d","kind":"notify","title":"Send me the summary"}]}
        ]}"""),
      ))
    }
    rule.onAllNodesWithText("View")[0].performClick()
    rule.mainClock.advanceTimeBy(1500)
    save("4b-routine-graph", rule.onNode(isDialog()).captureToImage().asAndroidBitmap())
  }

  @Test fun live() = shoot("5-live", settleMs = 2000) {
    seq = 0
    val s = session("s4", "Turn Lease.pdf into a one-page summary and send it to my phone", SessionStatus.Running, "", 0)
    SessionLayout(s, listOf(
      user("Turn Lease.pdf into a one-page summary and send it to my phone"),
      tool("search", "Found", "Finding", "Lease.pdf in Documents", 600),
      tool("read", "Read", "Reading", "Lease.pdf · 14 pages", 1800),
      text("It's a 12-month lease from 1 November: ₹28,000 a month, a 2-month deposit, 2 months' notice, and no pets without written consent."),
      tool("write", "Wrote", "Writing", "Lease summary.docx", 2400),
      user("Also email it to Priya"),
      text("Will do, as soon as the PDF is ready."),
      tool("run", "Exported", "Exporting", "Lease summary.pdf", null),
    ))
  }
}
