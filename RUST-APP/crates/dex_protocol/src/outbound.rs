//! Core -> client messages, and the internal frame the store reduces over.
//!
//! Every outbound message is a bare JSON object with a top-level `type`.
//! There is no envelope and no request-id correlation except where a field
//! carries one explicitly.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::event::{ConfirmationRequest, DexEvent};

/// `%LOCALAPPDATA%\DEX\ui.json`, written by the core on `listening`, mode 0600.
/// Read this to find the port and token; there is no discovery protocol.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Handshake {
    pub port: u16,
    pub token: String,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(rename = "startedAt", default)]
    pub started_at: Option<f64>,
}

/// What a `result` frame spreads. From `GatewayResult` in `core/gateway.ts`.
///
/// `answer` is preferred over `summary` when present: `answer` is the reply to
/// a question, `summary` is a description of work done.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayResult {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(rename = "requestId", default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(rename = "needsClarification", default)]
    pub needs_clarification: Option<bool>,
    /// A Generative UI spec, when the planner decided structure helps.
    /// Absent for the ordinary case, which is plain text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<Value>,
}

impl GatewayResult {
    /// The line to show the user. `answer` wins; the Flutter client does the
    /// same and the difference is user-visible.
    #[must_use]
    pub fn display_text(&self) -> Option<&str> {
        self.answer
            .as_deref()
            .or(self.summary.as_deref())
            .filter(|s| !s.is_empty())
    }
}

/// Core -> client. Only the variants the UI acts on are typed; everything else
/// lands in `Other` so an unknown message is inert rather than fatal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Outbound {
    /// Sent on successful auth. The connection is live from here.
    Ready {
        #[serde(rename = "fullAccess", default)]
        full_access: bool,
        #[serde(default)]
        pending: Option<Value>,
    },
    Pong {
        #[serde(default)]
        at: Option<f64>,
    },
    Status {
        #[serde(rename = "fullAccess", default)]
        full_access: bool,
        #[serde(rename = "daemonService", default)]
        daemon_service: Option<Value>,
        #[serde(default)]
        pending: Option<Value>,
        #[serde(rename = "preApprovals", default)]
        pre_approvals: Option<Value>,
    },
    /// The streaming channel. Everything about task progress arrives here.
    Event {
        event: DexEvent,
    },
    Confirmation {
        request: ConfirmationRequest,
    },
    ConfirmationClosed {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "stepId", default)]
        step_id: Option<String>,
    },
    /// Closes a turn. Flattened because the core spreads `GatewayResult`
    /// directly into the message rather than nesting it.
    Result {
        #[serde(flatten)]
        result: GatewayResult,
    },
    Error {
        #[serde(default)]
        message: String,
    },
    Conversations {
        #[serde(default)]
        conversations: Vec<Value>,
    },
    Conversation {
        #[serde(rename = "conversationId", default)]
        conversation_id: Option<String>,
        #[serde(default)]
        messages: Vec<Value>,
    },
    ConversationDeleted {
        #[serde(rename = "conversationId", default)]
        conversation_id: Option<String>,
    },
    Reminders {
        #[serde(default)]
        reminders: Vec<Value>,
    },
    Settings {
        #[serde(default)]
        settings: Value,
    },
    Health {
        #[serde(default)]
        capabilities: Vec<Value>,
    },
    Log {
        #[serde(default)]
        name: String,
        #[serde(default)]
        text: String,
    },
    History {
        #[serde(default)]
        tasks: Vec<Value>,
    },
    Stats {
        #[serde(default)]
        stats: Value,
    },
    Workflows {
        #[serde(default)]
        workflows: Vec<Value>,
    },
    CaptureScreenResult {
        #[serde(default)]
        ok: bool,
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        message: Option<String>,
    },
    FullAccessResult {
        #[serde(default)]
        ok: bool,
        #[serde(default)]
        enabled: bool,
        #[serde(default)]
        message: Option<String>,
    },
    /// An addressed push telling the browser panel to run a prompt.
    Panel {
        #[serde(default)]
        action: Option<String>,
        #[serde(default)]
        text: Option<String>,
        #[serde(rename = "conversationId", default)]
        conversation_id: Option<String>,
    },
    /// Anything the UI does not act on. Keeps an unrecognised message inert.
    #[serde(other)]
    Other,
}

/// How the socket itself is doing, independent of any task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    /// Reached the machine but nothing is listening: the core is not running.
    NoCore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DexFrameKind {
    Step,
    Confirmation,
    ConfirmationClosed,
    Result,
    Error,
}

/// The normalised envelope the conversation store reduces over.
///
/// Collapsing the outbound union into this shape is what makes the reducer a
/// pure function of frames, and therefore testable without a socket.
#[derive(Debug, Clone, PartialEq)]
pub struct DexFrame {
    pub kind: DexFrameKind,
    pub message: String,
    pub request_id: Option<String>,
    pub step_id: Option<String>,
    pub event: Option<DexEvent>,
    pub confirmation: Option<ConfirmationRequest>,
    pub result: Option<GatewayResult>,
}

impl DexFrame {
    /// Normalise an outbound message, or `None` if it is not part of the
    /// conversation stream.
    #[must_use]
    pub fn from_outbound(out: &Outbound) -> Option<Self> {
        match out {
            Outbound::Event { event } => Some(Self {
                kind: DexFrameKind::Step,
                message: event.message.clone(),
                request_id: Some(event.request_id.clone()),
                step_id: event.step_id.clone(),
                event: Some(event.clone()),
                confirmation: None,
                result: None,
            }),
            Outbound::Confirmation { request } => Some(Self {
                kind: DexFrameKind::Confirmation,
                message: request.description.clone(),
                request_id: Some(request.request_id.clone()),
                step_id: Some(request.step_id.clone()),
                event: None,
                confirmation: Some(request.clone()),
                result: None,
            }),
            Outbound::ConfirmationClosed {
                request_id,
                step_id,
            } => Some(Self {
                kind: DexFrameKind::ConfirmationClosed,
                message: String::new(),
                request_id: Some(request_id.clone()),
                step_id: step_id.clone(),
                event: None,
                confirmation: None,
                result: None,
            }),
            Outbound::Result { result } => Some(Self {
                kind: DexFrameKind::Result,
                message: result.display_text().unwrap_or_default().to_owned(),
                request_id: result.request_id.clone(),
                step_id: None,
                event: None,
                confirmation: None,
                result: Some(result.clone()),
            }),
            Outbound::Error { message } => Some(Self {
                kind: DexFrameKind::Error,
                message: message.clone(),
                request_id: None,
                step_id: None,
                event: None,
                confirmation: None,
                result: None,
            }),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::EventType;

    #[test]
    fn parses_a_step_event() {
        let raw = r#"{"type":"event","event":{"type":"executing","message":"working",
            "requestId":"r1","stepId":"step_1","timestamp":1.0,
            "data":{"agent":"shell"}}}"#;
        let out: Outbound = serde_json::from_str(raw).unwrap_or(Outbound::Other);
        let Outbound::Event { ref event } = out else {
            panic!("expected an event, got {out:?}");
        };
        assert_eq!(event.event_type, EventType::Executing);
        assert_eq!(event.step_id.as_deref(), Some("step_1"));
        assert_eq!(event.agent().as_deref(), Some("shell"));
    }

    #[test]
    fn result_prefers_answer_over_summary() {
        let raw = r#"{"type":"result","status":"ANSWERED","summary":"did a thing",
            "answer":"1,000","requestId":"r1"}"#;
        let out: Outbound = serde_json::from_str(raw).unwrap_or(Outbound::Other);
        let Outbound::Result { ref result } = out else {
            panic!("expected a result, got {out:?}");
        };
        assert_eq!(result.display_text(), Some("1,000"));
    }

    /// An unknown message must be inert, never an error.
    #[test]
    fn unknown_type_falls_through() {
        let out: Outbound =
            serde_json::from_str(r#"{"type":"something_new","x":1}"#).unwrap_or(Outbound::Ready {
                full_access: false,
                pending: None,
            });
        assert_eq!(out, Outbound::Other);
        assert!(DexFrame::from_outbound(&out).is_none());
    }

    #[test]
    fn handshake_reads_the_core_file() {
        let hs: Option<Handshake> = serde_json::from_str(
            r#"{"port":8770,"token":"deadbeef","pid":123,"version":"0.1.0","startedAt":1.0}"#,
        )
        .ok();
        let Some(hs) = hs else {
            panic!("handshake should parse");
        };
        assert_eq!(hs.port, 8770);
        assert_eq!(hs.token, "deadbeef");
    }
}
