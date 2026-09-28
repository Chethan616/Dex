package com.chethan616.dex.ui.haptics

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalView

/**
 * One vocabulary of touch feedback for the whole app.
 *
 * Simple UI acknowledgements go through View.performHapticFeedback — the
 * system's own tuned effects, which also respect the user's touch-feedback
 * setting. Moments that deserve a signature feel (sending a task, a task
 * finishing, an approval) use VibrationEffect.Composition primitives where the
 * motor supports them, with a plain predefined effect as the fallback.
 */
class Haptics(private val view: View, private val enabled: () -> Boolean) {

  private val vibrator: Vibrator? by lazy {
    val ctx = view.context
    if (Build.VERSION.SDK_INT >= 31) {
      (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
  }

  private fun perform(constant: Int) {
    if (enabled()) view.performHapticFeedback(constant)
  }

  /** Light tick: chips, segmented choices, list taps. */
  fun tick() = perform(if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK)

  /** A normal button press. */
  fun click() = perform(HapticFeedbackConstants.VIRTUAL_KEY)

  fun toggle(on: Boolean) = perform(
    when {
      Build.VERSION.SDK_INT >= 34 -> if (on) HapticFeedbackConstants.TOGGLE_ON else HapticFeedbackConstants.TOGGLE_OFF
      else -> HapticFeedbackConstants.CLOCK_TICK
    },
  )

  fun confirm() = perform(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS)

  fun reject() = perform(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS)

  fun longPress() = perform(HapticFeedbackConstants.LONG_PRESS)

  /** Sending a task: a quick rise into a crisp click — "off it goes". */
  fun send() = compose(
    listOf(Prim(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, 0.5f), Prim(VibrationEffect.Composition.PRIMITIVE_CLICK, 1f, 40)),
    fallback = VibrationEffect.EFFECT_CLICK,
  )

  /** A task finished: two soft ticks, rising. */
  fun success() = compose(
    listOf(Prim(VibrationEffect.Composition.PRIMITIVE_TICK, 0.6f), Prim(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.9f, 90)),
    fallback = VibrationEffect.EFFECT_DOUBLE_CLICK,
  )

  /** Needs attention: a low thud then a tick. */
  fun attention() = compose(
    listOf(Prim(VibrationEffect.Composition.PRIMITIVE_THUD, 0.8f), Prim(VibrationEffect.Composition.PRIMITIVE_TICK, 0.7f, 70)),
    fallback = VibrationEffect.EFFECT_HEAVY_CLICK,
  )

  /** The bot hops when tapped. */
  fun hop() = compose(
    listOf(Prim(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, 0.35f), Prim(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 0.8f, 180)),
    fallback = VibrationEffect.EFFECT_TICK,
  )

  private data class Prim(val id: Int, val scale: Float, val delayMs: Int = 0)

  private fun compose(prims: List<Prim>, fallback: Int) {
    if (!enabled()) return
    val v = vibrator ?: return
    if (!v.hasVibrator()) return
    if (Build.VERSION.SDK_INT >= 30 && v.areAllPrimitivesSupported(*prims.map { it.id }.toIntArray())) {
      val c = VibrationEffect.startComposition()
      prims.forEach { c.addPrimitive(it.id, it.scale, it.delayMs) }
      v.vibrate(c.compose())
    } else if (Build.VERSION.SDK_INT >= 29) {
      v.vibrate(VibrationEffect.createPredefined(fallback))
    } else {
      view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    }
  }
}

val LocalHaptics = staticCompositionLocalOf<Haptics> { error("Haptics not provided") }

@Composable
fun rememberHaptics(enabled: () -> Boolean): Haptics {
  val view = LocalView.current
  return remember(view) { Haptics(view, enabled) }
}
