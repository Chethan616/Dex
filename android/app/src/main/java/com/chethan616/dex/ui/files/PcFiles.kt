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
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
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
import androidx.compose.material.icons.rounded.ViewInAr
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
import androidx.compose.runtime.LaunchedEffect
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
  /** [label]: what's happening, when it isn't a plain download ("Preparing the scene on your PC…"). */
  data class Loading(val progress: Float, val label: String? = null) : FetchState
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

  /** A 3D model open in the built-in viewer (see ModelViewerHost). */
  var viewing by mutableStateOf<Pair<File, TaskItem>?>(null)

  /** A Blender scene open in the scene viewer: render + 3D (see ModelViewerHost). */
  var viewingScene by mutableStateOf<Pair<com.chethan616.dex.data.SceneFiles, TaskItem>?>(null)
  private val scenes = mutableStateMapOf<String, com.chethan616.dex.data.SceneFiles>()

  init {
    // Yesterday's downloads: the PC still has them, the phone needn't. Once
    // per launch, on a background thread: this ran on the UI thread in the
    // first frame of every chat you opened.
    if (swept.compareAndSet(false, true)) {
      val dir = File(context.cacheDir, "dex-files")
      kotlin.concurrent.thread(isDaemon = true, name = "dex-files-sweep") {
        runCatching {
          val cutoff = System.currentTimeMillis() - 24 * 60 * 60_000L
          dir.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.deleteRecursively() }
        }
      }
    }
  }

  private companion object {
    val swept = java.util.concurrent.atomic.AtomicBoolean(false)
  }

  fun state(path: String?): FetchState = path?.let { states[it] } ?: FetchState.Idle

  fun open(scope: CoroutineScope, item: TaskItem, share: Boolean = false) {
    // A .blend opens as a scene (render + 3D) — sharing sends the file itself.
    if (!share && item.isScene()) {
      openScene(scope, item)
      return
    }
    val current = states[item.path]
    if (current is FetchState.Ready && current.file.exists()) {
      launch(current.file, item, share)
      return
    }
    if (current is FetchState.Loading) {
      openWhenReady = item.path to share // a tap during a prefetch opens it when it lands
      return
    }
    fetch(scope, item, quiet = false) { file -> launch(file, item, share) }
  }

  /**
   * Bring a file over without opening it: 3D models come to the phone as soon
   * as the task makes them, so the tap opens them at once. Quiet on failure —
   * a tap tries again and says why.
   */
  fun prefetch(scope: CoroutineScope, item: TaskItem) {
    if (states[item.path] != null) return
    fetch(scope, item, quiet = true) { }
  }

  private var openWhenReady: Pair<String, Boolean>? = null

  /**
   * A .blend: the PC prepares it in a windowless Blender (a render through
   * the scene camera, the scene as a GLB, its sky), then it comes over and
   * opens in the scene viewer. Cached, so the second time is instant.
   */
  private fun openScene(scope: CoroutineScope, item: TaskItem) {
    scenes[item.path]?.let { viewingScene = it to item; return }
    if (states[item.path] is FetchState.Loading) return
    states[item.path] = FetchState.Loading(0f, "Preparing the scene on your PC…")
    scope.launch {
      runCatching {
        repo.fetchScene(sessionId, item.path, item.size) { label, p ->
          states[item.path] = FetchState.Loading(p, label.ifBlank { null })
        }
      }
        .onSuccess { scene ->
          scenes[item.path] = scene
          states[item.path] = FetchState.Ready(scene.render ?: scene.glb ?: scene.dir)
          viewingScene = scene to item
        }
        .onFailure { states[item.path] = FetchState.Failed(it.message ?: "Couldn’t prepare the scene on your PC.") }
    }
  }

  private fun fetch(scope: CoroutineScope, item: TaskItem, quiet: Boolean, then: (File) -> Unit) {
    states[item.path] = FetchState.Loading(0f)
    scope.launch {
      runCatching { repo.fetchFile(sessionId, item.path, item.size) { p -> states[item.path] = FetchState.Loading(p) } }
        .onSuccess { file ->
          states[item.path] = FetchState.Ready(file)
          val waiting = openWhenReady
          if (waiting?.first == item.path) {
            openWhenReady = null
            launch(file, item, waiting.second)
          } else {
            then(file)
          }
        }
        .onFailure {
          if (quiet && openWhenReady?.first != item.path) states.remove(item.path)
          else states[item.path] = FetchState.Failed(it.message ?: "Couldn’t get it from your PC.")
        }
    }
  }

  private fun launch(file: File, item: TaskItem, share: Boolean) {
    // 3D models open right here, in the built-in viewer.
    if (!share && file.extension.lowercase() in MODEL_EXTENSIONS) {
      viewing = file to item
      return
    }
    launchExternal(file, item, share)
  }

  /** Hand the file to another app: Android's Open with… or Share sheet. */
  fun launchExternal(file: File, item: TaskItem, share: Boolean) {
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

internal val MODEL_EXTENSIONS = setOf("glb", "gltf")

/** Blender scenes: opened as render + 3D, prepared on the PC. */
internal val SCENE_EXTENSIONS = setOf("blend")

internal fun TaskItem.isScene(): Boolean = name.substringAfterLast('.').lowercase() in SCENE_EXTENSIONS

/**
 * Not a result: Blender's save-in-progress (`x.blend@`) and backups
 * (`.blend1`), lock/temp files — older tasks recorded these (the PC no longer
 * does, see desktop hl/engines/outputs.ts).
 */
internal fun TaskItem.isScratch(): Boolean =
  name.endsWith("@") || Regex("""\.blend\d+$""", RegexOption.IGNORE_CASE).containsMatchIn(name) ||
    name.startsWith("~$") || Regex("""\.(tmp|part|crdownload)$""", RegexOption.IGNORE_CASE).containsMatchIn(name)

private fun TaskItem.tapHint(): String = when {
  isScene() -> "tap to view the scene"
  name.substringAfterLast('.').lowercase() in MODEL_EXTENSIONS -> "tap to view in 3D"
  else -> "tap to open"
}

/** Models small enough to bring over unasked (Firestore chunks, ~9 per 6 MB). */
internal fun TaskItem.worthPrefetching(): Boolean =
  name.substringAfterLast('.').lowercase() in MODEL_EXTENSIONS && size in 1..40L * 1024 * 1024

val LocalPcFiles = staticCompositionLocalOf<PcFiles?> { null }

/** Shows the built-in 3D / scene viewer when a model or .blend is opened from this session. */
@Composable
fun ModelViewerHost() {
  val files = LocalPcFiles.current ?: return
  files.viewingScene?.let { (scene, item) ->
    com.chethan616.dex.ui.viewer.SceneViewerDialog(
      scene = scene,
      name = item.name,
      onShare = {
        val render = scene.render
        if (render != null) files.launchExternal(render, TaskItem(render.path, "${item.name.substringBeforeLast('.')} render.jpg", render.length(), "image/jpeg", null, null), share = true)
      },
      onDismiss = { files.viewingScene = null },
    )
    return
  }
  val (file, item) = files.viewing ?: return
  com.chethan616.dex.ui.viewer.ModelViewerDialog(
    file = file,
    name = item.name,
    onShare = { files.launchExternal(file, item, share = true) },
    onOpenWith = { files.launchExternal(file, item, share = false) },
    onDismiss = { files.viewing = null },
  )
}

@Composable
fun rememberPcFiles(context: Context, repo: DexRepository, sessionId: String): PcFiles =
  remember(sessionId) { PcFiles(context.applicationContext, repo, sessionId) }

/** Pictures by what they are, not by whether a preview came along. */
private val IMAGE_EXTENSIONS = setOf("png", "jpg", "jpeg", "webp", "gif", "bmp")

internal fun TaskItem.isPicture(): Boolean =
  thumb != null || mime?.startsWith("image/") == true || name.substringAfterLast('.').lowercase() in IMAGE_EXTENSIONS

/** Pictures without an inline preview are fetched for the grid up to this size. */
private const val MAX_PREVIEW_FETCH = 12L * 1024 * 1024

/**
 * Decoded previews, so a picture scrolled away and back isn't decoded again.
 * Bounded by pixel bytes (~24 MB).
 */
private object PreviewCache {
  private val cache = object : android.util.LruCache<String, ImageBitmap>(24 * 1024 * 1024) {
    override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
  }
  fun get(key: String): ImageBitmap? = cache.get(key)
  fun put(key: String, bitmap: ImageBitmap) { cache.put(key, bitmap) }
}

/**
 * A small bitmap of a picture already on the phone — decoded at ~1/4 size or
 * less, on a background thread (decoding in composition stalled scrolling).
 */
@Composable
fun rememberLocalPreview(file: File?): ImageBitmap? {
  val key = file?.let { "f${it.path}:${it.length()}" }
  return androidx.compose.runtime.produceState(key?.let { PreviewCache.get(it) }, key) {
    if (file == null || key == null || value != null) return@produceState
    value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
      file.takeIf { it.isFile }?.let { f ->
        runCatching {
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeFile(f.path, bounds)
          var sample = 1
          while (bounds.outWidth / (sample * 2) >= 360) sample *= 2
          BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
        }.getOrNull()
      }?.also { PreviewCache.put(key, it) }
    }
  }.value
}

/**
 * An inline preview (a ~50 KB JPEG the PC attached to the block). Its shape
 * comes at once from the JPEG header, so the card has its final size from
 * the first frame; its pixels are decoded on a background thread and fill in
 * a moment later. Decoding in composition used to stall opening a chat full
 * of screenshots.
 */
@androidx.compose.runtime.Stable
class Thumb(val aspect: Float, bitmap: ImageBitmap?) {
  var bitmap: ImageBitmap? by mutableStateOf(bitmap)
}

@Composable
fun rememberThumb(base64: String?): Thumb? {
  if (base64 == null) return null
  val key = remember(base64) { "t${base64.length}:${base64.hashCode()}" }
  val thumb = remember(key) {
    val cached = PreviewCache.get(key)
    val aspect = cached?.let { it.width.toFloat() / it.height } ?: runCatching {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      if (bounds.outWidth > 0 && bounds.outHeight > 0) bounds.outWidth.toFloat() / bounds.outHeight else null
    }.getOrNull()
    aspect?.let { Thumb(it, cached) }
  } ?: return null
  if (thumb.bitmap == null) {
    LaunchedEffect(key) {
      thumb.bitmap = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
        runCatching {
          val bytes = Base64.decode(base64, Base64.DEFAULT)
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull()?.also { PreviewCache.put(key, it) }
      }
    }
  }
  return thumb
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
  item.name.substringAfterLast('.').lowercase() in MODEL_EXTENSIONS || item.isScene() -> Icons.Rounded.ViewInAr
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
        Box(
          Modifier
            .fillMaxWidth()
            .aspectRatio(thumb.aspect.coerceIn(0.6f, 2.2f))
            .heightIn(max = 320.dp)
            .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = 6.dp, bottomEnd = 6.dp))
            .background(scheme.surfaceContainerHigh),
        ) {
          thumb.bitmap?.let {
            Image(it, contentDescription = item.caption ?: item.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
          }
        }
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
              is FetchState.Loading -> when {
                state.label != null && state.progress <= 0f -> state.label
                state.label != null -> "${state.label} ${(state.progress * 100).toInt()}%"
                else -> "Downloading from your PC… ${(state.progress * 100).toInt()}%"
              }
              is FetchState.Ready -> listOfNotNull(readableSize(item.size).ifEmpty { null }, "on your phone · ${item.tapHint()}").joinToString(" · ")
              is FetchState.Failed -> state.message
              else -> listOfNotNull(readableSize(item.size).ifEmpty { null }, item.tapHint()).joinToString(" · ")
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
        val bar = Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(bottom = 10.dp)
        // Preparing on the PC has no percentage yet: an indeterminate bar.
        if (state.label != null && state.progress <= 0f) LinearProgressIndicator(modifier = bar)
        else LinearProgressIndicator(progress = { state.progress.coerceAtLeast(0.03f) }, modifier = bar)
      }
    }
  }
}

/** Everything a task produced: pictures, files, documents — deduped by path. */
fun collectTaskItems(blocks: List<Block>, session: Session?): Triple<List<TaskItem>, List<TaskItem>, List<Block>> {
  // Windows paths: the same file can come with backslashes or forward slashes.
  fun key(path: String) = path.replace('\\', '/').lowercase()
  val seen = HashSet<String>()
  val all = mutableListOf<TaskItem>()
  for (b in blocks) {
    if (b.kind != "file" && b.kind != "image") continue
    val item = b.asTaskItem() ?: continue
    if (!item.isScratch() && seen.add(key(item.path))) all += item
  }
  for (f in session?.files.orEmpty()) {
    val item = TaskItem(f.path, f.name, f.size, null, null, null)
    if (!item.isScratch() && seen.add(key(f.path))) all += item
  }
  val pictures = all.filter { it.isPicture() }
  val files = all.filter { !it.isPicture() }
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

  val sheetMax = com.chethan616.dex.ui.components.rememberSheetMaxHeight()
  val navBottom = androidx.compose.foundation.layout.WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    shape = RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp),
    contentWindowInsets = { com.chethan616.dex.ui.components.NoSheetInsets },
  ) {
    LazyColumn(
      Modifier.fillMaxWidth().heightIn(max = sheetMax),
      contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp + navBottom),
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
              val st = files0?.state(pic.path)
              // No inline preview (a picture recorded before the PC made
              // them): bring the picture over and show that instead.
              if (pic.thumb == null && pic.size <= MAX_PREVIEW_FETCH) {
                LaunchedEffect(pic.path) { files0?.prefetch(scope, pic) }
              }
              val bmp = rememberThumb(pic.thumb)?.bitmap ?: rememberLocalPreview((st as? FetchState.Ready)?.file)
              Box(
                Modifier
                  .weight(1f)
                  .aspectRatio(1f)
                  .clip(RoundedCornerShape(16.dp))
                  .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                  .clickable { haptics.tick(); files0?.open(scope, pic) },
              ) {
                bmp?.let { Image(it, pic.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                if (bmp == null) {
                  Icon(Icons.Rounded.Image, null, Modifier.align(Alignment.Center).size(28.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
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
      contentWindowInsets = { com.chethan616.dex.ui.components.NoSheetInsets },
    ) {
      Column(Modifier.heightIn(max = sheetMax).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp + navBottom)) {
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
