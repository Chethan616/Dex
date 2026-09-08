//! Client -> core messages. Mirrors the `Inbound` union in
//! `core/server/ws_server.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use crate::event::ConfirmationVerdict;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedbackVerdict {
    Up,
    Down,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    File,
    Text,
}

/// One attached item on a `submit`.
///
/// The Flutter app collects these and then drops them: `submit` there carries
/// only `{text, conversationId}`, so an attached file never reaches the core
/// (Spotlight works around it by prefixing the text). This field is the fix.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Attachment {
    pub kind: AttachmentKind,
    pub name: String,
    /// Absolute path, when the file is already on disk (screenshots, picked files).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    /// Base64 payload, for pasted images that have no path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<String>,
    /// Inline content for `Text` attachments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Inbound {
    /// Must be sent within `AUTH_GRACE_MS` of connecting or the core closes
    /// the socket with code 4401.
    Auth {
        token: String,
    },
    Submit {
        text: String,
        #[serde(rename = "conversationId", skip_serializing_if = "Option::is_none")]
        conversation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        attachments: Vec<Attachment>,
    },
    /// Run the turn in the browser side panel, beside the page, while keeping
    /// it in this conversation thread.
    ToPanel {
        text: String,
        #[serde(rename = "conversationId", skip_serializing_if = "Option::is_none")]
        conversation_id: Option<String>,
    },
    GetConversations {
        #[serde(skip_serializing_if = "Option::is_none")]
        query: Option<String>,
    },
    OpenConversation {
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    RenameConversation {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        name: String,
    },
    DeleteConversation {
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    /// `step_version` must be the value from the `ConfirmationRequest`, echoed
    /// verbatim. The core refuses a stale one.
    Respond {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "stepId")]
        step_id: String,
        #[serde(rename = "stepVersion")]
        step_version: String,
        verdict: ConfirmationVerdict,
    },
    Cancel {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    ClearPreapprovals,
    FullAccess {
        enabled: bool,
    },
    GetStatus,
    GetEvidence {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    GetWorkflows,
    SaveWorkflow {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    DeleteWorkflow {
        name: String,
    },
    RenameWorkflow {
        from: String,
        to: String,
    },
    GetSchedules,
    GetReminders,
    GetChannels,
    SetChannel {
        channel: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        token: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        owner: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        enabled: Option<bool>,
    },
    TestChannel {
        channel: String,
    },
    TestAccount {
        account: String,
    },
    SetAccount {
        account: String,
        #[serde(rename = "clientId", skip_serializing_if = "Option::is_none")]
        client_id: Option<String>,
        #[serde(rename = "clientSecret", skip_serializing_if = "Option::is_none")]
        client_secret: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        email: Option<String>,
    },
    GetAccounts,
    OpenBrowserProfile {
        #[serde(skip_serializing_if = "Option::is_none")]
        browser: Option<String>,
    },
    GetBrowserProfiles,
    SetReminder {
        text: String,
        /// Epoch milliseconds.
        at: f64,
    },
    SnoozeReminder {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        minutes: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        at: Option<f64>,
    },
    CompleteReminder {
        name: String,
    },
    DeleteReminder {
        name: String,
    },
    SaveSchedule {
        name: String,
        when: String,
        request: String,
    },
    SetScheduleEnabled {
        name: String,
        enabled: bool,
    },
    DeleteSchedule {
        name: String,
    },
    GetHistory {
        #[serde(skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
    },
    GetStats {
        #[serde(skip_serializing_if = "Option::is_none")]
        days: Option<u32>,
    },
    GetSettings,
    SetCredential {
        name: String,
        value: String,
    },
    DeleteCredential {
        name: String,
    },
    SetEnv {
        changes: BTreeMap<String, Option<String>>,
    },
    TestProvider {
        provider: String,
    },
    SetBrain {
        provider: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    SetConfig {
        changes: BTreeMap<String, Value>,
    },
    ClaudeSignin,
    GetHealth,
    GetLog {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        lines: Option<u32>,
    },
    CaptureScreen,
    Feedback {
        #[serde(rename = "requestId")]
        request_id: String,
        verdict: FeedbackVerdict,
    },
    Ping,
}

impl Inbound {
    /// Convenience for the common case: a plain prompt with no attachments.
    #[must_use]
    pub fn submit(text: impl Into<String>, conversation_id: Option<String>) -> Self {
        Self::Submit {
            text: text.into(),
            conversation_id,
            from: None,
            attachments: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The core does no key translation. These strings are the contract.
    #[test]
    fn submit_matches_the_wire() {
        let json =
            serde_json::to_string(&Inbound::submit("hi", Some("c1".into()))).unwrap_or_default();
        assert!(json.contains("\"type\":\"submit\""), "{json}");
        assert!(json.contains("\"conversationId\":\"c1\""), "{json}");
        // Absent, not null, when there is nothing attached.
        assert!(!json.contains("attachments"), "{json}");
    }

    #[test]
    fn respond_carries_step_version_verbatim() {
        let json = serde_json::to_string(&Inbound::Respond {
            request_id: "r1".into(),
            step_id: "step_1".into(),
            step_version: "abc123".into(),
            verdict: ConfirmationVerdict::ApprovedSession,
        })
        .unwrap_or_default();
        assert!(json.contains("\"stepVersion\":\"abc123\""), "{json}");
        assert!(json.contains("\"verdict\":\"approved_session\""), "{json}");
    }

    #[test]
    fn unit_variants_serialise_as_bare_type() {
        let json = serde_json::to_string(&Inbound::GetStatus).unwrap_or_default();
        assert_eq!(json, "{\"type\":\"get_status\"}");
    }
}
