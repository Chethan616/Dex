//! The conversation reducer and the models it produces.
//!
//! Deliberately free of Leptos and of any socket: the store is a pure function
//! of the frames it has seen, so it can be tested on the host rather than in a
//! browser. The Leptos layer wraps it; it does not reach into it.

pub mod models;
pub mod store;

pub use models::{
    ActionPreview, AgentState, EngineId, Message, MessageSpeaker, PlanStep, PlanStepStatus,
    PreviewStep, ToolActivity, ToolActivityState, ToolChipState,
};
pub use store::Store;

#[cfg(test)]
mod tests;
