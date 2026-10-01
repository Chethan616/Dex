package com.chethan616.dex.ui.attach

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.InsertDriveFile
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chethan616.dex.data.AttachmentMeta
import com.chethan616.dex.data.Outgoing
import com.chethan616.dex.data.PendingAttachment
import com.chethan616.dex.ui.files.readableSize
import com.chethan616.dex.ui.haptics.LocalHaptics
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** What's attached to the message being written, plus its problems. */
class AttachmentState(private val context: Context) {
  val items = mutableStateListOf<PendingAttachment>()
  var error by mutableStateOf<String?>(null)
  var preparing by mutableStateOf(false)
  /** 0..1 while uploading on send; null otherwise. */
  var uploadProgress by mutableStateOf<Float?>(null)

  suspend fun add(uris: List<Uri>) {
    if (uris.isEmpty()) return
    error = null
    preparing = true
    try {
      for (uri in uris) {
        if (items.size >= Outgoing.MAX_FILES) { error = "Up to ${Outgoing.MAX_FILES} files per message."; break }
        val att = runCatching { Outgoing.prepare(context, uri) }.getOrElse { error = it.message ?: "Couldn’t attach that."; null } ?: continue
        if (items.sumOf { it.size } + att.size > Outgoing.MAX_TOTAL) { error = "That’s more than 50 MB in one message."; break }
        items += att
      }
    } finally {
      preparing = false
    }
  }

  fun remove(att: PendingAttachment) { items.remove(att); att.file.delete() }
  fun takeAll(): List<PendingAttachment> = items.toList().also { items.clear(); error = null }
}

@Composable
fun rememberAttachmentState(): AttachmentState {
  val context = LocalContext.current.applicationContext
  return remember { AttachmentState(context).also { Outgoing.sweep(context) } }
}

/** The three ways in: photo library, camera, any file. */
class AttachPickers(val photos: () -> Unit, val camera: () -> Unit, val files: () -> Unit)

@Composable
fun rememberAttachPickers(state: AttachmentState): AttachPickers {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val haptics = LocalHaptics.current
  var cameraTarget by remember { mutableStateOf<Pair<File, Uri>?>(null) }
  val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(Outgoing.MAX_FILES)) { uris ->
    if (uris.isNotEmpty()) { haptics.confirm(); scope.launch { state.add(uris) } }
  }
  val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
    if (uris.isNotEmpty()) { haptics.confirm(); scope.launch { state.add(uris) } }
  }
  val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
    val target = cameraTarget
    if (ok && target != null) {
      haptics.confirm()
      scope.launch { state.add(listOf(target.second)); target.first.delete() }
    }
  }
  return remember {
    AttachPickers(
      photos = { photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
      camera = {
        val target = Outgoing.newCameraTarget(context)
        cameraTarget = target
        runCatching { camera.launch(target.second) }
      },
      files = { files.launch(arrayOf("*/*")) },
    )
  }
}

/** Photos · Camera · Files (and optionally one more line, e.g. "More options"). */
@Composable
fun AttachMenu(
  expanded: Boolean,
  onDismiss: () -> Unit,
  pickers: AttachPickers,
  extraLabel: String? = null,
  onExtra: (() -> Unit)? = null,
) {
  val haptics = LocalHaptics.current
  DropdownMenu(expanded = expanded, onDismissRequest = onDismiss, shape = RoundedCornerShape(20.dp)) {
    DropdownMenuItem(
      text = { Text("Photos") },
      leadingIcon = { Icon(Icons.Rounded.PhotoLibrary, null) },
      onClick = { haptics.tick(); onDismiss(); pickers.photos() },
    )
    DropdownMenuItem(
      text = { Text("Camera") },
      leadingIcon = { Icon(Icons.Rounded.PhotoCamera, null) },
      onClick = { haptics.tick(); onDismiss(); pickers.camera() },
    )
    DropdownMenuItem(
      text = { Text("Files") },
      leadingIcon = { Icon(Icons.Rounded.FolderOpen, null) },
      onClick = { haptics.tick(); onDismiss(); pickers.files() },
    )
    if (extraLabel != null && onExtra != null) {
      androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 4.dp))
      DropdownMenuItem(
        text = { Text(extraLabel) },
        leadingIcon = { Icon(Icons.Rounded.Tune, null) },
        onClick = { haptics.tick(); onDismiss(); onExtra() },
      )
    }
  }
}

@Composable
private fun rememberFileThumb(file: File, isImage: Boolean): ImageBitmap? {
  val thumb by produceState<ImageBitmap?>(null, file) {
    if (!isImage) return@produceState
    value = withContext(Dispatchers.IO) {
      runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 160) sample *= 2
        BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
      }.getOrNull()
    }
  }
  return thumb
}

private fun iconFor(mime: String) = when {
  mime.startsWith("image/") -> Icons.Rounded.Image
  mime == "application/pdf" -> Icons.Rounded.PictureAsPdf
  else -> Icons.AutoMirrored.Rounded.InsertDriveFile
}

/** The attachments being written: thumbnails, names, remove buttons, upload progress. */
@Composable
fun AttachmentStrip(state: AttachmentState, modifier: Modifier = Modifier) {
  val haptics = LocalHaptics.current
  val scheme = MaterialTheme.colorScheme
  if (state.items.isEmpty() && state.error == null && !state.preparing) return
  Column(modifier.animateContentSize(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    if (state.items.isNotEmpty() || state.preparing) {
      LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(state.items, key = { it.file.path }) { att ->
          val thumb = rememberFileThumb(att.file, att.isImage)
          Surface(shape = RoundedCornerShape(16.dp), color = scheme.surfaceContainerHighest) {
            Row(Modifier.padding(4.dp).widthIn(max = 220.dp), verticalAlignment = Alignment.CenterVertically) {
              Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(scheme.primaryContainer), contentAlignment = Alignment.Center) {
                if (thumb != null) Image(thumb, att.name, contentScale = ContentScale.Crop, modifier = Modifier.size(44.dp))
                else Icon(iconFor(att.mime), null, tint = scheme.onPrimaryContainer, modifier = Modifier.size(20.dp))
              }
              Spacer(Modifier.size(8.dp))
              Column(Modifier.weight(1f, fill = false)) {
                Text(att.name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(readableSize(att.size), style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant)
              }
              Box(
                Modifier.padding(start = 4.dp).size(28.dp).clip(CircleShape)
                  .background(scheme.surfaceContainerHigh)
                  .then(Modifier.padding(0.dp)),
                contentAlignment = Alignment.Center,
              ) {
                androidx.compose.material3.IconButton(onClick = { haptics.tick(); state.remove(att) }, modifier = Modifier.size(28.dp)) {
                  Icon(Icons.Rounded.Close, "Remove ${att.name}", Modifier.size(16.dp))
                }
              }
            }
          }
        }
        if (state.preparing) {
          item(key = "preparing") {
            Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
              androidx.compose.material3.LoadingIndicator(Modifier.size(32.dp))
            }
          }
        }
      }
    }
    state.uploadProgress?.let { p ->
      LinearProgressIndicator(progress = { p.coerceAtLeast(0.03f) }, modifier = Modifier.padding(horizontal = 4.dp))
    }
    state.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = scheme.error) }
  }
}

/** Files sent with a message, shown above the bubble. */
@Composable
fun SentAttachmentChips(items: List<AttachmentMeta>, modifier: Modifier = Modifier) {
  if (items.isEmpty()) return
  val scheme = MaterialTheme.colorScheme
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End)) {
    items.take(4).forEach { a ->
      Surface(shape = RoundedCornerShape(14.dp), color = scheme.secondaryContainer) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp).widthIn(max = 180.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(iconFor(a.mime), null, Modifier.size(16.dp), tint = scheme.onSecondaryContainer)
          Spacer(Modifier.size(6.dp))
          Text(a.name, style = MaterialTheme.typography.labelMedium, color = scheme.onSecondaryContainer, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    }
    if (items.size > 4) {
      Surface(shape = RoundedCornerShape(14.dp), color = scheme.secondaryContainer) {
        Text("+${items.size - 4}", Modifier.padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium)
      }
    }
  }
}
