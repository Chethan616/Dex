package com.chethan616.dex.data

import android.content.Context
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.auth
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

data class Account(val uid: String, val email: String?, val name: String?, val photoUrl: String?) {
  /** "chethankrishna2022@…" → "Chethankrishna" when there's no profile name. */
  val displayName: String
    get() = name?.takeIf { it.isNotBlank() }
      ?: email?.substringBefore('@')?.takeWhile { it.isLetter() }?.replaceFirstChar { it.uppercase() }?.takeIf { it.isNotBlank() }
      ?: "there"

  val firstName: String get() = displayName.substringBefore(' ')
}

/**
 * Signing in *is* pairing. DEX on the PC signs in to Firebase with an email
 * and password (Settings → Accounts → DEX on your phone); signing in here with
 * the same email and password lands on the same Firebase uid, and so on the
 * same tasks. Firebase Authentication, Email/Password provider.
 */
class AuthRepository(@Suppress("unused") private val appContext: Context) {

  private val auth get() = Firebase.auth

  val account: Flow<Account?> = callbackFlow {
    val listener = FirebaseAuth.AuthStateListener { fa -> trySend(fa.currentUser?.toAccount()) }
    auth.addAuthStateListener(listener)
    awaitClose { auth.removeAuthStateListener(listener) }
  }

  val current: Account? get() = auth.currentUser?.toAccount()

  suspend fun signIn(email: String, password: String): Result<Account> = runCatching {
    val result = auth.signInWithEmailAndPassword(email.trim(), password).await()
    requireNotNull(result.user).toAccount()
  }.friendly()

  suspend fun createAccount(email: String, password: String): Result<Account> = runCatching {
    val result = auth.createUserWithEmailAndPassword(email.trim(), password).await()
    requireNotNull(result.user).toAccount()
  }.friendly()

  suspend fun sendPasswordReset(email: String): Result<Unit> = runCatching {
    auth.sendPasswordResetEmail(email.trim()).await()
    Unit
  }.friendly()

  fun signOut() = auth.signOut()

  private fun FirebaseUser.toAccount() = Account(uid, email, displayName, photoUrl?.toString())

  /** Firebase error codes → sentences a person can act on. */
  private fun <T> Result<T>.friendly(): Result<T> = recoverCatching { e ->
    val code = (e as? FirebaseAuthException)?.errorCode
    throw IllegalStateException(
      when (code) {
        "ERROR_INVALID_EMAIL" -> "That doesn’t look like an email address."
        "ERROR_WRONG_PASSWORD", "ERROR_INVALID_CREDENTIAL" -> "Email or password is wrong."
        "ERROR_USER_NOT_FOUND" -> "No DEX account with that email — create one instead."
        "ERROR_EMAIL_ALREADY_IN_USE" -> "That email already has a DEX account — sign in instead."
        "ERROR_WEAK_PASSWORD" -> "Use a password of at least 6 characters."
        "ERROR_TOO_MANY_REQUESTS" -> "Too many tries. Wait a minute and try again."
        "ERROR_OPERATION_NOT_ALLOWED" -> "Email sign-in isn’t enabled for this Firebase project yet."
        else -> e.message ?: "Couldn’t sign in."
      },
    )
  }
}
