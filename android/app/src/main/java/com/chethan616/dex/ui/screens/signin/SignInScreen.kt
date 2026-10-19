package com.chethan616.dex.ui.screens.signin

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AlternateEmail
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ToggleButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.chethan616.dex.AppContainer
import com.chethan616.dex.ui.avatar.BotAvatar
import com.chethan616.dex.ui.avatar.BotMood
import com.chethan616.dex.ui.haptics.LocalHaptics
import com.chethan616.dex.ui.orb.DexOrb
import com.jakubantalik.thinkingorbs.OrbState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.sin

private enum class Mode { SignIn, Create }

@Composable
fun SignInScreen(container: AppContainer) {
  val haptics = LocalHaptics.current
  val focus = LocalFocusManager.current
  val scope = rememberCoroutineScope()
  var mode by rememberSaveable { mutableStateOf(Mode.SignIn) }
  var email by rememberSaveable { mutableStateOf("") }
  var password by rememberSaveable { mutableStateOf("") }
  var showPassword by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var notice by remember { mutableStateOf<String?>(null) }
  var step by remember { mutableIntStateOf(0) }
  LaunchedEffect(Unit) { repeat(3) { delay(140); step++ } }

  val canSubmit = email.contains('@') && password.length >= 6 && !busy

  fun submit() {
    if (!canSubmit) return
    focus.clearFocus()
    haptics.click()
    busy = true
    error = null
    notice = null
    scope.launch {
      val result = if (mode == Mode.SignIn) container.auth.signIn(email, password) else container.auth.createAccount(email, password)
      busy = false
      result.onSuccess { haptics.success() }.onFailure { haptics.reject(); error = it.message }
    }
  }

  val scheme = MaterialTheme.colorScheme
  val density = LocalDensity.current
  Box(
    Modifier
      .fillMaxSize()
      .background(Brush.verticalGradient(listOf(scheme.primaryContainer.copy(alpha = 0.55f), scheme.surface, scheme.surface))),
  ) {
    // The form keeps its size; the bots and the words above it get the height
    // that's left, and give it up first when the keyboard opens (imePadding
    // shrinks this box). So the page doesn't scroll while it fits, and the
    // fields and the button stay above the keyboard. Only a form taller than
    // the room left (a small phone with the keyboard up) scrolls.
    BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
      var formPx by remember { mutableIntStateOf(0) }
      val heroPx = (constraints.maxHeight - formPx - with(density) { BOTTOM_GAP.roundToPx() }).coerceAtLeast(0)
      Column(
        Modifier
          .fillMaxSize()
          .verticalScroll(rememberScrollState(), enabled = heroPx == 0)
          .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Hero(showWords = step >= 1, modifier = Modifier.fillMaxWidth().height(with(density) { heroPx.toDp() }))
        AnimatedVisibility(
          step >= 2,
          enter = fadeIn(tween(500)) + expandVertically(tween(500)),
          modifier = Modifier.onSizeChanged { formPx = it.height },
        ) {
          Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween), modifier = Modifier.fillMaxWidth()) {
              listOf(Mode.SignIn to "Sign in", Mode.Create to "Create account").forEachIndexed { i, (m, label) ->
                ToggleButton(
                  checked = mode == m,
                  onCheckedChange = { haptics.tick(); mode = m; error = null },
                  shapes = if (i == 0) ButtonGroupDefaults.connectedLeadingButtonShapes() else ButtonGroupDefaults.connectedTrailingButtonShapes(),
                  modifier = Modifier.weight(1f),
                ) { Text(label) }
              }
            }

            OutlinedTextField(
              value = email,
              onValueChange = { email = it; error = null },
              label = { Text("Email") },
              leadingIcon = { Icon(Icons.Rounded.AlternateEmail, null) },
              singleLine = true,
              shape = RoundedCornerShape(20.dp),
              keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
              modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.EmailAddress },
            )
            OutlinedTextField(
              value = password,
              onValueChange = { password = it; error = null },
              label = { Text("Password") },
              leadingIcon = { Icon(Icons.Rounded.Lock, null) },
              trailingIcon = {
                IconButton(onClick = { haptics.tick(); showPassword = !showPassword }, shapes = androidx.compose.material3.IconButtonDefaults.shapes()) {
                  Icon(if (showPassword) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (showPassword) "Hide password" else "Show password")
                }
              },
              supportingText = { if (mode == Mode.Create) Text("At least 6 characters") },
              singleLine = true,
              shape = RoundedCornerShape(20.dp),
              visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
              keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
              keyboardActions = KeyboardActions(onDone = { submit() }),
              modifier = Modifier.fillMaxWidth().semantics {
                contentType = if (mode == Mode.Create) ContentType.NewPassword else ContentType.Password
              },
            )

            AnimatedVisibility(error != null || notice != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
              val isError = error != null
              Card(
                colors = CardDefaults.cardColors(containerColor = if (isError) scheme.errorContainer else scheme.secondaryContainer),
                modifier = Modifier.fillMaxWidth(),
              ) {
                Text(
                  error ?: notice.orEmpty(),
                  Modifier.padding(14.dp),
                  color = if (isError) scheme.onErrorContainer else scheme.onSecondaryContainer,
                  style = MaterialTheme.typography.bodyMedium,
                )
              }
            }

            Button(
              onClick = ::submit,
              enabled = canSubmit,
              shapes = ButtonDefaults.shapes(),
              modifier = Modifier.fillMaxWidth().height(60.dp),
            ) {
              AnimatedContent(busy to mode, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "cta") { (loading, m) ->
                if (loading) LoadingIndicator(Modifier.size(28.dp), color = scheme.onPrimary)
                else Text(if (m == Mode.SignIn) "Sign in" else "Create account", style = MaterialTheme.typography.titleMedium)
              }
            }

            if (mode == Mode.SignIn) {
              TextButton(
                onClick = {
                  haptics.tick()
                  if (!email.contains('@')) { error = "Type your email first, then tap Forgot password."; return@TextButton }
                  scope.launch {
                    container.auth.sendPasswordReset(email)
                      .onSuccess { error = null; notice = "Check $email for a link to reset your password." }
                      .onFailure { error = it.message }
                  }
                },
                modifier = Modifier.align(Alignment.CenterHorizontally),
                shapes = androidx.compose.material3.ButtonDefaults.shapes(),
              ) { Text("Forgot password?") }
            }
          }
        }
        Spacer(Modifier.height(BOTTOM_GAP))
      }
    }
  }
}

private val BOTTOM_GAP = 24.dp

private enum class HeroFit { None, Title, Words, Full }

/**
 * The top of the page, fitted to the height it's given: the bots and the
 * words when there's room (the bots shrink to 60% first), then the words,
 * then the title alone, then nothing.
 */
@Composable
private fun Hero(showWords: Boolean, modifier: Modifier) {
  BoxWithConstraints(modifier.clipToBounds(), contentAlignment = Alignment.Center) {
    val h = maxHeight
    val fit = when {
      h >= 340.dp -> HeroFit.Full
      h >= 200.dp -> HeroFit.Words
      h >= 64.dp -> HeroFit.Title
      else -> HeroFit.None
    }
    val scale = ((h - 200.dp) / 230.dp).coerceIn(0.6f, 1f)
    AnimatedContent(fit, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(150)) }, label = "hero") { f ->
      Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth().wrapContentHeight(Alignment.Bottom, unbounded = true).padding(bottom = BOTTOM_GAP),
      ) {
        if (f == HeroFit.Full) {
          // Laid out at full size and drawn smaller, so nothing inside re-measures.
          Box(Modifier.fillMaxWidth().height(230.dp * scale), contentAlignment = Alignment.Center) {
            BotCluster(Modifier.fillMaxWidth().requiredHeight(230.dp).graphicsLayer { scaleX = scale; scaleY = scale })
          }
          Spacer(Modifier.height(8.dp))
        }
        if (f != HeroFit.None) {
          AnimatedVisibility(showWords, enter = fadeIn(tween(500)) + slideInVertically(tween(500)) { it / 3 }) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
              Text(
                "Your PC, in your pocket",
                style = if (f == HeroFit.Title) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                maxLines = if (f == HeroFit.Title) 1 else 2,
              )
              if (f != HeroFit.Title) {
                Spacer(Modifier.height(8.dp))
                Text(
                  "Use the same email and password as DEX on your PC — that’s all it takes to pair.",
                  style = MaterialTheme.typography.bodyLarge,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                  textAlign = TextAlign.Center,
                )
              }
            }
          }
        }
      }
    }
  }
}

/** Five bots floating around a breathing orb — each drifts on its own phase. */
@Composable
private fun BotCluster(modifier: Modifier) {
  val t by rememberInfiniteTransition(label = "drift").animateFloat(
    initialValue = 0f,
    targetValue = (2 * Math.PI).toFloat(),
    animationSpec = infiniteRepeatable(tween(9000, easing = LinearEasing), RepeatMode.Restart),
    label = "t",
  )
  Box(modifier, contentAlignment = Alignment.Center) {
    DexOrb(OrbState.Breathing, size = 180.dp)
    Floater("circle", BotMood.Idle, 54.dp, x = -118, y = -64, phase = 0.0f, t = t)
    Floater("star", BotMood.Idle, 44.dp, x = 116, y = -78, phase = 1.3f, t = t)
    Floater("droid", BotMood.Working, 60.dp, x = 120, y = 56, phase = 2.2f, t = t)
    Floater("cloud", BotMood.Sleeping, 48.dp, x = -114, y = 66, phase = 3.1f, t = t)
    BotAvatar(type = "flower", mood = BotMood.Idle, size = 110.dp, label = "DEX")
  }
}

@Composable
private fun Floater(type: String, mood: BotMood, size: Dp, x: Int, y: Int, phase: Float, t: Float) {
  BotAvatar(type = type, mood = mood, size = size, modifier = Modifier.offset(x = x.dp, y = (y + 6 * sin(t + phase)).dp))
}
