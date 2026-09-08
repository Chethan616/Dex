//! Finding the core's port and token.
//!
//! The core writes `%LOCALAPPDATA%\DEX\ui.json` (mode 0600) when it starts
//! listening. A WebView cannot read that file, so the Tauri shell — which is
//! native code — reads it and exposes it as the `dex_handshake` command.
//!
//! There is deliberately no HTTP fallback. `extension/src/panel/panel.js`
//! fetches `http://127.0.0.1:8766/handshake`, but **the browser agent never
//! implements that route** — its only extension surface is a stub WebSocket at
//! `/extension`. Reaching for it would fail at runtime and look like the core
//! being down. For browser-based development, where there is no Tauri bridge,
//! `?port=&token=` on the URL stands in; nothing else does.

use dex_protocol::{DEFAULT_PORT, Handshake};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandshakeError {
    /// Nothing to connect to. The core is not running — distinct from a
    /// malformed handshake, because the UI says something different for each.
    NoCore,
    Unreadable(String),
}

impl std::fmt::Display for HandshakeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoCore => f.write_str("the Dex core is not running"),
            Self::Unreadable(why) => write!(f, "the handshake is unreadable: {why}"),
        }
    }
}

/// `window.__TAURI__`, or `None` in a plain browser.
fn tauri_global() -> Option<JsValue> {
    let window = web_sys::window()?;
    let tauri = js_sys::Reflect::get(&window, &JsValue::from_str("__TAURI__")).ok()?;
    (!tauri.is_undefined() && !tauri.is_null()).then_some(tauri)
}

/// True when the UI is running inside the Tauri shell rather than a browser.
#[must_use]
pub fn in_tauri() -> bool {
    tauri_global().is_some()
}

/// Ask the shell where the core is and how to prove we may talk to it.
pub async fn read() -> Result<Handshake, HandshakeError> {
    if in_tauri() {
        return from_tauri().await;
    }
    from_url_params()
}

/// `invoke('dex_handshake')` through the Tauri IPC bridge.
async fn from_tauri() -> Result<Handshake, HandshakeError> {
    let invoke = tauri_invoke().ok_or_else(|| {
        HandshakeError::Unreadable("the Tauri bridge is missing its invoke function".to_owned())
    })?;

    let promise = invoke
        .call2(
            &JsValue::NULL,
            &JsValue::from_str("dex_handshake"),
            &js_sys::Object::new(),
        )
        .map_err(|e| HandshakeError::Unreadable(describe(&e)))?;

    let resolved = JsFuture::from(js_sys::Promise::from(promise))
        .await
        // The shell rejects when the file is absent, which is the ordinary
        // "core has not started yet" case rather than something broken.
        .map_err(|_| HandshakeError::NoCore)?;

    from_js(&resolved)
}

/// Development escape hatch: `trunk serve` has no Tauri bridge and no way to
/// read the handshake file, so the developer passes the pair on the URL.
fn from_url_params() -> Result<Handshake, HandshakeError> {
    let href = web_sys::window()
        .and_then(|w| w.location().href().ok())
        .ok_or_else(|| HandshakeError::Unreadable("no location".to_owned()))?;

    let url = web_sys::Url::new(&href)
        .map_err(|e| HandshakeError::Unreadable(describe(&e)))?;
    let params = url.search_params();

    let Some(token) = params.get("token") else {
        return Err(HandshakeError::NoCore);
    };
    let port = params
        .get("port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    Ok(Handshake {
        port,
        token,
        pid: None,
        version: None,
        started_at: None,
    })
}

/// `window.__TAURI__.core.invoke`, if the bridge is present.
fn tauri_invoke() -> Option<js_sys::Function> {
    let core = js_sys::Reflect::get(&tauri_global()?, &JsValue::from_str("core")).ok()?;
    let invoke = js_sys::Reflect::get(&core, &JsValue::from_str("invoke")).ok()?;
    invoke.dyn_into::<js_sys::Function>().ok()
}

/// Round-trip through JSON rather than pulling in serde-wasm-bindgen for one
/// struct.
fn from_js(value: &JsValue) -> Result<Handshake, HandshakeError> {
    let text = js_sys::JSON::stringify(value)
        .map(String::from)
        .map_err(|e| HandshakeError::Unreadable(describe(&e)))?;
    serde_json::from_str(&text).map_err(|e| HandshakeError::Unreadable(e.to_string()))
}

fn describe(value: &JsValue) -> String {
    value
        .as_string()
        .or_else(|| js_sys::JSON::stringify(value).ok().map(String::from))
        .unwrap_or_else(|| "unknown error".to_owned())
}

/// Open the shell's native file picker.
///
/// Returns the chosen paths, or empty when cancelled or when there is no Tauri
/// bridge — a browser cannot open one, and there is nothing useful to say
/// about that at the call site.
pub async fn pick_files() -> Vec<String> {
    let Some(invoke) = tauri_invoke() else {
        return Vec::new();
    };
    let Ok(promise) = invoke.call2(
        &JsValue::NULL,
        &JsValue::from_str("dex_pick_files"),
        &js_sys::Object::new(),
    ) else {
        return Vec::new();
    };
    let Ok(resolved) = JsFuture::from(js_sys::Promise::from(promise)).await else {
        return Vec::new();
    };
    js_sys::JSON::stringify(&resolved)
        .ok()
        .map(String::from)
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

/// Call a shell command that takes no arguments and whose result we ignore.
pub async fn shell_call(command: &str) {
    let Some(invoke) = tauri_invoke() else { return };
    if let Ok(promise) = invoke.call2(
        &JsValue::NULL,
        &JsValue::from_str(command),
        &js_sys::Object::new(),
    ) {
        let _ = JsFuture::from(js_sys::Promise::from(promise)).await;
    }
}

/// Boot progress from the supervisor.
pub async fn boot_status() -> Vec<crate::screens::BootRow> {
    let Some(invoke) = tauri_invoke() else {
        return Vec::new();
    };
    let Ok(promise) = invoke.call2(
        &JsValue::NULL,
        &JsValue::from_str("dex_boot_status"),
        &js_sys::Object::new(),
    ) else {
        return Vec::new();
    };
    let Ok(resolved) = JsFuture::from(js_sys::Promise::from(promise)).await else {
        return Vec::new();
    };
    let Some(text) = js_sys::JSON::stringify(&resolved).ok().map(String::from) else {
        return Vec::new();
    };
    let raw: Vec<ShellBootRow> = serde_json::from_str(&text).unwrap_or_default();

    // The shell reports ids and states; the labels stay on this side, so all
    // user-facing copy lives in one file.
    raw.iter()
        .filter_map(|row| {
            let step = crate::copy::BOOT_STEPS.iter().find(|s| s.id == row.id)?;
            let status = match row.status.as_str() {
                "running" => crate::screens::BootStatus::Running,
                "done" => crate::screens::BootStatus::Done,
                "failed" => crate::screens::BootStatus::Failed,
                _ => crate::screens::BootStatus::Pending,
            };
            Some(crate::screens::BootRow {
                id: step.id,
                title: step.title,
                detail: match status {
                    crate::screens::BootStatus::Done => step.done.to_owned(),
                    crate::screens::BootStatus::Failed => {
                        row.detail.clone().unwrap_or_else(|| step.running.to_owned())
                    }
                    _ => step.running.to_owned(),
                },
                status,
                optional: step.optional,
            })
        })
        .collect()
}

#[derive(serde::Deserialize, Default)]
struct ShellBootRow {
    id: String,
    status: String,
    #[serde(default)]
    detail: Option<String>,
}

/// Rebind the global hotkey in the shell. "None" unbinds.
pub async fn set_hotkey(combo: &str) {
    let Some(invoke) = tauri_invoke() else { return };
    let args = js_sys::Object::new();
    let _ = js_sys::Reflect::set(
        &args,
        &JsValue::from_str("combo"),
        &JsValue::from_str(combo),
    );
    if let Ok(promise) =
        invoke.call2(&JsValue::NULL, &JsValue::from_str("dex_set_hotkey"), &args)
    {
        let _ = JsFuture::from(js_sys::Promise::from(promise)).await;
    }
}

/// True when this window is the Spotlight overlay rather than the main one.
/// The shell opens it with `?spotlight=1`.
#[must_use]
pub fn is_spotlight() -> bool {
    web_sys::window()
        .and_then(|w| w.location().search().ok())
        .is_some_and(|search| search.contains("spotlight=1"))
}

/// Hand a prompt to the main window and close the overlay.
pub fn spotlight_submit(text: &str) {
    let Some(invoke) = tauri_invoke() else { return };
    let args = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&args, &JsValue::from_str("text"), &JsValue::from_str(text));
    let _ = invoke.call2(
        &JsValue::NULL,
        &JsValue::from_str("dex_spotlight_submit"),
        &args,
    );
}

/// Close the overlay without sending anything.
pub fn spotlight_dismiss() {
    spotlight_submit("");
}

/// Prompts arriving from the Spotlight window.
///
/// The main window subscribes once at start-up; the payload is the text the
/// owner typed, which is submitted as if it had been typed here.
pub fn on_spotlight_prompt(handler: impl Fn(String) + 'static) {
    let Some(tauri) = tauri_global() else { return };
    let Ok(event) = js_sys::Reflect::get(&tauri, &JsValue::from_str("event")) else {
        return;
    };
    let Ok(listen) = js_sys::Reflect::get(&event, &JsValue::from_str("listen")) else {
        return;
    };
    let Some(listen) = listen.dyn_ref::<js_sys::Function>() else {
        return;
    };

    let callback = Closure::<dyn Fn(JsValue)>::new(move |payload: JsValue| {
        if let Ok(text) = js_sys::Reflect::get(&payload, &JsValue::from_str("payload"))
            && let Some(text) = text.as_string()
            && !text.trim().is_empty()
        {
            handler(text);
        }
    });

    let _ = listen.call2(
        &event,
        &JsValue::from_str("dex://spotlight-prompt"),
        callback.as_ref().unchecked_ref(),
    );
    // Lives for the life of the window, which is the life of the app.
    callback.forget();
}
