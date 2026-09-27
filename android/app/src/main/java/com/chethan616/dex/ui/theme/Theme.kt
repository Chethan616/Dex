package com.chethan616.dex.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.expressiveLightColorScheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chethan616.dex.data.ThemeMode

/** DEX's own palette when dynamic colour is off (or before Android 12). */
private val DexDark: ColorScheme = darkColorScheme(
  // DEX blue, from the ribbon "D" logo (and the desktop's #1683FF caret).
  primary = Color(0xFF9CCAFF),
  onPrimary = Color(0xFF00315C),
  primaryContainer = Color(0xFF0F4A86),
  onPrimaryContainer = Color(0xFFD2E4FF),
  secondary = Color(0xFFBBC7DB),
  secondaryContainer = Color(0xFF394659),
  onSecondaryContainer = Color(0xFFD7E3F8),
  tertiary = Color(0xFFD8BDF6),
  tertiaryContainer = Color(0xFF52406C),
  onTertiaryContainer = Color(0xFFF0DBFF),
  background = Color(0xFF101216),
  surface = Color(0xFF101216),
  surfaceContainerLowest = Color(0xFF0B0D10),
  surfaceContainerLow = Color(0xFF181A1F),
  surfaceContainer = Color(0xFF1C1E23),
  surfaceContainerHigh = Color(0xFF26282E),
  surfaceContainerHighest = Color(0xFF313339),
  error = Color(0xFFFFB4AB),
  errorContainer = Color(0xFF93000A),
)

/** Status colours shared with the desktop's tokens (theme.global.css). */
data class DexStatusColors(
  val running: Color,
  val idle: Color,
  val stuck: Color,
  val paused: Color,
  val stopped: Color,
)

val LocalStatusColors = staticCompositionLocalOf {
  DexStatusColors(Color(0xFF3FB950), Color(0xFFD29922), Color(0xFFF85149), Color(0xFF58A6FF), Color(0xFF6E7681))
}

private val DexTypography = Typography().let { base ->
  base.copy(
    displaySmall = base.displaySmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp),
    headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp),
    headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
    headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold),
  )
}

val MonoStyle = TextStyle(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 18.sp)

private val DexShapes = Shapes(
  extraSmall = RoundedCornerShape(8.dp),
  small = RoundedCornerShape(12.dp),
  medium = RoundedCornerShape(20.dp),
  large = RoundedCornerShape(28.dp),
  extraLarge = RoundedCornerShape(36.dp),
)

@Composable
fun DexTheme(mode: ThemeMode, dynamicColor: Boolean, content: @Composable () -> Unit) {
  val dark = when (mode) {
    ThemeMode.System -> isSystemInDarkTheme()
    ThemeMode.Light -> false
    ThemeMode.Dark -> true
  }
  val context = LocalContext.current
  val scheme = when {
    dynamicColor && Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    dark -> DexDark
    else -> expressiveLightColorScheme().copy(
      primary = Color(0xFF1665C0),
      primaryContainer = Color(0xFFD5E3FF),
      onPrimaryContainer = Color(0xFF001B3D),
    )
  }
  val status = if (dark) {
    DexStatusColors(Color(0xFF56D364), Color(0xFFE3B341), Color(0xFFFF7B72), Color(0xFF79C0FF), Color(0xFF8B949E))
  } else {
    DexStatusColors(Color(0xFF1A7F37), Color(0xFF9A6700), Color(0xFFCF222E), Color(0xFF0969DA), Color(0xFF6E7781))
  }
  androidx.compose.runtime.CompositionLocalProvider(LocalStatusColors provides status, LocalIsDark provides dark) {
    MaterialExpressiveTheme(
      colorScheme = scheme,
      motionScheme = MotionScheme.expressive(),
      shapes = DexShapes,
      typography = DexTypography,
      content = content,
    )
  }
}

val LocalIsDark = staticCompositionLocalOf { false }
