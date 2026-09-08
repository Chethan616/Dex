//! The client half of the DEX WebSocket protocol.
//!
//! `handshake` finds the core; `client` keeps one socket to it and turns the
//! outbound union into the normalised frames the conversation store reduces.

pub mod client;
pub mod handshake;

pub use client::Gateway;
// `HandshakeError` is part of this module's surface even though the binary
// only ever formats it via Display.
#[allow(unused_imports)]
pub use handshake::HandshakeError;
pub use handshake::{
    boot_status, in_tauri, is_spotlight, on_spotlight_prompt, pick_files, set_hotkey, shell_call,
    spotlight_dismiss, spotlight_submit,
};
