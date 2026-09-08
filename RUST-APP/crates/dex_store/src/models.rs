//! What the chat surface draws.
//!
//! Ported from `app/lib/core/models/` in the Flutter client. The shapes are
//! kept because the reducer's behaviour is specified against them.

use dex_protocol::Artifact;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageSpeaker {
    Human,
    Agent,
    Action,
    /// An inline step chip in the transcript, not a line of prose.
    ToolChip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ToolChipState {
    Running,
    Done,
    Failed,
    Denied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentState {
    Idle,
    Thinking,
    Acting,
    Awaiting,
    Error,
}

impl AgentState {
    /// The states in which a turn is still in flight.
    #[must_use]
    pub const fn is_busy(self) -> bool {
        matches!(self, Self::Thinking | Self::Acting | Self::Awaiting)
    }

    /// The word shown beside the state glyph. From `theme/tokens.dart:349`.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Thinking => "thinking",
            Self::Acting => "acting",
            Self::Awaiting => "awaiting",
            Self::Error => "error",
        }
    }

    /// From `theme/tokens.dart:339`.
    #[must_use]
    pub const fn glyph(self) -> &'static str {
        match self {
            Self::Idle => "\u{25CB}",
            Self::Thinking => "\u{29FF}",
            Self::Acting => "\u{25CF}",
            Self::Awaiting => "\u{25B2}",
            Self::Error => "\u{2715}",
        }
    }
}

/// Which execution backend a step went to. Drawn as the engine pill.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineId {
    Shell,
    UfoUia,
    BrowserUse,
    Omniparser,
}

impl EngineId {
    /// Capability to engine, from `conversation_store.dart:759`.
    #[must_use]
    pub fn from_capability(capability: &str) -> Option<Self> {
        match capability {
            "can_control_os" | "can_control_files" | "can_deliver" => Some(Self::Shell),
            "can_control_app" => Some(Self::UfoUia),
            "can_browse_web" => Some(Self::BrowserUse),
            "can_control_gui" => Some(Self::Omniparser),
            _ => None,
        }
    }

    /// From `models/engine.dart:46`.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Shell => "shell",
            Self::UfoUia => "ufo-uia",
            Self::BrowserUse => "browser-use",
            Self::Omniparser => "omniparser",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlanStepStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanStep {
    /// Human-readable, with the first couple of parameters folded in:
    /// "set volume — level 35" rather than "set_volume".
    pub label: String,
    pub status: PlanStepStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolActivityState {
    Running,
    Done,
    Failed,
    Aborted,
}

/// One step's life, from selection to outcome.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolActivity {
    /// `"{request_id}:{step_id}"`. Step ids restart at `step_1` for every
    /// request, so the bare id is not unique and keying on it made a new
    /// task's first step rewrite the previous task's first card.
    pub call_id: String,
    pub tool_id: String,
    pub display_name: String,
    pub engine: Option<EngineId>,
    /// Progress lines from dispatching/executing/retrying events.
    pub output_lines: Vec<String>,
    /// The closing sentence. This is the evidence the owner reads, so it is
    /// the agent's own words rather than "done".
    pub summary: Option<String>,
    pub ok: Option<bool>,
    pub state: ToolActivityState,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub id: String,
    pub speaker: MessageSpeaker,
    pub text: String,
    /// Epoch milliseconds.
    pub ts: f64,
    pub request_id: Option<String>,
    /// Links a `ToolChip` message to its `ToolActivity`.
    pub call_id: Option<String>,
    pub tool_id: Option<String>,
    pub chip_state: Option<ToolChipState>,
    pub engine: Option<EngineId>,
    pub artifact: Option<Artifact>,
    /// A Generative UI spec, unparsed. `dex_store` has no opinion about how
    /// it is drawn, which keeps this crate free of the component library.
    pub ui: Option<serde_json::Value>,
}

impl Message {
    #[must_use]
    pub fn human(text: impl Into<String>, ts: f64) -> Self {
        Self {
            id: format!("h{ts}"),
            speaker: MessageSpeaker::Human,
            text: text.into(),
            ts,
            request_id: None,
            call_id: None,
            tool_id: None,
            chip_state: None,
            engine: None,
            artifact: None,
            ui: None,
        }
    }

    #[must_use]
    pub fn agent(text: impl Into<String>, ts: f64, request_id: Option<String>) -> Self {
        Self {
            id: format!("a{ts}"),
            speaker: MessageSpeaker::Agent,
            text: text.into(),
            ts,
            request_id,
            call_id: None,
            tool_id: None,
            chip_state: None,
            engine: None,
            artifact: None,
            ui: None,
        }
    }
}

/// One line of an approval card: what will actually happen.
#[derive(Debug, Clone, PartialEq)]
pub struct PreviewStep {
    pub text: String,
}

/// The card shown while a step waits for the owner.
#[derive(Debug, Clone, PartialEq)]
pub struct ActionPreview {
    /// `"{request_id}:{step_id}"`, so the UI can tell two cards apart.
    pub id: String,
    pub title: String,
    pub steps: Vec<PreviewStep>,
    pub ts: f64,
    pub is_approval_request: bool,
}
