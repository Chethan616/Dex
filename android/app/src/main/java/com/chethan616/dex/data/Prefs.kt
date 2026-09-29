package com.chethan616.dex.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeMode { System, Light, Dark }

/** Small, synchronous, per-device preferences. */
class Prefs(context: Context) {
  private val sp = context.getSharedPreferences("dex", Context.MODE_PRIVATE)

  private val _theme = MutableStateFlow(ThemeMode.entries.getOrElse(sp.getInt("theme", 0)) { ThemeMode.System })
  val theme: StateFlow<ThemeMode> = _theme.asStateFlow()

  private val _dynamicColor = MutableStateFlow(sp.getBoolean("dynamicColor", true))
  val dynamicColor: StateFlow<Boolean> = _dynamicColor.asStateFlow()

  private val _haptics = MutableStateFlow(sp.getBoolean("haptics", true))
  val haptics: StateFlow<Boolean> = _haptics.asStateFlow()

  private val _lastEngine = MutableStateFlow(sp.getString("lastEngine", null))
  val lastEngine: StateFlow<String?> = _lastEngine.asStateFlow()

  /** The welcome tour has been seen (or skipped) — sign-in comes straight up. */
  private val _onboarded = MutableStateFlow(sp.getBoolean("onboarded", false))
  val onboarded: StateFlow<Boolean> = _onboarded.asStateFlow()

  fun setTheme(mode: ThemeMode) { _theme.value = mode; sp.edit().putInt("theme", mode.ordinal).apply() }
  fun setDynamicColor(on: Boolean) { _dynamicColor.value = on; sp.edit().putBoolean("dynamicColor", on).apply() }
  fun setHaptics(on: Boolean) { _haptics.value = on; sp.edit().putBoolean("haptics", on).apply() }
  fun setLastEngine(id: String?) { _lastEngine.value = id; sp.edit().putString("lastEngine", id).apply() }
  fun setOnboarded() { if (!_onboarded.value) { _onboarded.value = true; sp.edit().putBoolean("onboarded", true).apply() } }
}
