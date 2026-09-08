//! The live connection to the Dex core.
//!
//! One socket, one core. The Flutter client keeps this in a static singleton
//! and justifies it on the grounds that a second connection would be a bug
//! rather than a configuration; here it is a Leptos context, which says the
//! same thing without the global.

use dex_protocol::{ConnectionState, DexFrame, Inbound, Outbound};
use leptos::prelude::*;
use serde_json::Value;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{CloseEvent, MessageEvent, WebSocket};

use super::handshake::{self, HandshakeError};

/// Reconnect backoff, matching the Flutter client: start at 500ms, double,
/// clamp at 8s. Long enough not to hammer a core that is still starting,
/// short enough that a restart feels immediate.
const BACKOFF_MIN_MS: u32 = 500;
const BACKOFF_MAX_MS: u32 = 8_000;

/// Everything the UI needs to know about the connection, and the one way to
/// send on it.
#[derive(Clone, Copy)]
pub struct Gateway {
    pub state: RwSignal<ConnectionState>,
    /// The last connection error worth showing, if any.
    pub error: RwSignal<Option<String>>,
    pub full_access: RwSignal<bool>,
    /// Bumped for every frame that belongs to the conversation stream. The
    /// store subscribes to this rather than to the socket.
    pub frame: RwSignal<Option<DexFrame>>,
    /// `WebSocket` is a `JsValue`, so it is neither `Send` nor `Sync`. In a
    /// single-threaded wasm build that is a formality, and `new_local` is how
    /// Leptos says so.
    /// Payloads from the request/response half of the protocol. These are not
    /// part of the conversation stream, so they stay out of the reducer and
    /// are read straight by the screens that need them.
    pub conversations: RwSignal<Vec<Value>>,
    pub reminders: RwSignal<Vec<Value>>,
    pub settings: RwSignal<Option<Value>>,
    pub health: RwSignal<Vec<Value>>,
    pub workflows: RwSignal<Vec<Value>>,
    pub history: RwSignal<Vec<Value>>,
    pub stats: RwSignal<Option<Value>>,
    /// `(name, text)` of the log last fetched.
    pub log: RwSignal<Option<(String, String)>>,
    /// A one-shot notice from the core worth showing the owner.
    pub notice: RwSignal<Option<String>>,
    /// Path of the last screenshot the core captured.
    pub captured: RwSignal<Option<String>>,
    socket: StoredValue<Option<WebSocket>, LocalStorage>,
    backoff: StoredValue<u32>,
}

impl Gateway {
    /// Build the client and start connecting. Safe to call once, at app start.
    #[must_use]
    pub fn start() -> Self {
        let gateway = Self {
            state: RwSignal::new(ConnectionState::Connecting),
            error: RwSignal::new(None),
            full_access: RwSignal::new(false),
            frame: RwSignal::new(None),
            conversations: RwSignal::new(Vec::new()),
            reminders: RwSignal::new(Vec::new()),
            settings: RwSignal::new(None),
            health: RwSignal::new(Vec::new()),
            workflows: RwSignal::new(Vec::new()),
            history: RwSignal::new(Vec::new()),
            stats: RwSignal::new(None),
            log: RwSignal::new(None),
            notice: RwSignal::new(None),
            captured: RwSignal::new(None),
            socket: StoredValue::new_local(None),
            backoff: StoredValue::new(BACKOFF_MIN_MS),
        };
        gateway.connect();
        gateway
    }

    /// Send a message. Silently drops when the socket is not open — every
    /// caller would otherwise have to check, and there is nothing useful to do
    /// about it at the call site.
    pub fn send(&self, message: &Inbound) {
        let Ok(text) = serde_json::to_string(message) else {
            log::error!("could not serialise an outbound message");
            return;
        };
        self.socket.with_value(|held| {
            if let Some(socket) = held.as_ref()
                && socket.ready_state() == WebSocket::OPEN
            {
                let _ = socket.send_with_str(&text);
            }
        });
    }

    /// Reconnect now, ignoring any pending backoff. This is the Retry button.
    pub fn reconnect_now(&self) {
        self.backoff.set_value(BACKOFF_MIN_MS);
        self.connect();
    }

    fn connect(&self) {
        let this = *self;
        this.state.set(ConnectionState::Connecting);

        leptos::task::spawn_local(async move {
            let handshake = match handshake::read().await {
                Ok(hs) => hs,
                Err(err) => {
                    // No core is an ordinary state with its own banner, not an
                    // error to shout about.
                    this.state.set(match err {
                        HandshakeError::NoCore => ConnectionState::NoCore,
                        HandshakeError::Unreadable(_) => ConnectionState::Disconnected,
                    });
                    this.error.set(Some(err.to_string()));
                    this.schedule_retry();
                    return;
                }
            };

            let url = format!("ws://127.0.0.1:{}", handshake.port);
            let Ok(socket) = WebSocket::new(&url) else {
                this.state.set(ConnectionState::NoCore);
                this.error
                    .set(Some(format!("could not reach the core on port {}", handshake.port)));
                this.schedule_retry();
                return;
            };

            this.wire_handlers(&socket, handshake.token);
            this.socket.set_value(Some(socket));
        });
    }

    fn wire_handlers(&self, socket: &WebSocket, token: String) {
        let this = *self;

        // The core closes an unauthenticated socket after AUTH_GRACE_MS, so
        // auth is the very first thing sent on open.
        let on_open = Closure::<dyn FnMut()>::new({
            let this = this;
            let token = token.clone();
            move || {
                this.send(&Inbound::Auth {
                    token: token.clone(),
                });
            }
        });
        socket.set_onopen(Some(on_open.as_ref().unchecked_ref()));
        on_open.forget();

        let on_message = Closure::<dyn FnMut(MessageEvent)>::new(move |ev: MessageEvent| {
            let Some(text) = ev.data().as_string() else {
                return;
            };
            this.handle_message(&text);
        });
        socket.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
        on_message.forget();

        let on_close = Closure::<dyn FnMut(CloseEvent)>::new(move |ev: CloseEvent| {
            // 4401/4403 mean the token was wrong or too late. Retrying with a
            // freshly read handshake is the right response: the usual cause is
            // a core that restarted and rotated its token.
            if matches!(ev.code(), 4401 | 4403) {
                this.error.set(Some(ev.reason()));
            }
            this.state.set(ConnectionState::Disconnected);
            this.schedule_retry();
        });
        socket.set_onclose(Some(on_close.as_ref().unchecked_ref()));
        on_close.forget();

        let on_error = Closure::<dyn FnMut(web_sys::Event)>::new(move |_| {
            this.state.set(ConnectionState::Disconnected);
        });
        socket.set_onerror(Some(on_error.as_ref().unchecked_ref()));
        on_error.forget();
    }

    fn handle_message(&self, text: &str) {
        let Ok(message) = serde_json::from_str::<Outbound>(text) else {
            log::debug!("ignoring an unparseable frame");
            return;
        };

        match &message {
            Outbound::Ready { full_access, .. } => {
                self.state.set(ConnectionState::Connected);
                self.error.set(None);
                self.full_access.set(*full_access);
                self.backoff.set_value(BACKOFF_MIN_MS);
                // The Flutter client asks for status the moment it is ready,
                // so the first paint has real values rather than defaults.
                self.send(&Inbound::GetStatus);
                // And for the things every screen needs, so opening a modal
                // does not start with an empty pane.
                self.send(&Inbound::GetConversations { query: None });
                self.send(&Inbound::GetReminders);
                self.send(&Inbound::GetSettings);
                self.send(&Inbound::GetHealth);
            }
            Outbound::Status { full_access, .. } => self.full_access.set(*full_access),
            Outbound::Conversations { conversations } => {
                self.conversations.set(conversations.clone());
            }
            Outbound::Reminders { reminders } => self.reminders.set(reminders.clone()),
            Outbound::Settings { settings } => self.settings.set(Some(settings.clone())),
            Outbound::Health { capabilities } => self.health.set(capabilities.clone()),
            Outbound::Workflows { workflows } => self.workflows.set(workflows.clone()),
            Outbound::History { tasks } => self.history.set(tasks.clone()),
            Outbound::Stats { stats } => self.stats.set(Some(stats.clone())),
            Outbound::Log { name, text } => self.log.set(Some((name.clone(), text.clone()))),
            Outbound::CaptureScreenResult { ok, path, message } => {
                if *ok {
                    self.captured.set(path.clone());
                } else if let Some(message) = message {
                    self.notice.set(Some(message.clone()));
                }
            }
            Outbound::FullAccessResult { enabled, message, .. } => {
                self.full_access.set(*enabled);
                if let Some(message) = message {
                    self.notice.set(Some(message.clone()));
                }
                self.send(&Inbound::GetStatus);
            }
            _ => {}
        }

        if let Some(frame) = DexFrame::from_outbound(&message) {
            self.frame.set(Some(frame));
        }
    }

    fn schedule_retry(&self) {
        let this = *self;
        let delay = self.backoff.get_value();
        self.backoff.set_value((delay * 2).min(BACKOFF_MAX_MS));

        leptos::task::spawn_local(async move {
            gloo_timers_sleep(delay).await;
            this.connect();
        });
    }
}

/// A promise that resolves after `ms`, without taking a dependency on
/// gloo-timers for one call.
async fn gloo_timers_sleep(ms: u32) {
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        if let Some(window) = web_sys::window() {
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                &resolve,
                i32::try_from(ms).unwrap_or(i32::MAX),
            );
        }
    });
    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
}
