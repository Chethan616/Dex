package com.chethan616.dex.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.chethan616.dex.AppContainer
import com.chethan616.dex.data.CommandState
import com.chethan616.dex.data.CommandType
import com.chethan616.dex.data.Device
import com.chethan616.dex.data.Session
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class HomeState(
  val loading: Boolean = true,
  val sessions: List<Session> = emptyList(),
  val desktops: List<Device> = emptyList(),
  val error: String? = null,
) {
  val desktop: Device? get() = desktops.firstOrNull { it.isReachable } ?: desktops.firstOrNull()
  val needsYou: List<Session> get() = sessions.filter { it.pendingConfirmation != null }
  val running: List<Session> get() = sessions.filter { it.status.isLive && it.pendingConfirmation == null }
  val recent: List<Session> get() = sessions.filter { !it.status.isLive && it.pendingConfirmation == null }
}

class HomeViewModel(private val c: AppContainer) : ViewModel() {

  val state: StateFlow<HomeState> = combine(
    c.repo.sessions().onStart { emit(emptyList()) },
    c.repo.desktops().onStart { emit(emptyList()) },
  ) { sessions, desktops -> HomeState(loading = false, sessions = sessions, desktops = desktops) }
    .catch { emit(HomeState(loading = false, error = it.message)) }
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeState())

  private val _refreshing = MutableStateFlow(false)
  val refreshing: StateFlow<Boolean> = _refreshing

  fun refresh() {
    viewModelScope.launch {
      _refreshing.value = true
      runCatching { c.repo.registerDevice() }
      delay(700) // Firestore is already live; this is the gesture's acknowledgement.
      _refreshing.value = false
    }
  }

  /** Sends a new task and follows its command until the desktop answers. */
  fun newTask(prompt: String, engine: String?, model: String?): Flow<CommandState> = flow {
    c.prefs.setLastEngine(engine)
    val id = c.repo.send(CommandType.NewTask, mapOf("prompt" to prompt, "engine" to engine, "model" to model))
    emit(CommandState.Pending)
    c.repo.command(id).collect { emit(it) }
  }.catch { emit(CommandState.Failed(it.message ?: "Couldn’t send that.")) }

  fun answer(session: Session, approved: Boolean) {
    val pc = session.pendingConfirmation ?: return
    viewModelScope.launch {
      runCatching {
        c.repo.send(
          CommandType.AnswerConfirmation,
          mapOf("sessionId" to session.id, "confirmationId" to pc.id, "approved" to approved, "lifetime" to "once"),
        )
      }
    }
  }

  companion object {
    fun factory(c: AppContainer): ViewModelProvider.Factory = viewModelFactory { initializer { HomeViewModel(c) } }
  }
}

