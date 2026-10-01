package com.chethan616.dex.ui.avatar

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * The bot of the task on screen, for the chat's pieces to wear: the "Done"
 * chip, the live "thinking…" line. `latestSeq` is the newest block, so only
 * the current turn's pieces show the live mood.
 */
data class TaskBot(val type: String, val mood: BotMood, val latestSeq: Long?)

val LocalTaskBot = staticCompositionLocalOf<TaskBot?> { null }
