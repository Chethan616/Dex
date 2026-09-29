package com.chethan616.dex.ui.screens.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.chethan616.dex.AppContainer
import com.chethan616.dex.data.Block
import com.chethan616.dex.data.CommandType
import com.chethan616.dex.data.Session
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SessionState(
  val loading: Boolean = true,
  val session: Session? = null,
  val blocks: List<Block> = emptyList(),
  val error: String? = null,
)

class SessionViewModel(private val c: AppContainer, private val sessionId: String) : ViewModel() {

  val state: StateFlow<SessionState> = combine(
    c.repo.session(sessionId).onStart { emit(null) },
    c.repo.blocks(sessionId).onStart { emit(emptyList()) },
  ) { session, blocks -> SessionState(loading = session == null, session = session, blocks = blocks) }
    .catch { emit(SessionState(loading = false, error = it.message)) }
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SessionState())

  private val _sending = MutableStateFlow(false)
  val sending: StateFlow<Boolean> = _sending

  init {
    // Older tasks may only have their summary row in Firestore; ask the
    // desktop for the full transcript once if the blocks never arrive.
    viewModelScope.launch {
      delay(1500)
      val s = state.value
      if (s.session != null && s.blocks.isEmpty() && s.session.blockCount > 0) {
        runCatching { c.repo.send(CommandType.SyncSession, mapOf("sessionId" to sessionId)) }
      }
    }
  }

  private fun command(type: CommandType, extra: Map<String, Any?> = emptyMap()) {
    viewModelScope.launch { runCatching { c.repo.send(type, mapOf("sessionId" to sessionId) + extra) } }
  }

  /** Follow up (with attachments uploaded first). Returns whether it went. */
  suspend fun followUp(
    text: String,
    attachments: List<com.chethan616.dex.data.PendingAttachment> = emptyList(),
    onUpload: (Float?) -> Unit = {},
  ): Boolean {
    _sending.value = true
    return try {
      val uploads = if (attachments.isEmpty()) emptyList() else try {
        c.repo.uploadAll(attachments) { onUpload(it) }
      } finally {
        onUpload(null)
      }
      val prompt = text.ifBlank { if (attachments.size == 1) "Here’s a file for this." else "Here are some files for this." }
      c.repo.send(CommandType.FollowUp, mapOf("sessionId" to sessionId, "prompt" to prompt, "uploads" to uploads.ifEmpty { null }))
      true
    } catch (_: Throwable) {
      false
    } finally {
      _sending.value = false
    }
  }

  fun pause() = command(CommandType.Pause)
  fun resume() = command(CommandType.Resume)
  fun stop() = command(CommandType.Stop)
  fun sync() = command(CommandType.SyncSession)

  fun answer(approved: Boolean) {
    val pc = state.value.session?.pendingConfirmation ?: return
    command(CommandType.AnswerConfirmation, mapOf("confirmationId" to pc.id, "approved" to approved, "lifetime" to "once"))
  }

  companion object {
    fun factory(c: AppContainer, id: String): ViewModelProvider.Factory = viewModelFactory { initializer { SessionViewModel(c, id) } }
  }
}
