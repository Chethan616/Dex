package com.chethan616.dex.ui.viewer

import android.annotation.SuppressLint
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.ViewInAr
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.chethan616.dex.data.SceneFiles
import com.chethan616.dex.ui.haptics.LocalHaptics
import java.io.File

private fun Color.hex(): String = String.format("#%06X", 0xFFFFFF and toArgb())

/**
 * Google's <model-viewer> (assets/viewer, Apache-2.0) in a WebView. The page,
 * the model and its sky are served by WebViewAssetLoader from the app's own
 * assets and cache over its private https origin — no network, no file://.
 *
 * [sky] puts the model inside that picture (a scene's HDRI); [view] starts
 * the camera where the PC's render was taken (orbit, target, fov).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ModelWebView(
  file: File,
  modifier: Modifier = Modifier,
  sky: File? = null,
  view: Map<String, String> = emptyMap(),
  onLoaded: () -> Unit = {},
) {
  val scheme = MaterialTheme.colorScheme
  val bg = scheme.surface
  val fg = scheme.onSurface
  AndroidView(
    factory = { ctx ->
      val root = File(ctx.cacheDir, "dex-files")
      val loader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
        .addPathHandler("/files/", WebViewAssetLoader.InternalStoragePathHandler(ctx, root))
        .build()
      val main = Handler(Looper.getMainLooper())
      WebView(ctx).apply {
        // AndroidView leaves a view with WRAP_CONTENT params, and a WebView
        // that wraps its height lays the page out with a zero-height
        // viewport (height:100% → 0px, so the model drew into nothing).
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setBackgroundColor(bg.toArgb())
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        // The page's errors and warnings land in logcat (tag DexViewer).
        webChromeClient = object : WebChromeClient() {
          override fun onConsoleMessage(m: ConsoleMessage): Boolean {
            val level = m.messageLevel()
            if (level == ConsoleMessage.MessageLevel.ERROR || level == ConsoleMessage.MessageLevel.WARNING) {
              Log.w("DexViewer", "${m.message()} (${m.sourceId().substringAfterLast('/')}:${m.lineNumber()})")
            }
            return true
          }
        }
        webViewClient = object : WebViewClientCompat() {
          override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            loader.shouldInterceptRequest(request.url)
        }
        addJavascriptInterface(
          object {
            @JavascriptInterface fun loaded() { main.post { onLoaded() } }
          },
          "DexViewer",
        )
        fun served(f: File) = "/files/" + f.relativeTo(root).invariantSeparatorsPath.split('/').joinToString("/") { Uri.encode(it) }
        val params = buildList {
          add("src" to served(file))
          add("bg" to bg.hex())
          add("fg" to fg.hex())
          sky?.let { add("sky" to served(it)) }
          for (k in listOf("orbit", "target", "fov", "radius", "aspect")) view[k]?.takeIf { it.isNotBlank() }?.let { add(k to it) }
        }
        loadUrl(
          "https://appassets.androidplatform.net/assets/viewer/index.html?" +
            params.joinToString("&") { (k, v) -> "$k=${Uri.encode(v)}" },
        )
      }
    },
    onRelease = { it.destroy() },
    modifier = modifier,
  )
}

/** Close · name · actions, over the viewer. */
@Composable
private fun ViewerTopBar(name: String, onDismiss: () -> Unit, actions: @Composable () -> Unit) {
  val haptics = LocalHaptics.current
  val scheme = MaterialTheme.colorScheme
  Row(
    Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    FilledTonalIconButton(onClick = { haptics.tick(); onDismiss() }, shapes = IconButtonDefaults.shapes()) {
      Icon(Icons.Rounded.Close, "Close")
    }
    Spacer(Modifier.size(10.dp))
    Surface(shape = RoundedCornerShape(50), color = scheme.surfaceContainerHigh.copy(alpha = 0.85f), contentColor = scheme.onSurface, modifier = Modifier.weight(1f)) {
      Text(name, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Spacer(Modifier.size(10.dp))
    actions()
  }
}

@Composable
private fun Hint(text: String, modifier: Modifier = Modifier) {
  val scheme = MaterialTheme.colorScheme
  Surface(shape = RoundedCornerShape(50), color = scheme.surfaceContainerHigh.copy(alpha = 0.85f), modifier = modifier) {
    Text(text, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
  }
}

@Composable
private fun Loading(text: String, modifier: Modifier = Modifier) {
  Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    LoadingIndicator(Modifier.size(64.dp))
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

/** A 3D model (GLB) from the PC, turned and zoomed right in the app. */
@Composable
fun ModelViewerDialog(
  file: File,
  name: String,
  onShare: () -> Unit,
  onOpenWith: () -> Unit,
  onDismiss: () -> Unit,
) {
  val haptics = LocalHaptics.current
  var loaded by remember(file) { mutableStateOf(false) }
  Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
      ModelWebView(file, Modifier.fillMaxSize(), onLoaded = { loaded = true })
      AnimatedVisibility(!loaded, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.Center)) {
        Loading("Loading the model…")
      }
      ViewerTopBar(name, onDismiss) {
        FilledTonalIconButton(onClick = { haptics.tick(); onShare() }, shapes = IconButtonDefaults.shapes()) { Icon(Icons.Rounded.Share, "Share") }
        FilledTonalIconButton(onClick = { haptics.tick(); onOpenWith() }, shapes = IconButtonDefaults.shapes()) { Icon(Icons.AutoMirrored.Rounded.OpenInNew, "Open with…") }
      }
      AnimatedVisibility(loaded, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 20.dp)) {
        Hint("Drag to turn · pinch to zoom · double-tap to reset")
      }
    }
  }
}

/**
 * A Blender scene (.blend) from the PC. Render: the PC's render through the
 * scene camera — real materials and light. 3D: the whole scene to walk
 * around, inside its sky, starting from that same camera.
 */
@Composable
fun SceneViewerDialog(
  scene: SceneFiles,
  name: String,
  onShare: () -> Unit,
  onDismiss: () -> Unit,
) {
  val haptics = LocalHaptics.current
  val scheme = MaterialTheme.colorScheme
  var tab by remember(scene) { mutableStateOf(if (scene.render != null) 0 else 1) }
  var loaded by remember(scene) { mutableStateOf(false) }
  Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
      // The 3D stays composed once opened, so switching back is instant.
      if (scene.glb != null && (tab == 1 || loaded)) {
        Box(Modifier.fillMaxSize().graphicsLayer { alpha = if (tab == 1) 1f else 0f }) {
          ModelWebView(scene.glb, Modifier.fillMaxSize(), sky = scene.sky, view = scene.view, onLoaded = { loaded = true })
        }
        if (tab == 1 && !loaded) Loading("Loading the scene…", Modifier.align(Alignment.Center))
      }
      if (tab == 0 && scene.render != null) ZoomableImage(scene.render, Modifier.fillMaxSize())

      ViewerTopBar(name, onDismiss) {
        FilledTonalIconButton(onClick = { haptics.tick(); onShare() }, shapes = IconButtonDefaults.shapes()) { Icon(Icons.Rounded.Share, "Share the render") }
      }

      Column(
        Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 16.dp, start = 16.dp, end = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        Hint(if (tab == 0) "Rendered on your PC · pinch to zoom · double-tap to fit" else "Drag to look around · pinch to zoom · two fingers to move · double-tap: camera view")
        Surface(shape = RoundedCornerShape(50), color = scheme.surfaceContainerHigh.copy(alpha = 0.92f)) {
          Row(Modifier.padding(6.dp), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
            ToggleButton(
              checked = tab == 0,
              onCheckedChange = { haptics.tick(); tab = 0 },
              enabled = scene.render != null,
              shapes = ButtonGroupDefaults.connectedLeadingButtonShapes(),
            ) {
              Icon(Icons.Rounded.Image, null, Modifier.size(18.dp)); Spacer(Modifier.size(8.dp)); Text("Render")
            }
            ToggleButton(
              checked = tab == 1,
              onCheckedChange = { haptics.tick(); tab = 1 },
              enabled = scene.glb != null,
              shapes = ButtonGroupDefaults.connectedTrailingButtonShapes(),
            ) {
              Icon(Icons.Rounded.ViewInAr, null, Modifier.size(18.dp)); Spacer(Modifier.size(8.dp)); Text("3D")
            }
          }
        }
      }
    }
  }
}

/** A picture you can pinch, pan and double-tap back to fit. */
@Composable
private fun ZoomableImage(file: File, modifier: Modifier = Modifier) {
  val bitmap = remember(file) { runCatching { BitmapFactory.decodeFile(file.path)?.asImageBitmap() }.getOrNull() }
  var scale by remember(file) { mutableFloatStateOf(1f) }
  var offset by remember(file) { mutableStateOf(Offset.Zero) }
  if (bitmap == null) {
    Box(modifier, contentAlignment = Alignment.Center) { Text("The render couldn’t be shown.", color = Color.White) }
    return
  }
  Image(
    bitmap,
    contentDescription = "The scene, rendered on your PC",
    contentScale = ContentScale.Fit,
    modifier = modifier
      .pointerInput(file) {
        detectTransformGestures { _, pan, zoom, _ ->
          scale = (scale * zoom).coerceIn(1f, 6f)
          offset = if (scale == 1f) Offset.Zero else offset + pan
        }
      }
      .pointerInput(file) {
        detectTapGestures(onDoubleTap = { tap ->
          if (scale > 1f) { scale = 1f; offset = Offset.Zero }
          else { scale = 2.5f; offset = (Offset(size.width / 2f, size.height / 2f) - tap) * 1.5f }
        })
      }
      .graphicsLayer {
        scaleX = scale; scaleY = scale
        translationX = offset.x; translationY = offset.y
      },
  )
}
