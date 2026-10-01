package com.chethan616.dex.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.chethan616.dex.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Where the in-app update is, for Settings and Home's banner alike. */
sealed interface UpdateState {
  data object Idle : UpdateState
  data object Checking : UpdateState
  data class UpToDate(val latest: String?) : UpdateState
  data class Available(val update: AppUpdate) : UpdateState
  /** `progress` 0…1, or negative while the size isn't known. */
  data class Downloading(val update: AppUpdate, val progress: Float) : UpdateState
  data class Ready(val update: AppUpdate, val file: File) : UpdateState
  data class Failed(val message: String, val update: AppUpdate? = null) : UpdateState
}

/**
 * The phone's updater, like the desktop's: check GitHub Releases, download
 * the new APK inside the app, then hand it to Android's installer.
 *
 * Before the installer opens, the downloaded file is checked:
 * - it must be DEX (this package name) at the version GitHub named;
 * - it must be signed with the same key as this install.
 * Android refuses a differently signed update anyway; checking first gives a
 * clear message instead of "App not installed".
 *
 * One instance for the process, so a download keeps going when you leave
 * Settings, and Home's banner shows the same progress.
 */
object AppUpdater {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
  val state: StateFlow<UpdateState> = _state
  private var lastChecked = 0L
  private var job: Job? = null
  /** Sent to "allow installs from DEX": install once you're back, if you allowed it. */
  private var installWhenAllowed = false

  /** Ask GitHub. Skipped if it answered in the last 10 minutes, unless `force`. */
  fun check(context: Context, force: Boolean = false) {
    val s = _state.value
    if (s is UpdateState.Checking || s is UpdateState.Downloading || s is UpdateState.Ready) return
    if (!force && System.currentTimeMillis() - lastChecked < 10 * 60_000 && (s is UpdateState.UpToDate || s is UpdateState.Available)) return
    val app = context.applicationContext
    job = scope.launch {
      _state.value = UpdateState.Checking
      val result = ReleaseChecker.latest()
      lastChecked = System.currentTimeMillis()
      _state.value = when (result) {
        is ReleaseCheck.UpToDate -> UpdateState.UpToDate(result.latest)
        is ReleaseCheck.Available -> downloaded(app, result.update)?.let { UpdateState.Ready(result.update, it) } ?: UpdateState.Available(result.update)
        is ReleaseCheck.Failed -> UpdateState.Failed(result.message)
      }
      withContext(Dispatchers.IO) { sweep(app) }
    }
  }

  /** The button: whatever the next step is (check, download, install). */
  fun act(context: Context) {
    when (val s = _state.value) {
      is UpdateState.Available -> download(context, s.update)
      is UpdateState.Failed -> if (s.update != null) download(context, s.update) else check(context, force = true)
      is UpdateState.Ready -> install(context, s.file)
      is UpdateState.Checking, is UpdateState.Downloading -> Unit
      else -> check(context, force = true)
    }
  }

  /** Android must be told, once, that DEX may install apps. */
  fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

  private fun download(context: Context, update: AppUpdate) {
    val app = context.applicationContext
    job = scope.launch {
      _state.value = UpdateState.Downloading(update, -1f)
      val result = withContext(Dispatchers.IO) {
        runCatching { fetch(app, update) { p -> _state.value = UpdateState.Downloading(update, p) } }
      }
      result.fold(
        onSuccess = { file ->
          _state.value = UpdateState.Ready(update, file)
          // You asked for the update: go straight on to the installer.
          install(app, file)
        },
        onFailure = { _state.value = UpdateState.Failed(it.message ?: "The download didn’t finish. Try again.", update) },
      )
    }
  }

  /** Opens Android's installer (or, the first time, the setting that allows it). Returns false for the latter. */
  fun install(context: Context, file: File): Boolean {
    if (!canInstall(context)) {
      installWhenAllowed = true
      runCatching {
        context.startActivity(
          Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
      return false
    }
    installWhenAllowed = false
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    return runCatching {
      context.startActivity(
        Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }.isSuccess
  }

  /** Call when a screen showing the update comes back to the front. */
  fun resumed(context: Context) {
    val s = _state.value
    if (installWhenAllowed && s is UpdateState.Ready && canInstall(context)) install(context, s.file)
  }

  private fun dir(context: Context) = File(context.cacheDir, "updates").apply { mkdirs() }

  /** An already downloaded and checked copy of this version, if there is one. */
  private suspend fun downloaded(context: Context, update: AppUpdate): File? = withContext(Dispatchers.IO) {
    File(dir(context), "DEX-android-${update.version}.apk").takeIf { it.isFile && verify(context, it, update.version) == null }
  }

  private fun fetch(context: Context, update: AppUpdate, progress: (Float) -> Unit): File {
    val out = File(dir(context), "DEX-android-${update.version}.apk")
    val part = File(out.path + ".part")
    // GitHub answers with a redirect to its asset host; HttpURLConnection follows it (https to https).
    val conn = (URL(update.downloadUrl).openConnection() as HttpURLConnection).apply {
      setRequestProperty("User-Agent", "DEX-Android/${BuildConfig.VERSION_NAME}")
      connectTimeout = 15_000
      readTimeout = 30_000
    }
    if (conn.responseCode != 200) throw IllegalStateException("GitHub didn’t send the update (${conn.responseCode}).")
    val total = conn.contentLengthLong.takeIf { it > 0 } ?: update.size
    var done = 0L
    var shown = -1
    conn.inputStream.use { input ->
      part.outputStream().use { output ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          output.write(buffer, 0, n)
          done += n
          if (total > 0) {
            val pct = (done * 100 / total).toInt()
            if (pct != shown) { shown = pct; progress(pct / 100f) }
          }
        }
      }
    }
    if (total > 0 && done != total) { part.delete(); throw IllegalStateException("The download was cut short. Try again.") }
    out.delete()
    if (!part.renameTo(out)) throw IllegalStateException("Couldn’t save the update.")
    // Checked under its .apk name: some Android versions only parse files that end in .apk.
    verify(context, out, update.version)?.let { out.delete(); throw IllegalStateException(it) }
    return out
  }

  /** Null if `file` is DEX `version`, signed like this install; otherwise why not. */
  private fun verify(context: Context, file: File, version: String): String? {
    val pm = context.packageManager
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
    val archive = pm.getPackageArchiveInfo(file.path, flags) ?: return "That download isn’t an app. Try again."
    if (archive.packageName != context.packageName) return "That download isn’t DEX, so it won’t be installed."
    if (archive.versionName != version) return "GitHub sent version ${archive.versionName}, not $version. Try again later."
    val theirs = signers(archive)
    val ours = runCatching { signers(pm.getPackageInfo(context.packageName, flags)) }.getOrDefault(emptySet())
    // Some Android versions don't read an archive's signature; the installer
    // still checks it then.
    if (theirs.isNotEmpty() && ours.isNotEmpty() && theirs != ours) {
      return "That update isn’t signed like this app, so it won’t be installed."
    }
    return null
  }

  private fun signers(info: PackageInfo): Set<String> {
    val sigs = if (Build.VERSION.SDK_INT >= 28) {
      info.signingInfo?.let { if (it.hasMultipleSigners()) it.apkContentsSigners else it.signingCertificateHistory }
    } else {
      @Suppress("DEPRECATION") info.signatures
    } ?: return emptySet()
    return sigs.map { s -> MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
  }

  /** Downloads of this version or older are done with. */
  private fun sweep(context: Context) {
    dir(context).listFiles()?.forEach { f ->
      val v = Regex("""DEX-android-(\d+(?:\.\d+)*)\.apk(\.part)?""").matchEntire(f.name)?.groupValues?.get(1)
      if (v == null || !ReleaseChecker.isNewer(v, BuildConfig.VERSION_NAME)) f.delete()
    }
  }
}
