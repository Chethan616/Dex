package com.chethan616.dex.data

/**
 * What the desktop mirrors into Firestore (desktop/app/src/main/firebase/
 * bridge.ts is the writer; keep the two in step). Parsed by hand from
 * DocumentSnapshot maps — no reflection, so nothing breaks under R8.
 */

enum class SessionStatus(val id: String) {
  Draft("draft"), Running("running"), Stuck("stuck"), Idle("idle"), Paused("paused"), Stopped("stopped");

  val isLive: Boolean get() = this == Running || this == Stuck

  companion object {
    fun from(id: String?): SessionStatus = entries.firstOrNull { it.id == id } ?: Stopped
  }
}

data class PendingConfirmation(val id: String, val title: String, val detail: String)

data class Session(
  val id: String,
  val prompt: String,
  val status: SessionStatus,
  val engine: String?,
  val model: String?,
  val createdAt: Long,
  val lastActivityAt: Long,
  val lastLine: String,
  val summary: String?,
  val error: String?,
  val costUsd: Double,
  val tokens: Long,
  val blockCount: Int,
  val pendingConfirmation: PendingConfirmation?,
  val deviceName: String?,
  /** Files the task recorded (dex-state file), for the Files sheet. */
  val files: List<TaskFile> = emptyList(),
  /** Reactions by message key (desktop/app/src/shared/reactions.ts): 'u:prompt', 'u:<at>', 'a:<at>'. */
  val reactions: Map<String, List<Reaction>> = emptyMap(),
)

/** One emoji on a message, from you or from DEX. */
data class Reaction(val emoji: String, val byAgent: Boolean)

data class TaskFile(val name: String, val path: String, val size: Long)

data class ToolResult(val ok: Boolean, val preview: String, val ms: Long)

/**
 * A subagent the task launched (desktop/app/src/main/firebase/bridge.ts's
 * serializeSubagent is the writer, built from src/shared/subagents.ts's
 * fold of Claude Code's Task tool). Only the latest step is mirrored here —
 * never the full step list — the phone shows mention rows and an
 * Active/Done sheet, not a per-subagent transcript.
 */
data class SubagentActivity(val kind: String, val name: String?, val preview: String?, val at: Long?)

data class Subagent(
  val id: String,
  val name: String,
  val subagentType: String?,
  val prompt: String?,
  val status: String, // "active" | "done"
  val ok: Boolean?,
  val summary: String?,
  val startedAt: Long?,
  val endedAt: Long?,
  val lastActivity: SubagentActivity?,
  val stepCount: Long,
) {
  val isActive: Boolean get() = status == "active"
}

/** One chat block — same kinds as renderer/logs/transcript.ts. */
data class Block(
  val seq: Long,
  val kind: String,
  /** When the desktop recorded it (SessionManager.appendOutput's `at`), ms since epoch. Absent on sessions recorded before blocks carried times. */
  val at: Long? = null,
  val text: String? = null,
  val name: String? = null,
  val toolKind: String? = null,
  val verb: String? = null,
  val activeVerb: String? = null,
  val orb: String? = null,
  val display: String? = null,
  val summary: String? = null,
  val argsJson: String? = null,
  val iteration: Long = 0,
  val result: ToolResult? = null,
  val level: String? = null,
  val detail: String? = null,
  val size: Long = 0,
  val mime: String? = null,
  val count: Long = 0,
  val items: List<Pair<String, String?>> = emptyList(),
  /** Done only: the summary repeats the reply above it — show a compact footer, not the answer twice. */
  val echo: Boolean = false,
  /** file / image: where it lives on the PC (fetch it with fetch_file). */
  val path: String? = null,
  /** file / image: a small JPEG preview, base64 — shown inline straight away. */
  val thumb: String? = null,
  /** user: files sent with the message. */
  val attachments: List<AttachmentMeta> = emptyList(),
)

data class AttachmentMeta(val name: String, val mime: String, val size: Long)

data class EngineModel(val id: String, val label: String)

data class Engine(val id: String, val name: String, val models: List<EngineModel>)

/** A name that fits a three-way button on a phone: "Claude", "Codex", "Browser". */
val Engine.shortName: String
  get() = when (id) {
    "claude-code" -> "Claude"
    "browsercode" -> "Browser"
    else -> name.substringBefore(' ')
  }

data class Device(
  val id: String,
  val kind: String,
  val name: String,
  val platform: String?,
  val online: Boolean,
  val lastSeenMs: Long,
  val engines: List<Engine>,
  /** The desktop's agent-approval policy: ask | auto | full. */
  val approvalMode: String? = null,
) {
  /** The desktop heartbeats every minute; three missed beats means gone. */
  val isReachable: Boolean
    get() = online && System.currentTimeMillis() - lastSeenMs < 3 * 60_000
}

enum class CommandType(val id: String) {
  NewTask("new_task"),
  FollowUp("follow_up"),
  Pause("pause"),
  Resume("resume"),
  Stop("stop"),
  AnswerConfirmation("answer_confirmation"),
  SyncSession("sync_session"),
  SetApprovalMode("set_approval_mode"),
  FetchFile("fetch_file"),
  React("react"),
}

/**
 * "Your DEX" — the bot that represents you on the phone and the PC
 * (desktop/app/src/main/profile.ts is the desktop side). Lives at
 * users/{uid}.profile; the newer updatedAt wins.
 */
data class DexProfile(
  val bot: String,
  /** #RRGGBB, or null for the bot's own colour. */
  val color: String?,
  val name: String?,
  val updatedAt: Long,
)

sealed interface CommandState {
  data object Pending : CommandState
  data object Running : CommandState
  data class Done(val result: Map<String, Any?>) : CommandState
  data class Failed(val error: String) : CommandState
}

/**
 * A .blend made viewable on the phone (DexRepository.fetchScene): the PC's
 * render, the scene as a GLB, the HDRI sky, and the camera to start from.
 */
data class SceneFiles(
  val dir: java.io.File,
  val render: java.io.File?,
  val glb: java.io.File?,
  val sky: java.io.File?,
  /** <model-viewer> camera: orbit, target, fov. */
  val view: Map<String, String>,
) {
  companion object {
    fun fileFor(part: String): String = when (part) {
      "render" -> "render.jpg"
      "sky" -> "sky.jpg"
      else -> "scene.glb"
    }

    /** What's already on the phone, or null if the scene isn't (fully) here. */
    fun from(dir: java.io.File): SceneFiles? {
      val viewFile = java.io.File(dir, "view.json")
      if (!viewFile.isFile) return null
      fun part(name: String) = java.io.File(dir, name).takeIf { it.isFile && it.length() > 0 }
      val render = part("render.jpg")
      val glb = part("scene.glb")
      if (render == null && glb == null) return null
      val json = runCatching { org.json.JSONObject(viewFile.readText()) }.getOrNull() ?: return null
      val view = json.keys().asSequence().associateWith { json.optString(it) }
      return SceneFiles(dir, render, glb, part("sky.jpg"), view)
    }
  }
}
