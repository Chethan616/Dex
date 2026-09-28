// The Compose ThinkingOrb.
//
// A withFrameNanos loop inside LaunchedEffect drives the clock and Canvas does
// the drawing — no timers, no threads, nothing to tear down. Compose stops
// recomposing a stopped host, which is the equivalent of the web build's
// IntersectionObserver pause and comes for free.

package com.jakubantalik.thinkingorbs

import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** Theme mode. [Auto] follows the system's dark-mode setting. */
enum class OrbTheme { Auto, Dark, Light }

/**
 * @param displaySize renders the orb at an arbitrary size while keeping the
 *   tuned [size] preset's geometry. The drawing is scaled inside the Canvas, so
 *   it stays vector-crisp at any factor — a graphicsLayer scale would rasterise
 *   the layer first and then upscale it.
 * @param tint when set, the ink ramp runs on the tint's own channels — toward
 *   white on a light substrate, toward black on a dark one — matching the
 *   web's inkColor().
 * @param frozenTimeSeconds pins the animation to a fixed instant. This is RAW
 *   engine time and must NOT be multiplied by the preset speed — the golden
 *   vectors evaluate the engine at raw t, so scaling here would render a
 *   different moment than the vectors describe.
 */
@Composable
fun ThinkingOrb(
    modifier: Modifier = Modifier,
    state: OrbState = OrbState.Working,
    size: OrbSize = OrbSize.Px64,
    theme: OrbTheme = OrbTheme.Auto,
    speed: Double = 1.0,
    paused: Boolean = false,
    displaySize: Dp? = null,
    tint: Color? = null,
    contentDescription: String? = null,
    frozenTimeSeconds: Double? = null,
) {
    val preset = remember(state, size) { resolvePreset(state, size) }
    val effSpeed = preset.speed * speed
    val side = displaySize ?: size.px.dp
    val label = contentDescription ?: state.label

    val isDark = when (theme) {
        OrbTheme.Dark -> true
        OrbTheme.Light -> false
        OrbTheme.Auto -> isSystemInDarkTheme()
    }

    val context = LocalContext.current
    val reduceMotion = remember(context) {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }

    val animate = frozenTimeSeconds == null && !paused && !reduceMotion

    // Raw nanos, converted to engine time at read time. The origin is seeded
    // from the absolute clock so co-mounted orbs share a phase as they do on
    // the web's performance.now(), and so the first frame is the current
    // instant rather than a pop through t = 0.
    val clockNanos = remember { mutableLongStateOf(System.nanoTime()) }
    // Engine time must be CONTINUOUS across a speed change. Multiplying an
    // absolute boot-relative clock by effSpeed does not give that: nanoTime()
    // is seconds since boot, so on a device up a day a hair's-width drag of a
    // speed control shifts t by thousands of seconds and the orb teleports to
    // an unrelated phase. Rebasing keeps the pose and only changes the rate.
    val origin = remember {
        val now = System.nanoTime()
        OrbClockOrigin(nanos = now, t = now / 1_000_000_000.0 * effSpeed, speed = effSpeed)
    }

    if (animate) {
        LaunchedEffect(Unit) {
            while (true) {
                withFrameNanos { clockNanos.longValue = it }
            }
        }
    }

    val points = size.value

    Canvas(
        modifier = modifier
            .size(side)
            .semantics {
                this.contentDescription = label
                this.role = Role.Image
            }
    ) {
        // The clock is read HERE, inside the draw lambda, rather than in the
        // composable body. A tick then invalidates draw only -- never
        // recomposition -- of this subtree; reading it above would recompose
        // the whole of ThinkingOrb on every frame.
        val now = clockNanos.longValue
        if (origin.speed != effSpeed) {
            origin.t += (now - origin.nanos) / 1_000_000_000.0 * origin.speed
            origin.nanos = now
            origin.speed = effSpeed
        }
        val clockSeconds = origin.t + (now - origin.nanos) / 1_000_000_000.0 * effSpeed
        val t = resolveInstant(frozenTimeSeconds, clockSeconds, animate, reduceMotion)
        val frame = orbFrame(preset, points, t)
        // One factor folds both screen density and displaySize together.
        val k = (this.size.width / points).toFloat()
        scale(scaleX = k, scaleY = k, pivot = Offset.Zero) {
            // lines first, so nodes sit on top of their edges
            for (l in frame.lines) {
                drawLine(
                    color = orbInk(l.white, l.a, isDark, tint),
                    start = Offset(l.x1.toFloat(), l.y1.toFloat()),
                    end = Offset(l.x2.toFloat(), l.y2.toFloat()),
                    strokeWidth = l.w.toFloat(),
                )
            }
            // dots are already z-sorted into draw order by the engine
            for (d in frame.dots) {
                drawCircle(
                    color = orbInk(d.white, d.a, isDark, tint),
                    radius = d.r.toFloat(),
                    center = Offset(d.x.toFloat(), d.y.toFloat()),
                )
            }
        }
    }
}

/**
 * Resolves which instant to render.
 *
 * BOTH [frozenTimeSeconds] and the reduced-motion instant are RAW engine time.
 * Only the live clock scales by [effSpeed], because `spec.paint.clock` defines
 * engine time as `elapsedSeconds * presetSpeed * userSpeed` — so 0.6 is already
 * an engine instant, and it is one of the golden fixture's four timestamps
 * precisely so this frame is verifiable. Scaling it again renders a different
 * pose than the reference. Upstream's SwiftUI port has this bug; this one did too.
 *
 * Extracted from the Composable so this contract is reachable from a plain JVM
 * test — a @Composable is not, without Compose UI test infrastructure.
 */
internal fun resolveInstant(
    frozenTimeSeconds: Double?,
    clockSeconds: Double,
    animate: Boolean,
    reduceMotion: Boolean,
): Double = when {
    frozenTimeSeconds != null -> frozenTimeSeconds
    animate -> clockSeconds
    // Reduced motion is a fixed pose by contract. Pausing is not: it should
    // hold whatever the orb was showing, so it does not jump on pause and jump
    // back on resume.
    reduceMotion -> OrbSpec.REDUCED_MOTION_T
    else -> clockSeconds
}

/** Mutable origin for the engine clock. Not Compose state: only the draw phase reads it. */
internal class OrbClockOrigin(var nanos: Long, var t: Double, var speed: Double)

/**
 * Quantise to 8-bit exactly as the reference canvas painter does, so the
 * platforms land on identical greys rather than merely close ones. On dark
 * substrates the ink value is mirrored so near dots read bright — the same
 * depth language on an inverted substrate.
 */
internal fun orbInk(white: Double, alpha: Double, isDark: Boolean, tint: Color?): Color {
    val w = white.coerceIn(0.0, 1.0)
    val a = alpha.toFloat().coerceIn(0f, 1f)
    if (tint != null) {
        // The ink ramp is preserved as a ramp on the tint itself: toward black
        // on dark substrates, toward white on light ones, so depth reads the
        // same in colour as it does in grey. Alpha passes through untouched.
        // Mirrors inkColor() in src/engine/core.ts.
        fun ramp(channel: Float): Float {
            val c = channel * 255.0
            val v = if (isDark) c * (1 - w) else c + (255 - c) * w
            return v.roundToInt() / 255f
        }
        return Color(ramp(tint.red), ramp(tint.green), ramp(tint.blue), a)
    }
    val g = (((if (isDark) 1 - w else w) * 255).roundToInt()) / 255f
    return Color(red = g, green = g, blue = g, alpha = a)
}
