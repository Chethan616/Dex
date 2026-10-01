package com.chethan616.dex.ui.avatar

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.util.lerp
import kotlinx.coroutines.delay

/**
 * The bot that flies between Home and a chat: tap a task and its bot lifts
 * off the row and lands in the chat's top bar; go back and it flies home.
 *
 * Not Compose's shared elements. Those run the whole navigation tree through
 * lookahead layout and an overlay, and that made opening a chat stutter.
 * This is one avatar in a layer above the screens, moved by translation and
 * scale on its layer only (no layout, no recomposition per frame). The real
 * bots at both ends are hidden while it's in the air.
 */
@Stable
class BotFlight {
  /** The layer the flight is drawn in (it fills the window, like the screens). */
  internal var stage: LayoutCoordinates? = null

  /** Where the chat's top-bar bot sits when its screen is at rest. The same for every chat. */
  internal var chatSpot: Rect? by mutableStateOf(null)

  /** The open chat's screen and its top-bar bot, live: the flight back starts wherever it is. */
  internal var chatScreen: LayoutCoordinates? = null
  internal var chatBot: LayoutCoordinates? = null
  internal var chatLook: Pair<String, BotMood>? = null

  /** Where each task's bot sat on Home when you opened it. */
  private val homeSpots = HashMap<String, Rect>()

  var flight: Flight? by mutableStateOf(null)
    private set

  /**
   * Whether the real bot at one end is hidden (read these in a layer, not in
   * composition). The end it's flying to is hidden at once; the end it left
   * only once its double has been drawn in the air, so it never blinks out.
   */
  fun hidesHomeBot(sessionId: String): Boolean =
    flight?.let { it.sessionId == sessionId && (!it.toChat || it.airborne) } == true

  fun hidesChatBot(sessionId: String): Boolean =
    flight?.let { it.sessionId == sessionId && (it.toChat || it.airborne) } == true

  /** Tapped on Home: `bot` is the row's avatar. */
  fun toChat(sessionId: String, type: String, mood: BotMood, bot: LayoutCoordinates?) {
    val from = rectOf(bot) ?: return
    homeSpots[sessionId] = from
    flight = Flight(sessionId, type, mood, from, to = null, toChat = true)
  }

  /** Back from a chat to Home. */
  fun toHome(sessionId: String) {
    val to = homeSpots[sessionId] ?: return
    val from = rectOf(chatBot) ?: chatSpot ?: return
    val (type, mood) = chatLook ?: return
    flight = Flight(sessionId, type, mood, from, to, toChat = false)
  }

  /** The chat's top-bar bot was laid out: remember its resting place. */
  internal fun chatBotPlaced(bot: LayoutCoordinates) {
    chatBot = bot
    val screen = chatScreen?.takeIf { it.isAttached } ?: return
    if (!bot.isAttached) return
    // Relative to its own screen, so the slide it's riding in doesn't count.
    chatSpot = screen.localBoundingBoxOf(bot, clipBounds = false)
  }

  /** A chat opened (from anywhere): if not by a flight from Home, there's no row to fly back to. */
  fun chatOpened(sessionId: String) {
    if (flight?.sessionId != sessionId) homeSpots.remove(sessionId)
  }

  internal fun land(f: Flight) {
    if (flight === f) flight = null
  }

  private fun rectOf(c: LayoutCoordinates?): Rect? {
    val s = stage?.takeIf { it.isAttached } ?: return null
    val b = c?.takeIf { it.isAttached } ?: return null
    return s.localBoundingBoxOf(b, clipBounds = false)
  }
}

/** One trip: `to` null means "the chat's top bar", known once that screen is laid out. */
@Stable
class Flight(val sessionId: String, val type: String, val mood: BotMood, val from: Rect, val to: Rect?, val toChat: Boolean) {
  /** Its double has been drawn in the air (from the flight's second frame). */
  internal var airborne by mutableStateOf(false)
}

val LocalBotFlight = staticCompositionLocalOf<BotFlight?> { null }

private const val FLIGHT_MS = 360
// The screens' slide curve on x; a gentler one on y, so the path bows a little.
private val AlongX = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
private val AlongY = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** Draws the bot in the air, above the screens. Put it after the NavHost, in the same Box. */
@Composable
fun BotFlightLayer(flight: BotFlight) {
  Box(Modifier.fillMaxSize().onGloballyPositioned { flight.stage = it }) {
    val f = flight.flight ?: return@Box
    val to = f.to ?: flight.chatSpot
    val t = remember(f) { Animatable(0f) }
    LaunchedEffect(f) {
      withFrameNanos { }
      f.airborne = true
    }
    LaunchedEffect(f, to != null) {
      if (to == null) {
        // The very first chat: its top bar is measured a frame or two in.
        delay(400)
        flight.land(f)
        return@LaunchedEffect
      }
      t.animateTo(1f, tween(FLIGHT_MS, easing = LinearEasing))
      flight.land(f)
    }
    val end = to ?: f.from
    val density = LocalDensity.current
    // Drawn at the larger of the two sizes and scaled, so it stays crisp.
    val drawPx = maxOf(f.from.width, end.width).coerceAtLeast(1f)
    BotAvatar(
      type = f.type,
      mood = f.mood,
      size = with(density) { drawPx.toDp() },
      interactive = false,
      modifier = Modifier.graphicsLayer {
        val p = t.value
        val x = AlongX.transform(p)
        val y = AlongY.transform(p)
        transformOrigin = TransformOrigin(0f, 0f)
        translationX = lerp(f.from.left, end.left, x)
        translationY = lerp(f.from.top, end.top, y)
        val s = lerp(f.from.width, end.width, x) / drawPx
        scaleX = s
        scaleY = s
      },
    )
  }
}

/** A Home row's bot: where it is right now, for the flight to start from. */
class FlightSpot {
  internal var coords: LayoutCoordinates? = null
}

@Composable
fun rememberFlightSpot(): FlightSpot = remember { FlightSpot() }

/** Marks a bot as one end of a flight: it's tracked, and hidden while its double is in the air. */
fun Modifier.flightEnd(flight: BotFlight?, sessionId: String, spot: FlightSpot? = null): Modifier =
  if (flight == null) this
  else this
    .onGloballyPositioned { spot?.coords = it }
    .graphicsLayer { alpha = if (flight.hidesHomeBot(sessionId)) 0f else 1f }
