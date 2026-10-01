package com.chethan616.dex.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.material3.MaterialTheme
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.chethan616.dex.AppContainer
import com.chethan616.dex.data.Account
import com.chethan616.dex.ui.screens.home.HomeScreen
import com.chethan616.dex.ui.screens.onboarding.OnboardingScreen
import com.chethan616.dex.ui.screens.session.SessionScreen
import com.chethan616.dex.ui.screens.settings.SettingsScreen
import com.chethan616.dex.ui.screens.setup.FirebaseSetupScreen
import com.chethan616.dex.ui.screens.signin.SignInScreen
import com.chethan616.dex.data.DexProfile
import com.chethan616.dex.ui.profile.LocalDexProfile
import com.chethan616.dex.ui.profile.PickYourDexScreen
import com.chethan616.dex.ui.profile.defaultProfileFor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable

@Serializable data object HomeRoute
@Serializable data class SessionRoute(val id: String)
@Serializable data object SettingsRoute
@Serializable data object TourRoute

private sealed interface Gate {
  data object Loading : Gate
  data object SignedOut : Gate
  data class SignedIn(val account: Account) : Gate
}

@Composable
fun DexRoot(
  container: AppContainer,
  openSession: MutableStateFlow<String?>,
  shared: MutableStateFlow<com.chethan616.dex.share.SharedContent?> = MutableStateFlow(null),
) {
  if (!container.firebaseReady) {
    FirebaseSetupScreen()
    return
  }

  val gate by produceState<Gate>(Gate.Loading) {
    container.auth.account.collect { value = if (it == null) Gate.SignedOut else Gate.SignedIn(it) }
  }

  // Signing in zooms through: the sign-in screen swells and fades as the app
  // springs up from just below its size (Home then cascades its cards in).
  val motion = MaterialTheme.motionScheme
  AnimatedContent(
    targetState = gate,
    contentKey = { it::class },
    transitionSpec = {
      (fadeIn(motion.slowEffectsSpec()) + scaleIn(motion.slowSpatialSpec(), initialScale = 0.88f)) togetherWith
        (fadeOut(motion.fastEffectsSpec()) + scaleOut(motion.fastSpatialSpec(), targetScale = 1.08f))
    },
    label = "gate",
  ) { state ->
    when (state) {
      Gate.Loading -> Unit
      Gate.SignedOut -> SignedOut(container)
      is Gate.SignedIn -> SignedInApp(container, state.account, openSession, shared)
    }
  }
}

/** First run: the welcome tour, then sign-in. Afterwards sign-in comes straight up. */
@Composable
private fun SignedOut(container: AppContainer) {
  val onboarded by container.prefs.onboarded.collectAsStateWithLifecycle()
  val motion = MaterialTheme.motionScheme
  // "Get started": the tour swells away and sign-in bounces up into place.
  AnimatedContent(
    targetState = onboarded,
    transitionSpec = {
      (slideInVertically(motion.defaultSpatialSpec()) { it / 8 } + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.86f) + fadeIn(motion.defaultEffectsSpec())) togetherWith
        (scaleOut(motion.fastSpatialSpec(), targetScale = 1.1f) + fadeOut(motion.fastEffectsSpec()))
    },
    label = "tour",
  ) { done ->
    if (done) SignInScreen(container) else OnboardingScreen(onDone = { container.prefs.setOnboarded() })
  }
}

private sealed interface ProfileState {
  data object Loading : ProfileState
  data class Loaded(val profile: DexProfile?) : ProfileState
}

@Composable
private fun SignedInApp(
  container: AppContainer,
  account: Account,
  openSession: MutableStateFlow<String?>,
  shared: MutableStateFlow<com.chethan616.dex.share.SharedContent?>,
) {
  // Signed in means past the tour — a later sign-out goes straight to sign-in.
  LaunchedEffect(Unit) { container.prefs.setOnboarded() }
  // "Your DEX": null until chosen — then the Netflix-style picker comes first.
  val profileState by produceState<ProfileState>(ProfileState.Loading, account.uid) {
    runCatching { container.repo.profile().collect { value = ProfileState.Loaded(it) } }
      .onFailure { value = ProfileState.Loaded(defaultProfileFor(account.uid)) }
  }
  when (val ps = profileState) {
    ProfileState.Loading -> return
    is ProfileState.Loaded -> if (ps.profile == null) {
      PickYourDexScreen(initial = defaultProfileFor(account.uid)) { bot, color, name ->
        runCatching { container.repo.setProfile(bot, color, name) }
      }
      return
    }
  }
  val profile = (profileState as ProfileState.Loaded).profile ?: defaultProfileFor(account.uid)
  androidx.compose.runtime.CompositionLocalProvider(LocalDexProfile provides profile) {
    SignedInNav(container, account, openSession, shared)
  }
}

@Composable
private fun SignedInNav(
  container: AppContainer,
  account: Account,
  openSession: MutableStateFlow<String?>,
  shared: MutableStateFlow<com.chethan616.dex.share.SharedContent?>,
) {
  val nav = rememberNavController()
  val pending by openSession.collectAsStateWithLifecycle()
  val incoming by shared.collectAsStateWithLifecycle()
  // Shared from another app: back to Home, where the new-task sheet opens with it.
  LaunchedEffect(incoming) {
    if (incoming != null) nav.popBackStack(HomeRoute, inclusive = false)
  }

  LaunchedEffect(Unit) { runCatching { container.repo.registerDevice() } }
  LaunchedEffect(pending) {
    pending?.let {
      nav.navigate(SessionRoute(it)) { launchSingleTop = true }
      openSession.value = null
    }
  }

  // Springs, not tweens (the theme's expressive motion scheme): screens arrive
  // with a little overshoot and settle; leaving ones step back and fade.
  val motion = MaterialTheme.motionScheme
  SharedTransitionLayout {
    NavHost(
      navController = nav,
      startDestination = HomeRoute,
      enterTransition = {
        slideInHorizontally(motion.defaultSpatialSpec()) { it / 4 } + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.94f) + fadeIn(motion.defaultEffectsSpec())
      },
      exitTransition = { slideOutHorizontally(motion.defaultSpatialSpec()) { -it / 10 } + scaleOut(motion.defaultSpatialSpec(), targetScale = 0.96f) + fadeOut(motion.fastEffectsSpec()) },
      popEnterTransition = { slideInHorizontally(motion.defaultSpatialSpec()) { -it / 10 } + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.96f) + fadeIn(motion.defaultEffectsSpec()) },
      popExitTransition = { slideOutHorizontally(motion.defaultSpatialSpec()) { it / 4 } + scaleOut(motion.defaultSpatialSpec(), targetScale = 0.94f) + fadeOut(motion.fastEffectsSpec()) },
    ) {
      composable<HomeRoute> {
        HomeScreen(
          container = container,
          account = account,
          sharedScope = this@SharedTransitionLayout,
          animatedScope = this,
          onOpenSession = { nav.navigate(SessionRoute(it)) },
          onOpenSettings = { nav.navigate(SettingsRoute) },
          shared = shared,
        )
      }
      composable<SessionRoute> { entry ->
        SessionScreen(
          container = container,
          sessionId = entry.toRoute<SessionRoute>().id,
          sharedScope = this@SharedTransitionLayout,
          animatedScope = this,
          onBack = { nav.popBackStack() },
        )
      }
      // Settings grows out of the gear (a container transform: SettingsScreen
      // and Home's header share bounds), so the route itself only fades.
      composable<SettingsRoute>(
        enterTransition = { fadeIn(motion.fastEffectsSpec()) },
        exitTransition = { fadeOut(motion.fastEffectsSpec()) },
        popEnterTransition = { fadeIn(motion.fastEffectsSpec()) },
        popExitTransition = { fadeOut(motion.fastEffectsSpec()) },
      ) {
        SettingsScreen(
          container = container,
          account = account,
          onBack = { nav.popBackStack() },
          onOpenTour = { nav.navigate(TourRoute) { launchSingleTop = true } },
          sharedScope = this@SharedTransitionLayout,
          animatedScope = this,
        )
      }
      composable<TourRoute> {
        OnboardingScreen(onDone = { nav.popBackStack() }, doneLabel = "Done")
      }
    }
  }
}
