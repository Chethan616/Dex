package com.chethan616.dex.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
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

  AnimatedContent(
    targetState = gate,
    contentKey = { it::class },
    transitionSpec = { (fadeIn(tween(420)) + scaleIn(initialScale = 0.96f)) togetherWith fadeOut(tween(200)) },
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
  AnimatedContent(
    targetState = onboarded,
    transitionSpec = {
      (slideInHorizontally(tween(480)) { it / 4 } + fadeIn(tween(360))) togetherWith
        (slideOutHorizontally(tween(420)) { -it / 6 } + fadeOut(tween(240)))
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

  SharedTransitionLayout {
    NavHost(
      navController = nav,
      startDestination = HomeRoute,
      enterTransition = { slideInHorizontally(tween(420)) { it / 5 } + fadeIn(tween(320)) },
      exitTransition = { slideOutHorizontally(tween(420)) { -it / 8 } + fadeOut(tween(240)) },
      popEnterTransition = { slideInHorizontally(tween(420)) { -it / 8 } + fadeIn(tween(320)) },
      popExitTransition = { slideOutHorizontally(tween(420)) { it / 5 } + fadeOut(tween(240)) },
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
}
