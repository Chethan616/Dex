package com.chethan616.dex.share

import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * Something shared into DEX from another app (Share → DEX): a link or text,
 * and/or photos and files. Opens the new-task sheet pre-filled, with one-tap
 * actions that fit what was shared.
 */
data class SharedContent(
  val text: String?,
  val subject: String?,
  val uris: List<Uri>,
  val mimeType: String?,
) {
  val hasImage: Boolean get() = mimeType?.startsWith("image/") == true
  val hasFiles: Boolean get() = uris.isNotEmpty()

  /** One-tap instructions that suit what came in. */
  fun quickActions(): List<String> = when {
    hasImage -> listOf("What’s in this?", "Make a 3D model of this", "Extract the text", "Save it to my Drive")
    hasFiles -> listOf("Summarize this", "Fill in this form", "Save it to my Drive", "Email it to…")
    !text.isNullOrBlank() && Regex("""https?://""").containsMatchIn(text) ->
      listOf("Summarize this page", "Research this", "Add it to my calendar", "Save it for later")
    else -> listOf("Summarize this", "Draft a reply", "Add it to my calendar", "Research this")
  }

  companion object {
    fun from(intent: Intent?): SharedContent? {
      if (intent == null) return null
      val action = intent.action
      if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return null
      val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.takeIf { it.isNotEmpty() }
      val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()?.takeIf { it.isNotEmpty() }
      val uris: List<Uri> = if (action == Intent.ACTION_SEND_MULTIPLE) {
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
        else @Suppress("DEPRECATION") intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
      } else {
        listOfNotNull(
          if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
          else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM),
        )
      }
      if (text == null && uris.isEmpty()) return null
      return SharedContent(text, subject, uris, intent.type)
    }
  }
}
