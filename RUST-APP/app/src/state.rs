//! The Leptos layer over the pure reducer.
//!
//! `dex_store::Store` holds the truth and is tested on its own. This wraps it
//! in a signal and feeds it frames off the socket. Nothing here decides
//! anything: if behaviour needs changing, it changes in the reducer, where
//! there is a test for it.

use dex_protocol::{Attachment, ConfirmationVerdict, DexFrame, FeedbackVerdict, Inbound};
use dex_store::{ActionPreview, AgentState, Message, PlanStep, Store, ToolActivity};
use leptos::prelude::*;
use wasm_bindgen::JsCast;

use crate::gateway::Gateway;

/// Which full-screen surface is showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Splash,
    Home,
}

/// Which modal is open, if any. The Flutter client uses `showGeneralDialog`
/// for each of these; here they are one signal so only one can be open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Modal {
    None,
    Settings(String),
    Reminders,
    ModelPicker,
    Help,
    Voice,
}

#[derive(Clone, Copy)]
pub struct AppState {
    pub gateway: Gateway,
    store: RwSignal<Store>,
    /// Bumped on every mutation so views relying on the store re-run. The
    /// store is not itself reactive, so this is the subscription point.
    version: RwSignal<u64>,
    pub screen: RwSignal<Screen>,
    pub modal: RwSignal<Modal>,
    pub sidebar_expanded: RwSignal<bool>,
    pub tagline: RwSignal<&'static str>,
    /// Transient in-app notice. The Flutter client uses a glass toast; this is
    /// the same idea with one slot, since two at once were never useful.
    pub toast: RwSignal<Option<String>>,
    /// Boot progress, mirrored from the Tauri supervisor.
    boot: RwSignal<Vec<crate::screens::BootRow>>,
}

impl AppState {
    /// Build the state and subscribe it to the socket.
    #[must_use]
    pub fn new(gateway: Gateway) -> Self {
        let state = Self {
            gateway,
            store: RwSignal::new(Store::new(new_conversation_id())),
            version: RwSignal::new(0),
            screen: RwSignal::new(Screen::Splash),
            modal: RwSignal::new(Modal::None),
            sidebar_expanded: RwSignal::new(true),
            // Picked once per launch, like the CLI banner, so it does not
            // flicker on every re-render.
            tagline: RwSignal::new(pick_tagline()),
            toast: RwSignal::new(None),
            boot: RwSignal::new(initial_boot_rows()),
        };

        // In a browser there is no supervisor to wait for, so the splash has
        // nothing to show and the app opens straight away.
        if crate::gateway::in_tauri() {
            state.poll_boot();
        } else {
            state.boot.set(Vec::new());
            state.screen.set(Screen::Home);
        }

        // Every frame the gateway normalises goes straight to the reducer.
        Effect::new(move |_| {
            if let Some(frame) = gateway.frame.get() {
                state.apply(&frame);
            }
        });

        state
    }

    fn apply(&self, frame: &DexFrame) {
        self.store.update_untracked(|s| s.apply(frame));
        self.version.update(|v| *v += 1);
    }

    /// Read from the store, re-running when it changes.
    pub fn with<T>(&self, f: impl FnOnce(&Store) -> T) -> T {
        self.version.track();
        self.store.with_untracked(f)
    }

    pub fn messages(&self) -> Vec<Message> {
        self.with(|s| s.messages.clone())
    }

    pub fn plan(&self) -> Vec<PlanStep> {
        self.with(|s| s.plan.clone())
    }

    /// Kept for the diagnostics surface, which reads raw step output.
    #[allow(dead_code)]
    pub fn activities(&self) -> Vec<ToolActivity> {
        self.with(|s| s.activities.clone())
    }

    pub fn agent_state(&self) -> AgentState {
        self.with(dex_store::Store::state)
    }

    pub fn is_busy(&self) -> bool {
        self.with(dex_store::Store::is_busy)
    }

    pub fn pending(&self) -> Option<ActionPreview> {
        self.with(dex_store::Store::pending)
    }

    pub fn approvals_waiting(&self) -> usize {
        self.with(dex_store::Store::approvals_waiting)
    }

    pub fn has_messages(&self) -> bool {
        self.with(|s| !s.messages.is_empty())
    }

    pub fn conversation_id(&self) -> String {
        self.with(|s| s.conversation_id.clone())
    }

    /// Send the owner's prompt.
    ///
    /// A prompt that goes nowhere looks like Dex ignoring you, so a missing
    /// core is said out loud rather than swallowed.
    pub fn submit(&self, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        if self.gateway.state.get_untracked() != dex_protocol::ConnectionState::Connected {
            self.notify(crate::copy::NOT_CONNECTED);
            return;
        }
        let message = self.store.try_update_untracked(|s| s.send_human_message(text));
        self.version.update(|v| *v += 1);
        if let Some(message) = message {
            self.gateway.send(&message);
        }
    }

    /// Send a prompt with files attached.
    ///
    /// The Flutter client cannot do this: it collects attachments and then
    /// drops them, because `submit` there carries only `{text, conversationId}`.
    /// The core now takes an `attachments` array; see the Phase 3 change to
    /// `core/server/ws_server.ts`.
    pub fn submit_with_attachments(&self, text: &str, attachments: Vec<Attachment>) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        self.store.update_untracked(|s| {
            s.send_human_message(text);
        });
        self.version.update(|v| *v += 1);
        self.gateway.send(&Inbound::Submit {
            text: text.to_owned(),
            conversation_id: Some(self.conversation_id()),
            from: None,
            attachments,
        });
    }

    /// Ask the core for a screenshot. It answers with `capture_screen_result`.
    pub fn capture_screen(&self) {
        self.gateway.send(&Inbound::CaptureScreen);
    }

    /// Parse "20m stand up" / "17:30 leave" and set it.
    pub fn set_reminder(&self, args: &str) {
        let Some((at, text)) = parse_reminder(args) else {
            self.notify("Usage: /remind 20m stand up  ·  /remind 17:30 leave for the dentist");
            return;
        };
        self.gateway.send(&Inbound::SetReminder { text, at });
        self.gateway.send(&Inbound::GetReminders);
    }

    /// Show a transient notice.
    pub fn notify(&self, message: &str) {
        self.toast.set(Some(message.to_owned()));
    }

    /// Run the turn in the browser side panel, beside the page, but keep it in
    /// this thread.
    pub fn submit_to_panel(&self, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        self.store.update_untracked(|s| {
            s.send_human_message(text);
        });
        self.version.update(|v| *v += 1);
        self.gateway.send(&Inbound::ToPanel {
            text: text.to_owned(),
            conversation_id: Some(self.conversation_id()),
        });
    }

    pub fn respond(&self, verdict: ConfirmationVerdict) {
        let message = self.store.try_update_untracked(|s| s.respond(verdict));
        self.version.update(|v| *v += 1);
        if let Some(Some(message)) = message {
            self.gateway.send(&message);
        }
    }

    pub fn respond_all(&self, verdict: ConfirmationVerdict) {
        let messages = self
            .store
            .try_update_untracked(|s| s.respond_all(verdict))
            .unwrap_or_default();
        self.version.update(|v| *v += 1);
        for message in &messages {
            self.gateway.send(message);
        }
    }

    /// Stop the running turn.
    pub fn stop(&self) {
        let active = self.with(|s| s.active_request_id.clone());
        if let Some(request_id) = active {
            self.gateway.send(&Inbound::Cancel { request_id });
            self.notify(crate::copy::STOPPING);
        }
    }

    /// Set the Claude Code model alias behind the composer's mode pill.
    pub fn set_brain_model(&self, model: &str) {
        self.gateway.send(&Inbound::SetBrain {
            provider: "claude-code".to_owned(),
            model: Some(model.to_owned()),
        });
    }

    pub fn new_conversation(&self) {
        self.store
            .update_untracked(|s| s.new_conversation(new_conversation_id()));
        self.version.update(|v| *v += 1);
    }

    /// One row of the history list, already bucketed by day.
    pub fn conversations(&self) -> Vec<ConversationRow> {
        let now = js_sys::Date::now();
        self.gateway
            .conversations
            .get()
            .iter()
            .map(|row| {
                let last_at = row.get("lastAt").and_then(serde_json::Value::as_f64).unwrap_or(now);
                ConversationRow {
                    id: row
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    title: row
                        .get("title")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("Untitled")
                        .to_owned(),
                    failed: row
                        .get("failed")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    bucket: day_bucket(now, last_at),
                }
            })
            .collect()
    }

    pub fn search_conversations(&self, query: &str) {
        self.gateway.send(&Inbound::GetConversations {
            query: (!query.is_empty()).then(|| query.to_owned()),
        });
    }

    pub fn open_conversation(&self, id: &str) {
        self.gateway.send(&Inbound::OpenConversation {
            conversation_id: id.to_owned(),
        });
    }

    pub fn feedback(&self, request_id: &str, verdict: FeedbackVerdict) {
        if request_id.is_empty() {
            return;
        }
        self.gateway.send(&Inbound::Feedback {
            request_id: request_id.to_owned(),
            verdict,
        });
    }

    pub fn boot_steps(&self) -> Vec<crate::screens::BootRow> {
        self.boot.get()
    }

    /// Ask the shell to start the stack again after a failed step.
    pub fn retry_boot(&self) {
        leptos::task::spawn_local(async move {
            crate::gateway::shell_call("dex_retry_boot").await;
        });
        self.poll_boot();
    }

    /// Poll the shell until nothing is still starting.
    ///
    /// A push channel would be tidier, but boot lasts seconds and happens
    /// once; a 250ms poll is less machinery for the same result.
    fn poll_boot(&self) {
        let boot = self.boot;
        leptos::task::spawn_local(async move {
            loop {
                let rows = crate::gateway::boot_status().await;
                let still_running = rows
                    .iter()
                    .any(|r| r.status == crate::screens::BootStatus::Running);
                let started = !rows.is_empty();
                boot.set(rows);
                if started && !still_running {
                    break;
                }
                sleep_ms(250).await;
            }
        });
    }

    /// Ask the shell to rebind the global hotkey.
    pub fn set_hotkey(&self, combo: &str) {
        let combo = combo.to_owned();
        leptos::task::spawn_local(async move {
            crate::gateway::set_hotkey(&combo).await;
        });
    }

    pub fn open(&self, modal: Modal) {
        self.modal.set(modal);
    }

    pub fn close_modal(&self) {
        self.modal.set(Modal::None);
    }
}

/// Every step pending, before the shell has said anything.
fn initial_boot_rows() -> Vec<crate::screens::BootRow> {
    crate::copy::BOOT_STEPS
        .iter()
        .map(|step| crate::screens::BootRow {
            id: step.id,
            title: step.title,
            detail: step.running.to_owned(),
            status: crate::screens::BootStatus::Pending,
            optional: step.optional,
        })
        .collect()
}

async fn sleep_ms(ms: i32) {
    let promise = js_sys::Promise::new(&mut |resolve, _| {
        if let Some(window) = web_sys::window() {
            let _ = window
                .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms);
        }
    });
    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
}

/// A history row, ready to draw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationRow {
    pub id: String,
    pub title: String,
    pub failed: bool,
    pub bucket: &'static str,
}

/// Today / Yesterday / Earlier, matching `dex_sidebar.dart:367`.
fn day_bucket(now: f64, at: f64) -> &'static str {
    const DAY_MS: f64 = 86_400_000.0;
    let age = now - at;
    if age < DAY_MS {
        crate::copy::BUCKET_TODAY
    } else if age < DAY_MS * 2.0 {
        crate::copy::BUCKET_YESTERDAY
    } else {
        crate::copy::BUCKET_EARLIER
    }
}

/// A v4-shaped id. `crypto.randomUUID` is available in every WebView this ships
/// in; the fallback keeps a dev browser without it working rather than panicking.
fn new_conversation_id() -> String {
    // `Crypto` is not among the enabled web-sys features and pulling it in for
    // one call is not worth it, so `crypto.randomUUID()` is reached through
    // Reflect. The timestamp fallback keeps a browser without it working.
    let uuid = web_sys::window().and_then(|window| {
        let crypto =
            js_sys::Reflect::get(&window, &wasm_bindgen::JsValue::from_str("crypto")).ok()?;
        let random_uuid =
            js_sys::Reflect::get(&crypto, &wasm_bindgen::JsValue::from_str("randomUUID")).ok()?;
        let function = random_uuid.dyn_ref::<js_sys::Function>()?;
        function.call0(&crypto).ok()?.as_string()
    });
    uuid.unwrap_or_else(|| format!("c-{}", js_sys::Date::now()))
}

/// The reminder grammar from `slash_commands.dart:365`: a duration
/// (`20m`, `2h`, `3d`) or a clock time (`17:30`, `5pm`), then the text.
/// Returns epoch milliseconds and what to be reminded of.
fn parse_reminder(args: &str) -> Option<(f64, String)> {
    let (when, text) = args.split_once(char::is_whitespace)?;
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let now = js_sys::Date::now();

    // Duration: 20m / 2h / 3d.
    let lower = when.to_lowercase();
    let split = lower.find(|c: char| !c.is_ascii_digit())?;
    let (digits, unit) = lower.split_at(split);
    if let Ok(value) = digits.parse::<f64>() {
        let ms = match unit {
            "m" | "min" | "mins" => value * 60_000.0,
            "h" | "hr" | "hrs" => value * 3_600_000.0,
            "d" => value * 86_400_000.0,
            _ => return parse_clock(when, text, now),
        };
        return Some((now + ms, text.to_owned()));
    }
    parse_clock(when, text, now)
}

/// `17:30`, `5pm`, `5:30pm`. Rolls to tomorrow when the time has passed.
fn parse_clock(when: &str, text: &str, now: f64) -> Option<(f64, String)> {
    let lower = when.to_lowercase();
    let (body, pm, am) = if let Some(rest) = lower.strip_suffix("pm") {
        (rest, true, false)
    } else if let Some(rest) = lower.strip_suffix("am") {
        (rest, false, true)
    } else {
        (lower.as_str(), false, false)
    };

    let (hour, minute) = match body.split_once(':') {
        Some((h, m)) => (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?),
        None => (body.parse::<u32>().ok()?, 0),
    };
    if hour > 23 || minute > 59 {
        return None;
    }

    let hour = if pm && hour < 12 {
        hour + 12
    } else if am && hour == 12 {
        0
    } else {
        hour
    };

    let target = js_sys::Date::new(&js_sys::Number::from(now));
    target.set_hours(hour);
    target.set_minutes(minute);
    target.set_seconds(0);
    let mut at = target.get_time();
    if at <= now {
        at += 86_400_000.0;
    }
    Some((at, text.to_owned()))
}

fn pick_tagline() -> &'static str {
    let taglines = crate::copy::TAGLINES;
    // `js_sys::Math::random` rather than a rand crate: this is the only place
    // randomness is needed and it is not security-relevant.
    let index = (js_sys::Math::random() * taglines.len() as f64) as usize;
    taglines.get(index).copied().unwrap_or(taglines[0])
}

/// Read the state put in context by the root component.
///
/// # Panics
/// If called outside the provider, which is a wiring bug rather than a
/// runtime condition.
#[must_use]
pub fn use_app() -> AppState {
    use_context::<AppState>().expect("AppState is provided at the root")
}
