//! Serde mirror of the DEX core WebSocket protocol.
//!
//! The authority is `core/server/ws_server.ts` (the `Inbound` union and the
//! broadcast shapes) and `core/events/types.ts`. Field names here must match
//! the TypeScript exactly — the core does no key translation, so a rename on
//! either side is a silent breakage.
//!
//! This crate deliberately depends on nothing but serde: it is shared by the
//! Leptos UI and the Tauri shell, and neither should have to agree on a
//! frontend framework to agree on the wire.

pub mod event;
pub mod inbound;
pub mod outbound;

pub use event::{
    Artifact, ArtifactItem, ConfirmationRequest, ConfirmationVerdict, DexEvent, EventType,
    ExecutionPlan, ExecutionStep, TaskStatus, VerificationResult, VerificationStatus,
};
pub use inbound::{Attachment, AttachmentKind, FeedbackVerdict, Inbound};
pub use outbound::{ConnectionState, DexFrame, DexFrameKind, GatewayResult, Handshake, Outbound};

/// The port the core listens on when `DEX_UI_PORT` is unset.
pub const DEFAULT_PORT: u16 = 8770;

/// The core closes an unauthenticated socket after this long.
/// `AUTH_GRACE_MS` in `core/server/ws_server.ts`.
pub const AUTH_GRACE_MS: u64 = 3_000;
