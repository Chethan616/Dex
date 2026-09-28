package com.chethan616.dex.data

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.provider.Settings
import com.google.firebase.Firebase
import com.google.firebase.Timestamp
import com.google.firebase.auth.auth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.firestore
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import android.util.Base64
import java.io.File

/**
 * Everything the phone reads and writes, all under users/{uid}
 * (firebase/firestore.rules). The desktop is the writer of sessions and
 * blocks; the phone only ever creates commands and its own device row.
 */
class DexRepository(private val appContext: Context) {

  private val db get() = Firebase.firestore
  private val uid: String get() = requireNotNull(Firebase.auth.currentUser?.uid) { "Not signed in" }
  private fun user() = db.collection("users").document(uid)

  @SuppressLint("HardwareIds")
  val deviceId: String = "android-" + (Settings.Secure.getString(appContext.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown")

  fun sessions(limit: Long = 60): Flow<List<Session>> = callbackFlow {
    val reg = user().collection("sessions")
      .orderBy("lastActivityAt", Query.Direction.DESCENDING)
      .limit(limit)
      .addSnapshotListener { snap, err ->
        if (err != null) { close(err); return@addSnapshotListener }
        trySend(snap?.documents?.mapNotNull { it.toSession() } ?: emptyList())
      }
    awaitClose { reg.remove() }
  }

  fun session(id: String): Flow<Session?> = callbackFlow {
    val reg = user().collection("sessions").document(id).addSnapshotListener { snap, err ->
      if (err != null) { close(err); return@addSnapshotListener }
      trySend(snap?.toSession())
    }
    awaitClose { reg.remove() }
  }

  fun blocks(sessionId: String): Flow<List<Block>> = callbackFlow {
    val reg = user().collection("sessions").document(sessionId).collection("blocks")
      .orderBy("seq")
      .addSnapshotListener { snap, err ->
        if (err != null) { close(err); return@addSnapshotListener }
        trySend(snap?.documents?.map { it.toBlock() } ?: emptyList())
      }
    awaitClose { reg.remove() }
  }

  /** users/{uid}.profile — null until chosen (drives the "Pick your DEX" step). */
  fun profile(): Flow<DexProfile?> = callbackFlow {
    val reg = user().addSnapshotListener { snap, err ->
      if (err != null) { close(err); return@addSnapshotListener }
      val p = snap?.get("profile") as? Map<*, *>
      trySend(
        p?.get("bot")?.toString()?.let { bot ->
          DexProfile(
            bot = bot,
            color = p["color"]?.toString()?.takeIf { it.startsWith("#") },
            name = p["name"]?.toString()?.takeIf { it.isNotBlank() },
            updatedAt = (p["updatedAt"] as? Number)?.toLong() ?: 0L,
          )
        },
      )
    }
    awaitClose { reg.remove() }
  }

  suspend fun setProfile(bot: String, color: String?, name: String?) {
    user().set(
      mapOf("profile" to mapOf("bot" to bot, "color" to color, "name" to name?.trim()?.takeIf { it.isNotEmpty() }?.take(32), "updatedAt" to System.currentTimeMillis())),
      SetOptions.merge(),
    ).await()
  }

  fun desktops(): Flow<List<Device>> = callbackFlow {
    val reg = user().collection("devices").whereEqualTo("kind", "desktop").addSnapshotListener { snap, err ->
      if (err != null) { close(err); return@addSnapshotListener }
      trySend(snap?.documents?.map { it.toDevice() }?.sortedByDescending { it.lastSeenMs } ?: emptyList())
    }
    awaitClose { reg.remove() }
  }

  /** Queue a command for the desktop; returns its id so the caller can follow it. */
  suspend fun send(type: CommandType, fields: Map<String, Any?> = emptyMap()): String {
    val data = HashMap<String, Any?>(fields.filterValues { it != null })
    data["type"] = type.id
    data["status"] = "pending"
    data["createdAt"] = FieldValue.serverTimestamp()
    data["from"] = deviceId
    return user().collection("commands").add(data).await().id
  }

  fun command(id: String): Flow<CommandState> = callbackFlow {
    val reg = user().collection("commands").document(id).addSnapshotListener { snap, err ->
      if (err != null) { trySend(CommandState.Failed(err.message ?: "Failed")); return@addSnapshotListener }
      val state = when (snap?.getString("status")) {
        "running" -> CommandState.Running
        "done" -> CommandState.Done((snap.get("result") as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap())
        "error" -> CommandState.Failed(snap.getString("error") ?: "The desktop couldn’t run that.")
        else -> CommandState.Pending
      }
      trySend(state)
    }
    awaitClose { reg.remove() }
  }

  /**
   * A picture or file from a task, fetched from the PC: ask for it
   * (fetch_file), then read the chunks the desktop writes under
   * transfers/{id}, save it in the cache, and delete the transfer.
   * Free-tier Firestore only — no Cloud Storage.
   */
  suspend fun fetchFile(sessionId: String, path: String, onProgress: (Float) -> Unit = {}): File {
    val commandId = send(CommandType.FetchFile, mapOf("sessionId" to sessionId, "path" to path))
    val state = withTimeoutOrNull(90_000) {
      command(commandId).first { it is CommandState.Done || it is CommandState.Failed }
    } ?: throw IllegalStateException("Your PC didn’t answer — is DEX running and online?")
    if (state is CommandState.Failed) throw IllegalStateException(state.error)
    val transferId = (state as CommandState.Done).result["transferId"]?.toString()
      ?: throw IllegalStateException("Your PC didn’t send the file.")

    val transfer = user().collection("transfers").document(transferId)
    val meta = transfer.get().await()
    val chunks = (meta.get("chunks") as? Number)?.toInt() ?: 0
    val name = (meta.getString("name") ?: path.substringAfterLast('\\').substringAfterLast('/')).replace(Regex("""[\\/:*?"<>|]"""), "_")
    val dir = File(appContext.cacheDir, "dex-files/$transferId").apply { mkdirs() }
    val out = File(dir, name.ifBlank { "file" })
    try {
      out.outputStream().buffered().use { os ->
        for (i in 0 until chunks) {
          val part = transfer.collection("chunks").document(i.toString().padStart(4, '0')).get().await()
          val data = part.getString("data") ?: throw IllegalStateException("Part ${i + 1} of $chunks is missing.")
          os.write(Base64.decode(data, Base64.DEFAULT))
          onProgress((i + 1f) / chunks)
        }
      }
    } catch (e: Exception) {
      out.delete()
      throw e
    } finally {
      // The copy on the phone is what matters now; don't leave it in Firestore.
      runCatching {
        val batch = db.batch()
        for (i in 0 until chunks) batch.delete(transfer.collection("chunks").document(i.toString().padStart(4, '0')))
        batch.delete(transfer)
        batch.commit().await()
      }
    }
    return out
  }

  /** This phone's row: its name and presence, shown on the desktop. */
  suspend fun registerDevice() {
    val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
    user().collection("devices").document(deviceId).set(
      mapOf(
        "kind" to "android",
        "name" to "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}",
        "platform" to "android ${Build.VERSION.RELEASE}",
        "online" to true,
        "lastSeen" to FieldValue.serverTimestamp(),
        "fcmToken" to token,
      ),
      SetOptions.merge(),
    ).await()
  }

  suspend fun updateFcmToken(token: String) {
    if (Firebase.auth.currentUser == null) return
    user().collection("devices").document(deviceId).set(mapOf("fcmToken" to token), SetOptions.merge()).await()
  }
}

/* ── Parsing ─────────────────────────────────────────────────────────── */

private fun DocumentSnapshot.long(field: String): Long = when (val v = get(field)) {
  is Number -> v.toLong()
  is Timestamp -> v.toDate().time
  else -> 0L
}

private fun DocumentSnapshot.toSession(): Session? {
  if (!exists()) return null
  val pc = get("pendingConfirmation") as? Map<*, *>
  return Session(
    id = id,
    prompt = getString("prompt") ?: "",
    status = SessionStatus.from(getString("status")),
    engine = getString("engine"),
    model = getString("model"),
    createdAt = long("createdAt"),
    lastActivityAt = long("lastActivityAt"),
    lastLine = getString("lastLine") ?: "",
    summary = getString("summary"),
    error = getString("error"),
    costUsd = (get("costUsd") as? Number)?.toDouble() ?: 0.0,
    tokens = long("tokens"),
    blockCount = long("blockCount").toInt(),
    pendingConfirmation = pc?.let {
      PendingConfirmation(it["id"]?.toString() ?: "", it["title"]?.toString() ?: "", it["detail"]?.toString() ?: "")
    },
    deviceName = getString("deviceName"),
    files = (get("files") as? List<*>)?.mapNotNull { f ->
      (f as? Map<*, *>)?.let { m ->
        val p = m["path"]?.toString() ?: return@let null
        TaskFile(m["name"]?.toString() ?: p.substringAfterLast('\\').substringAfterLast('/'), p, (m["size"] as? Number)?.toLong() ?: 0)
      }
    } ?: emptyList(),
  )
}

private fun DocumentSnapshot.toBlock(): Block {
  val result = get("result") as? Map<*, *>
  @Suppress("UNCHECKED_CAST")
  val items = (get("items") as? List<Map<String, Any?>>)?.map { (it["label"]?.toString() ?: "") to it["detail"]?.toString() } ?: emptyList()
  return Block(
    seq = long("seq"),
    kind = getString("kind") ?: "text",
    text = getString("text"),
    name = getString("name"),
    toolKind = getString("toolKind"),
    verb = getString("verb"),
    activeVerb = getString("activeVerb"),
    orb = getString("orb"),
    display = getString("display"),
    summary = getString("summary"),
    argsJson = getString("argsJson"),
    iteration = maxOf(long("iteration"), long("iterations")),
    result = result?.let {
      ToolResult(it["ok"] == true, it["preview"]?.toString() ?: "", (it["ms"] as? Number)?.toLong() ?: 0)
    },
    level = getString("level"),
    detail = getString("detail"),
    size = long("size"),
    mime = getString("mime"),
    count = long("count"),
    items = items,
    echo = getBoolean("echo") == true,
    path = getString("path"),
    thumb = getString("thumb"),
  )
}

private fun DocumentSnapshot.toDevice(): Device {
  @Suppress("UNCHECKED_CAST")
  val engines = (get("engines") as? List<Map<String, Any?>>)?.map { e ->
    Engine(
      id = e["id"]?.toString() ?: "",
      name = e["name"]?.toString() ?: "",
      models = (e["models"] as? List<Map<String, Any?>>)?.map { m -> EngineModel(m["id"]?.toString() ?: "", m["label"]?.toString() ?: "") } ?: emptyList(),
    )
  } ?: emptyList()
  return Device(
    id = id,
    kind = getString("kind") ?: "desktop",
    name = getString("name") ?: "PC",
    platform = getString("platform"),
    online = getBoolean("online") == true,
    lastSeenMs = long("lastSeen"),
    engines = engines,
    approvalMode = getString("approvalMode"),
  )
}
