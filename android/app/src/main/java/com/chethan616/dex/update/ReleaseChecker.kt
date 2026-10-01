package com.chethan616.dex.update

import com.chethan616.dex.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Updates come from GitHub Releases — the same place the desktop updates
 * from. Each release carries `DEX-android-<ver>.apk`; if that version is newer
 * than this build, DEX offers it (Home's banner, Settings › About). The APK is
 * signed with the same key, so it installs over this one.
 */
data class AppUpdate(val version: String, val downloadUrl: String, val notesUrl: String, val size: Long = -1)

/** What GitHub said. */
sealed interface ReleaseCheck {
  /** Nothing newer. `latest` is the newest phone version published, when there is one. */
  data class UpToDate(val latest: String?) : ReleaseCheck
  data class Available(val update: AppUpdate) : ReleaseCheck
  data class Failed(val message: String) : ReleaseCheck
}

object ReleaseChecker {
  private const val LATEST = "https://api.github.com/repos/Chethan616/Dex/releases/latest"
  private val ASSET = Regex("""DEX-android-(\d+(?:\.\d+)*)\.apk""")

  /** Newer APK on GitHub Releases, or null (none, or GitHub unreachable). */
  suspend fun check(): AppUpdate? = (latest() as? ReleaseCheck.Available)?.update

  suspend fun latest(): ReleaseCheck = withContext(Dispatchers.IO) {
    runCatching {
      val conn = (URL(LATEST).openConnection() as HttpURLConnection).apply {
        setRequestProperty("Accept", "application/vnd.github+json")
        setRequestProperty("User-Agent", "DEX-Android/${BuildConfig.VERSION_NAME}")
        connectTimeout = 8000
        readTimeout = 8000
      }
      when (conn.responseCode) {
        200 -> Unit
        403, 429 -> return@runCatching ReleaseCheck.Failed("GitHub is busy right now. Try again in a few minutes.")
        else -> return@runCatching ReleaseCheck.Failed("Couldn’t reach GitHub (${conn.responseCode}).")
      }
      val release = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
      val assets = release.optJSONArray("assets") ?: return@runCatching ReleaseCheck.UpToDate(null)
      var newest: String? = null
      for (i in 0 until assets.length()) {
        val asset = assets.getJSONObject(i)
        val version = ASSET.matchEntire(asset.optString("name"))?.groupValues?.get(1) ?: continue
        if (newest == null || isNewer(version, newest)) newest = version
        if (isNewer(version, BuildConfig.VERSION_NAME)) {
          return@runCatching ReleaseCheck.Available(
            AppUpdate(version, asset.optString("browser_download_url"), release.optString("html_url"), asset.optLong("size", -1)),
          )
        }
      }
      ReleaseCheck.UpToDate(newest)
    }.getOrElse { ReleaseCheck.Failed("Couldn’t reach GitHub. Check your connection.") }
  }

  internal fun isNewer(candidate: String, current: String): Boolean {
    val a = candidate.split('.').map { it.toIntOrNull() ?: 0 }
    val b = current.split('.').map { it.toIntOrNull() ?: 0 }
    for (i in 0 until maxOf(a.size, b.size)) {
      val x = a.getOrElse(i) { 0 }
      val y = b.getOrElse(i) { 0 }
      if (x != y) return x > y
    }
    return false
  }
}
