package com.chethan616.dex.ui.theme

import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.spring
import androidx.compose.material3.MotionScheme
import androidx.compose.runtime.Stable

/**
 * DEX's motion: Material 3 Expressive, with more bounce where things move.
 *
 * Every M3 component reads the theme's MotionScheme: the FAB menu and its
 * toggle, buttons' press-morph, switches, sliders, the loading indicator,
 * sheets. Expressive's own spatial springs barely overshoot (damping 0.8 on
 * the default), so a playful app felt merely smooth. These overshoot visibly
 * and settle fast. Fades and colour changes stay critically damped: a
 * colour that overshoots reads as a flicker, not as play.
 *
 * Screen-to-screen slides don't use this (DexRoot's NavSlide): a bounce on
 * navigation is what made the app feel laggy before (1.0.19).
 */
@Stable
object DexMotion : MotionScheme {
  /** Most movement: a clear overshoot (~7%) that settles in about 350 ms. */
  override fun <T> defaultSpatialSpec(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.62f, stiffness = 420f)

  /** Small, quick things (a toggle, a thumb, an icon): snappy, with a wobble. */
  override fun <T> fastSpatialSpec(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.55f, stiffness = 900f)

  /** Big, slow things (a sheet, a hero): a soft overshoot. */
  override fun <T> slowSpatialSpec(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.7f, stiffness = 240f)

  override fun <T> defaultEffectsSpec(): FiniteAnimationSpec<T> = spring(dampingRatio = 1f, stiffness = 1600f)

  override fun <T> fastEffectsSpec(): FiniteAnimationSpec<T> = spring(dampingRatio = 1f, stiffness = 3800f)

  override fun <T> slowEffectsSpec(): FiniteAnimationSpec<T> = spring(dampingRatio = 1f, stiffness = 800f)
}
