//! The connection banner and the transient toast.
//!
//! The banner is deliberately loud when the core is missing: without it, a
//! prompt that goes nowhere looks like Dex ignoring you.

use icons::{TriangleAlert, X};
use leptos::prelude::*;
use wasm_bindgen::JsCast;
use registry::ui::button::{Button, ButtonSize, ButtonVariant};
use registry::ui::spinner::Spinner;

use dex_protocol::ConnectionState;

use crate::copy;
use crate::state::use_app;

/// How long a toast stays. `dexToast` defaults to 2s.
const TOAST_MS: i32 = 2_000;

#[component]
pub fn ConnectionBanner() -> impl IntoView {
    let app = use_app();
    let state = app.gateway.state;
    let error = app.gateway.error;

    let copy_for = move || match state.get() {
        ConnectionState::Disconnected => Some(copy::BANNER_DISCONNECTED),
        ConnectionState::Connecting => Some(copy::BANNER_CONNECTING),
        ConnectionState::NoCore => Some(copy::BANNER_NO_CORE),
        // Connected says nothing: a permanent "ready" badge is noise.
        ConnectionState::Connected => None,
    };

    view! {
        <Show when=move || copy_for().is_some()>
            {move || {
                let (label, hint) = copy_for().unwrap_or((copy::BANNER_READY, ""));
                let connecting = state.get() == ConnectionState::Connecting;
                view! {
                    <div
                        class="flex gap-3 items-center px-6 py-2 text-sm border-b border-border bg-warning/10 text-warning-foreground"
                        role="status"
                    >
                        {if connecting {
                            view! { <Spinner class="size-4" /> }.into_any()
                        } else {
                            view! { <TriangleAlert class="size-4 text-warning" /> }.into_any()
                        }}
                        <span class="font-medium">{label}</span>
                        <span class="text-muted-foreground">
                            {move || {
                                // Only `Disconnected` shows the live reason, matching
                                // `connection_banner.dart`'s "(or err)". `NoCore` and
                                // `Connecting` always show their fixed copy — the
                                // handshake layer's own error text ("the Dex core is
                                // not running") would otherwise silently replace the
                                // ported Flutter sentence every time.
                                if state.get() == ConnectionState::Disconnected {
                                    error.get().unwrap_or_else(|| hint.to_owned())
                                } else {
                                    hint.to_owned()
                                }
                            }}
                        </span>
                        <Button
                            class="ml-auto"
                            variant=ButtonVariant::Outline
                            size=ButtonSize::Sm
                            on:click=move |_| app.gateway.reconnect_now()
                        >
                            {move || {
                                if state.get() == ConnectionState::NoCore {
                                    copy::BANNER_START_CORE
                                } else {
                                    copy::BANNER_RETRY
                                }
                            }}
                        </Button>
                    </div>
                }
            }}
        </Show>
    }
}

/// One transient notice at a time, dismissed on a timer or by hand.
#[component]
pub fn Toast() -> impl IntoView {
    let app = use_app();
    let toast = app.toast;

    // Anything the core pushes as a notice becomes a toast too.
    Effect::new(move |_| {
        if let Some(notice) = app.gateway.notice.get() {
            toast.set(Some(notice));
            app.gateway.notice.set(None);
        }
    });

    Effect::new(move |_| {
        if toast.get().is_none() {
            return;
        }
        let closure = wasm_bindgen::closure::Closure::once_into_js(move || toast.set(None));
        if let Some(window) = web_sys::window()
            && let Some(function) = closure.dyn_ref::<js_sys::Function>()
        {
            let _ = window
                .set_timeout_with_callback_and_timeout_and_arguments_0(function, TOAST_MS);
        }
    });

    view! {
        <Show when=move || toast.get().is_some()>
            <div
                class="flex fixed bottom-6 left-1/2 z-50 gap-3 items-center py-2 px-4 rounded-lg border shadow-lg -translate-x-1/2 border-border bg-popover text-popover-foreground"
                role="status"
            >
                <span class="text-sm">{move || toast.get().unwrap_or_default()}</span>
                <button
                    class="rounded-sm opacity-60 hover:opacity-100"
                    aria-label="Dismiss"
                    on:click=move |_| toast.set(None)
                >
                    <X class="size-3.5" />
                </button>
            </div>
        </Show>
    }
}
