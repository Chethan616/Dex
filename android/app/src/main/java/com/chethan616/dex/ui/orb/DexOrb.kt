package com.chethan616.dex.ui.orb

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.chethan616.dex.ui.theme.LocalIsDark
import com.jakubantalik.thinkingorbs.OrbSize
import com.jakubantalik.thinkingorbs.OrbState
import com.jakubantalik.thinkingorbs.OrbTheme
import com.jakubantalik.thinkingorbs.ThinkingOrb

/**
 * The same orb vocabulary as the desktop (renderer/logs/transcript.ts):
 * each kind of action has its own motion.
 *
 *   searching → web search     weaving → browser     connecting → MCP / apps
 *   solving   → reading files  composing → editing   working → commands
 *   shaping   → desktop control  listening → sub-agents  breathing → thinking
 */
fun orbStateFor(id: String?): OrbState = OrbState.entries.firstOrNull { it.id == id } ?: OrbState.Working

@Composable
fun DexOrb(state: OrbState, size: Dp = 24.dp, modifier: Modifier = Modifier, paused: Boolean = false) {
  ThinkingOrb(
    modifier = modifier,
    state = state,
    size = if (size <= 28.dp) OrbSize.Px20 else OrbSize.Px64,
    theme = if (LocalIsDark.current) OrbTheme.Dark else OrbTheme.Light,
    displaySize = size,
    paused = paused,
  )
}
