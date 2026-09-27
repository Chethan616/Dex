package com.chethan616.dex.ui.files

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.InsertDriveFile
import androidx.compose.material.icons.rounded.Article
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.PermMedia
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.chethan616.dex.data.Block
import com.chethan616.dex.data.DexRepository
import com.chethan616.dex.data.Session
import com.chethan616.dex.ui.components.Markdown
import com.chethan616.dex.ui.haptics.LocalHaptics
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.io.File

/** Where one file stands on the phone. */
sealed interface FetchState {
  data object Idle : FetchState
  data class Loading(val progress: Float) : FetchState
  data class Ready(val file: File) : FetchState
  data class Failed(val message: String) : FetchState
}

/** One picture/file/document a task produced — however it was recorded. */
@Immutable
data class TaskItem(
  val path: String,
  val name: String,
  val size: Long,
  val mime: String?,
  val thumb: String?,
  val caption: String?,
)

/**
 * Pictures and files from the PC, per session: fetched once on tap (see
 * DexRepository.fetchFile), kept in the cache, then opened or shared with
 * whatever app the phone has for them.
 */
class PcFiles(private val context: Context, private val repo: DexRepository, private val sessionId: String) {
  private val states = mutableStateMapOf<String, FetchState>()

  init {
    // Yesterday's downloads: the PC still has them, the phone needn't.
    runCatching {
      val cutoff = System.currentTimeMillis() - 24 * 60 * 60_000L
      File(context.cacheDir, "dex-files").listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.deleteRecursively() }
    }
  }

  fun state(path: String?): FetchState = path?.let { states[it] } ?: FetchState.Idle

  fun open(scope: CoroutineScope, item: TaskItem, share: Boolean = false) {
    val current = states[item.path]
    if (current is FetchState.Loading) return
    if (current is FetchState.Ready && current.file.exists()) {
      launch(current.file, item, share)
      return
    }
    states[item.path] = FetchState.Loading(0f)
    scope.launch {
      runCatching { repo.fetchFile(sessionId, item.path) { p -> states[item.path] = FetchState.Loading(p) } }
        .onSuccess { file ->
          states[item.path] = FetchState.Ready(file)
          launch(file, item, share)
        }
        .onFailure { states[item.path] = FetchState.Failed(it.message ?: "Couldn’t get it from your PC.") }
    }
  }

  private fun launch(file: File, item: TaskItem, share: Boolean) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val type = item.mime?.takeIf { it.isNotBlank() && it != "application/octet-stream" }
      ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase())
      ?: "*/*"
    val intent = if (share) {
      Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri)
    } else {
      Intent(Intent.ACTION_VIEW).setDataAndType(uri, type)
    }.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try {
      context.startActivity(
        Intent.createChooser(intent, if (share) "Share ${item.name}" else "Open ${item.name}")
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION),
      )
    } catch (_: ActivityNotFoundException) {
      states[item.path] = FetchState.Failed("No app on this phone opens .${file.extension} files.")
    }
  }
}

val LocalPcFiles = staticCompositionLocalOf<PcFiles?> { null }

@Composable
fun rememberPcFiles(context: Context, repo: DexRepository, sessionId: String): PcFiles =
  remember(sessionId) { PcFiles(context.applicationContext, repo, sessionId) }

/** The inline preview's pixels (a ~50 KB JPEG the PC attached to the block). */
@Composable
fun rememberThumb(base64: String?): ImageBitmap? = remember(base64) {
  base64?.let {
    runCatching {
      val bytes = Base64.decode(it, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
    }.getOrNull()
  }
}

fun Block.asTaskItem(): TaskItem? {
  val p = path ?: return null
  return TaskItem(
    path = p,
    name = name ?: p.substringAfterLast('\\').substringAfterLast('/'),
    size = size,
    mime = mime ?: if (kind == "image") "image/png" else null,
    thumb = thumb,
    caption = if (kind == "image") text else null,
  )
}

fun readableSize(n: Long): String = when {
  n <= 0 -> ""
  n < 1024 -> "$n B"
  n < 1024 * 1024 -> "${n / 1024} KB"
  else -> String.format(java.util.Locale.US, "%.1f MB", n / 1048576.0)
}

private fun iconFor(item: TaskItem) = when {
  item.thumb != null || item.mime?.startsWith("image/") == true -> Icons.Rounded.Image
  item.mime == "application/pdf" || item.name.endsWith(".pdf", true) -> Icons.Rounded.PictureAsPdf
  else -> Icons.AutoMirrored.Rounded.InsertDriveFile
}

/**
 * A picture or file in the chat: the picture itself when there's a preview,
 * then name, size and Share. Tap to open it on the phone.
 */
@Composable
fun PcFileCard(item: TaskItem) {
  val files = LocalPcFiles.current
  val scope = rememberCoroutineScope()
  val haptics = LocalHaptics.current
  val thumb = rememberThumb(item.thumb)
  val state = files?.state(item.path) ?: FetchState.Idle
  val scheme = MaterialTheme.colorScheme

  Surface(
    shape = RoundedCornerShape(22.dp),
    color = scheme.surfaceContainerLow,
    modifier = Modifier.fillMaxWidth(),
    onClick = { haptics.tick(); files?.open(scope, item) },
  ) {
    Column {
      if (thumb != null) {
        Image(
          thumb,
          contentDescription = item.caption ?: item.name,
          contentScale = ContentScale.Crop,
          modifier = Modifier
            .fillMaxWidth()
            .aspectRatio((thumb.width.toFloat() / thumb.height).coerceIn(0.6f, 2.2f))
            .heightIn(max = 320.dp)
            .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = 6.dp, bottomEnd = 6.dp)),
        )
      }
      Row(Modifier.padding(start = 14.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (thumb == null) {
          Box(Modifier.size(38.dp).background(scheme.primaryContainer, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            Icon(iconFor(item), null, tint = scheme.onPrimaryContainer, modifier = Modifier.size(20.dp))
          }
          Spacer(Modifier.size(12.dp))
        }
        Column(Modifier.weight(1f)) {
          Text(item.caption?.takeIf { it.isNotBlank() && it != "Screenshot" } ?: item.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Text(
            when (state) {
              is FetchState.Loading -> "Getting it from your PC… ${(state.progress * 100).toInt()}%"
              is FetchState.Failed -> state.message
              else -> listOfNotNull(readableSize(item.size).ifEmpty { null }, "tap to open").joinToString(" · ")
            },
            style = MaterialTheme.typography.bodySmall,
            color = if (state is FetchState.Failed) scheme.error else scheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
          )
        }
        IconButton(onClick = { haptics.tick(); files?.open(scope, item, share = true) }) {
          Icon(Icons.Rounded.Share, "Share", tint = scheme.onSurfaceVariant)
        }
      }
      if (state is FetchState.Loading) {
        LinearProgressIndicator(
          progress = { state.progress.coerceAtLeast(0.03f) },
          modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(bottom = 10.dp),
        )
      }
    }
  }
}

/** Everything a task produced: pictures, files, documents — deduped by path. */
fun collectTaskItems(blocks: List<Block>, session: Session?): Triple<List<TaskItem>, List<TaskItem>, List<Block>> {
  val seen = HashSet<String>()
  val all = mutableListOf<TaskItem>()
  for (b in blocks) {
    if (b.kind != "file" && b.kind != "image") continue
    val item = b.asTaskItem() ?: continue
    if (seen.add(item.path.lowercase())) all += item
  }
  for (f in session?.files.orEmpty()) {
    if (seen.add(f.path.lowercase())) all += TaskItem(f.path, f.name, f.size, null, null, null)
  }
  val pictures = all.filter { it.thumb != null }
  val files = all.filter { it.thumb == null }
  val documents = blocks.filter { it.kind == "canvas" && !it.text.isNullOrBlank() }
  return Triple(pictures, files, documents)
}

/** Top-bar button: the task's Files, with a count. Hidden when there's nothing. */
@Composable
fun FilesButton(count: Int, onClick: () -> Unit) {
  if (count == 0) return
  IconButton(onClick = onClick) {
    BadgedBox(badge = { Badge { Text("$count") } }) { Icon(Icons.Rounded.PermMedia, "Files from this task") }
  }
}

@Composable
fun FilesSheet(blocks: List<Block>, session: Session?, onDismiss: () -> Unit) {
  val (pictures, files, documents) = remember(blocks, session) { collectTaskItems(blocks, session) }
  var reading by remember { mutableStateOf<Block?>(null) }
  val files0 = LocalPcFiles.current
  val scope = rememberCoroutineScope()
  val haptics = LocalHaptics.current

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    shape = RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp),
  ) {
    LazyColumn(
      Modifier.fillMaxWidth(),
      contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      item { Text("Files from this task", style = MaterialTheme.typography.headlineSmall) }
      item {
        Text(
          "Stored on your PC — tap one and it comes over to open or share.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      if (pictures.isNotEmpty()) {
        item { SectionLabel("Pictures · ${pictures.size}") }
        items(pictures.chunked(3)) { row ->
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            row.forEach { pic ->
              val bmp = rememberThumb(pic.thumb)
              val st = files0?.state(pic.path)
              Box(
                Modifier
                  .weight(1f)
                  .aspectRatio(1f)
                  .clip(RoundedCornerShape(16.dp))
                  .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                  .clickable { haptics.tick(); files0?.open(scope, pic) },
              ) {
                bmp?.let { Image(it, pic.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                if (st is FetchState.Loading) {
                  LinearProgressIndicator(progress = { st.progress.coerceAtLeast(0.03f) }, modifier = Modifier.fillMaxWidth().align(Alignment.BottomCenter))
                }
              }
            }
            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
          }
        }
      }
      if (files.isNotEmpty()) {
        item { SectionLabel("Files · ${files.size}") }
        items(files, key = { it.path }) { PcFileCard(it) }
      }
      if (documents.isNotEmpty()) {
        item { SectionLabel("Documents · ${documents.size}") }
        items(documents, key = { it.seq }) { doc ->
          Surface(
            shape = RoundedCornerShape(22.dp),
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            onClick = { haptics.tick(); reading = doc },
            modifier = Modifier.fillMaxWidth(),
          ) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
              Box(Modifier.size(38.dp).background(MaterialTheme.colorScheme.tertiaryContainer, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Article, null, tint = MaterialTheme.colorScheme.onTertiaryContainer, modifier = Modifier.size(20.dp))
              }
              Spacer(Modifier.size(12.dp))
              Column(Modifier.weight(1f)) {
                Text(doc.name ?: "Document", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                  doc.text.orEmpty().lineSequence().firstOrNull { it.isNotBlank() && !it.startsWith("#") }.orEmpty().take(90),
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis,
                )
              }
            }
          }
        }
      }
      if (pictures.isEmpty() && files.isEmpty() && documents.isEmpty()) {
        item {
          Text(
            "Nothing yet — pictures, files and documents this task makes show up here.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 24.dp),
          )
        }
      }
    }
  }

  reading?.let { doc ->
    ModalBottomSheet(
      onDismissRequest = { reading = null },
      shape = RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp),
    ) {
      Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
        Text(doc.name ?: "Document", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.size(12.dp))
        Markdown(doc.text.orEmpty())
      }
    }
  }
}

@Composable
private fun SectionLabel(text: String) {
  Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
}
