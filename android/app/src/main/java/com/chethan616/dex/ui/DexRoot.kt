package com.chethan616.dex.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
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

  // Opening the app shows Home at once (nothing was on screen before it);
  // signing in or out is a short cross-fade.
  AnimatedContent(
    targetState = gate,
    contentKey = { it::class },
    transitionSpec = {
      if (initialState is Gate.Loading) EnterTransition.None togetherWith ExitTransition.None
      else fadeIn(tween(220)) togetherWith fadeOut(tween(120))
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

  // Screens slide over each other, nothing else: no scale, no fade, no shared
  // elements. Moving an opaque layer is the cheapest thing a frame can do, so
  // it stays smooth even while the new screen is still filling in. The
  // screen underneath drifts a quarter of the way (parallax). Back runs the
  // same slide in reverse, and follows your thumb with predictive back.
  NavHost(
    navController = nav,
    startDestination = HomeRoute,
    enterTransition = { slideInHorizontally(NavSlide) { it } },
    exitTransition = { slideOutHorizontally(NavSlide) { -it / 4 } },
    popEnterTransition = { slideInHorizontally(NavSlide) { -it / 4 } },
    popExitTransition = { slideOutHorizontally(NavSlide) { it } },
  ) {
      composable<HomeRoute> {
        HomeScreen(
          container = container,
          account = account,
          onOpenSession = { nav.navigate(SessionRoute(it)) },
          onOpenSettings = { nav.navigate(SettingsRoute) },
          shared = shared,
        )
      }
      composable<SessionRoute> { entry ->
        SessionScreen(
          container = container,
          sessionId = entry.toRoute<SessionRoute>().id,
          onBack = { nav.popBackStack() },
        )
      }
      composable<SettingsRoute> {
        SettingsScreen(
          container = container,
          account = account,
          onBack = { nav.popBackStack() },
          onOpenTour = { nav.navigate(TourRoute) { launchSingleTop = true } },
        )
      }
      composable<TourRoute> {
        OnboardingScreen(onDone = { nav.popBackStack() }, doneLabel = "Done")
      }
  }
}

/** M3's emphasized-decelerate: quick off the mark, a long soft landing. */
private val NavSlide = tween<androidx.compose.ui.unit.IntOffset>(320, easing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f))
