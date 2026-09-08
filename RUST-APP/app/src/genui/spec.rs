//! The Generative UI wire format.
//!
//! The planner emits a tree of these; the renderer draws it with the same
//! vendored components the rest of the app uses. Nothing here is a new
//! component — that is the point. A node type that does not map to something
//! DEX already draws would be a second design system.
//!
//! The authority for the schema is `core/genui/schema.ts`. Keep them together.

use serde::{Deserialize, Serialize};

/// Depth beyond which a tree is truncated.
///
/// A model that nests forever should produce a shallow, readable card rather
/// than a stack overflow or a page that scrolls sideways off the screen.
pub const MAX_DEPTH: usize = 6;

/// Children rendered per node before the rest are dropped.
pub const MAX_CHILDREN: usize = 50;

/// One node of a generated interface.
///
/// `props` is deliberately a flat bag rather than a per-type struct: the
/// renderer reads only the keys it understands, so a planner that sends an
/// unknown prop degrades to a correct render instead of a parse failure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UiNode {
    /// The registry key. Unknown types render as their text, never blank.
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub props: Props,
    #[serde(default)]
    pub children: Vec<UiNode>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Props {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Checkbox/switch state — a shown value, not a live control. See the
    /// "Scope: display, not a live form" note in `core/genui/schema.ts`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    /// The shown value of a select, radio group, date or field — text rather
    /// than `value` (which is numeric, for slider/progress).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_text: Option<String>,
    /// Table and grid columns.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<String>,
    /// Table and grid rows, in column order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<Vec<String>>,
    /// Chart series values.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub values: Vec<f64>,
    /// Chart x-axis labels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
    /// Plain list items, and chip/badge sets.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<String>,
    /// What a confirmation is asking to do.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<String>,
}

/// What the planner attaches to a `done` event under `data.ui`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UiSpec {
    pub root: UiNode,
    /// Why structured UI was chosen. Not drawn; useful when auditing whether
    /// the restraint rules are being followed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl UiNode {
    /// Read the spec off an event's `data` bag.
    #[must_use]
    pub fn from_event(data: Option<&serde_json::Value>) -> Option<Self> {
        let ui = data?.get("ui")?;
        // Accept either a bare node or the full `{root, reason}` envelope, so
        // a planner that omits the wrapper still renders.
        serde_json::from_value::<UiSpec>(ui.clone())
            .map(|spec| spec.root)
            .or_else(|_| serde_json::from_value::<Self>(ui.clone()))
            .ok()
    }

    /// The node's text, for the fallback path and for accessibility.
    #[must_use]
    pub fn any_text(&self) -> String {
        self.props
            .text
            .clone()
            .or_else(|| self.props.title.clone())
            .or_else(|| self.props.description.clone())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_full_envelope() {
        let data = json!({
            "ui": { "root": { "type": "text", "props": { "text": "1,000" } } }
        });
        let node = UiNode::from_event(Some(&data)).expect("a node");
        assert_eq!(node.node_type, "text");
        assert_eq!(node.any_text(), "1,000");
    }

    #[test]
    fn also_reads_a_bare_node() {
        let data = json!({ "ui": { "type": "text", "props": { "text": "hi" } } });
        assert!(UiNode::from_event(Some(&data)).is_some());
    }

    #[test]
    fn an_unknown_prop_does_not_break_parsing() {
        let data = json!({
            "ui": { "type": "card", "props": { "title": "T", "somethingNew": 42 } }
        });
        let node = UiNode::from_event(Some(&data)).expect("a node");
        assert_eq!(node.props.title.as_deref(), Some("T"));
    }

    #[test]
    fn no_ui_key_is_no_spec() {
        assert!(UiNode::from_event(Some(&json!({ "artifact": {} }))).is_none());
        assert!(UiNode::from_event(None).is_none());
    }
}
