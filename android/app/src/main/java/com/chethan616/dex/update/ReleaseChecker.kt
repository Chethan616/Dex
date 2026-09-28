package com.chethan616.dex.update

import com.chethan616.dex.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Updates come from GitHub Releases — the same place the desktop updates
 * from. .github/workflows/dex-release.yml attaches `DEX-android-<ver>.apk`
 * to each release; if that version is newer than this build, the home screen
 * offers it. The APK is signed with the same key, so it installs over this one.
 */
data class AppUpdate(val version: String, val downloadUrl: String, val notesUrl: String)

object ReleaseChecker {
  private const val LATEST = "https://api.github.com/repos/Chethan616/Dex/releases/latest"
  private val ASSET = Regex("""DEX-android-(\d+(?:\.\d+)*)\.apk""")

  suspend fun check(): AppUpdate? = withContext(Dispatchers.IO) {
    runCatching {
      val conn = (URL(LATEST).openConnection() as HttpURLConnection).apply {
        setRequestProperty("Accept", "application/vnd.github+json")
        setRequestProperty("User-Agent", "DEX-Android/${BuildConfig.VERSION_NAME}")
        connectTimeout = 8000
        readTimeout = 8000
      }
      if (conn.responseCode != 200) return@runCatching null
      val release = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
      val assets = release.optJSONArray("assets") ?: return@runCatching null
      for (i in 0 until assets.length()) {
        val asset = assets.getJSONObject(i)
        val match = ASSET.matchEntire(asset.optString("name")) ?: continue
        val version = match.groupValues[1]
        if (isNewer(version, BuildConfig.VERSION_NAME)) {
          return@runCatching AppUpdate(version, asset.optString("browser_download_url"), release.optString("html_url"))
        }
      }
      null
    }.getOrNull()
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
