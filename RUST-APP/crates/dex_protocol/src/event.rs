//! Mirrors `core/events/types.ts` and `core/events/artifacts.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The streaming state machine. One of these arrives inside every
/// `{"type":"event","event":…}` frame.
///
/// There is no token-level streaming anywhere in DEX — these discrete typed
/// events are the whole progress story.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventType {
    Thinking,
    Routing,
    Planning,
    Selecting,
    Dispatching,
    Executing,
    Retrying,
    Awaiting,
    Cancelled,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DexEvent {
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub message: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "stepId", default, skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    pub timestamp: f64,
    /// Untyped by design on the core side. Carries `plan` on `planning`,
    /// `{agent, signal, previous_steps}` on agent events, and
    /// `{verification, artifact}` on terminal ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl DexEvent {
    /// The `ExecutionPlan` riding on a `planning` event, if it parses.
    #[must_use]
    pub fn plan(&self) -> Option<ExecutionPlan> {
        serde_json::from_value(self.data.clone()?).ok()
    }

    /// The `Artifact` attached to a terminal event, if any.
    #[must_use]
    pub fn artifact(&self) -> Option<Artifact> {
        let data = self.data.as_ref()?;
        serde_json::from_value(data.get("artifact")?.clone()).ok()
    }

    /// A Generative UI spec riding on this event, if the planner sent one.
    /// Carried in `data.ui`, alongside `data.artifact`, so a client that does
    /// not understand it simply ignores it.
    #[must_use]
    pub fn ui(&self) -> Option<Value> {
        self.data.as_ref()?.get("ui").cloned()
    }

    /// The agent name on a dispatch/execute event.
    #[must_use]
    pub fn agent(&self) -> Option<String> {
        self.data.as_ref()?.get("agent")?.as_str().map(str::to_owned)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExecutionStep {
    pub id: String,
    pub capability: String,
    pub action: String,
    #[serde(default)]
    pub params: serde_json::Map<String, Value>,
    #[serde(rename = "confirmationTier", default)]
    pub confirmation_tier: u8,
    #[serde(rename = "dependsOn", default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExecutionPlan {
    #[serde(rename = "requestId", default)]
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unattended: Option<bool>,
    #[serde(rename = "sessionId", default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default)]
    pub intent: String,
    #[serde(default)]
    pub tier: u8,
    #[serde(default)]
    pub steps: Vec<ExecutionStep>,
    /// Set only when `steps` is empty — a plan never both acts and replies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum VerificationStatus {
    Verified,
    Failed,
    Unverifiable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VerificationResult {
    pub status: VerificationStatus,
    #[serde(default)]
    pub reason: String,
}

/// `ANSWERED` is distinct from `COMPLETED` on purpose: nothing ran, so there is
/// nothing verified and nothing to save as a workflow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TaskStatus {
    Completed,
    Answered,
    Failed,
    Aborted,
    Cancelled,
}

impl TaskStatus {
    #[must_use]
    pub const fn is_success(self) -> bool {
        matches!(self, Self::Completed | Self::Answered)
    }
}

/// A pending Tier 1/2/3 approval.
///
/// `step_version` is a content hash of the step. It must be echoed back
/// verbatim on `respond`; the core refuses an approval built for an older
/// version of a step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfirmationRequest {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "stepId")]
    pub step_id: String,
    #[serde(rename = "stepVersion")]
    pub step_version: String,
    #[serde(default)]
    pub capability: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub params: serde_json::Map<String, Value>,
    #[serde(default)]
    pub tier: u8,
    /// Plain-language description of exactly what happens if approved.
    #[serde(default)]
    pub description: String,
    #[serde(rename = "createdAt", default)]
    pub created_at: f64,
    #[serde(rename = "expiresAt", default)]
    pub expires_at: f64,
}

/// `approved_session` is Tier 3 only; `handed_off` is Tier 1 only. The core
/// enforces both server-side rather than by hiding a button.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationVerdict {
    Approved,
    ApprovedSession,
    HandedOff,
    Rejected,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArtifactItem {
    #[serde(default)]
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default)]
    pub reasons: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<f64>,
}

/// A fixed-contract result card. Each `kind` is a contract: a set of fields the
/// UI knows how to draw. Deliberately not free-form — see the header comment in
/// `core/events/artifacts.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Artifact {
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub items: Vec<ArtifactItem>,
    #[serde(default)]
    pub total: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

impl Artifact {
    #[must_use]
    pub fn is_files(&self) -> bool {
        self.kind == "files"
    }

    #[must_use]
    pub fn is_reading(&self) -> bool {
        self.kind == "reading"
    }
}
