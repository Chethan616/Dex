package com.chethan616.dex.ui.theme

import androidx.compose.ui.unit.dp

/**
 * DEX's spacing and sizing, so screens don't each invent slightly different
 * numbers. Corner radii live in the theme's shapes (Theme.kt: small 12,
 * medium 20, large 28, extraLarge 36); colours in the colour scheme and
 * LocalStatusColors.
 */
object Space {
  /** Between an icon and its label, inside chips. */
  val xs = 4.dp
  val s = 8.dp
  /** Between items of a list or a row of controls. */
  val m = 12.dp
  /** Screen edges, card padding. */
  val l = 16.dp
  /** Above a section's title. */
  val xl = 24.dp
}

object Sizes {
  /** Touch target and the prompt bar's buttons. */
  val control = 44.dp
  /** A compact chip (quick actions, filters). */
  val chip = 40.dp
  /** A bot in a list row. */
  val rowAvatar = 40.dp
}
