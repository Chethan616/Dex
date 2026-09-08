//! The two full-screen surfaces: the splash, and everything after it.

use icons::{Check, TriangleAlert};
use leptos::prelude::*;
use wasm_bindgen::JsCast;
use registry::ui::button::{Button, ButtonVariant};
use registry::ui::spinner::Spinner;

use crate::copy;
use crate::state::{Screen, use_app};
use crate::widgets::approval_panel::ApprovalPanel;
use crate::widgets::banner::{ConnectionBanner, Toast};
use crate::widgets::chat::ChatView;
use crate::widgets::composer::Composer;
use crate::widgets::empty_home::EmptyHome;
use crate::widgets::modals::Modals;
use crate::widgets::sidebar::Sidebar;

/// The splash never leaves before this, so a fast boot does not flash.
const SPLASH_FLOOR_MS: i32 = 1_200;

#[component]
pub fn Root() -> impl IntoView {
    let app = use_app();

    view! {
        <div class="flex overflow-hidden flex-col h-screen bg-background text-foreground">
            <Show
                when=move || app.screen.get() == Screen::Home
                fallback=|| view! { <Splash /> }
            >
                <Home />
            </Show>
            <Toast />
        </div>
    }
}

/// Boot progress, one row per supervised process.
///
/// Leaves when the supervisor stops booting — **not** when everything is
/// ready. A degraded Dex still opens; refusing to would make an optional agent
/// being down look like the app being broken.
#[component]
fn Splash() -> impl IntoView {
    let app = use_app();
    let steps = Signal::derive(move || app.boot_steps());
    let floor_passed = RwSignal::new(false);

    Effect::new(move |prev: Option<()>| {
        if prev.is_some() {
            return;
        }
        let closure = wasm_bindgen::closure::Closure::once_into_js(move || floor_passed.set(true));
        if let Some(window) = web_sys::window()
            && let Some(function) = closure.dyn_ref::<js_sys::Function>()
        {
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                function,
                SPLASH_FLOOR_MS,
            );
        }
    });

    // Leave once the floor has passed and nothing is still starting.
    Effect::new(move |_| {
        let booting = steps.get().iter().any(|s| s.status == BootStatus::Running);
        let started = steps.get().iter().any(|s| s.status != BootStatus::Pending);
        if floor_passed.get() && started && !booting {
            app.screen.set(Screen::Home);
        }
    });

    let blocked = Signal::derive(move || {
        steps
            .get()
            .iter()
            .any(|s| s.status == BootStatus::Failed && !s.optional)
    });

    view! {
        <div class="flex flex-col justify-center items-center h-full">
            <div class="flex flex-col gap-6 w-full max-w-sm">
                <div class="flex flex-col gap-1 items-center">
                    <DexLogo />
                    <h1 class="text-xl font-semibold tracking-tight">{copy::SPLASH_TITLE}</h1>
                </div>

                <ul class="flex flex-col gap-2">
                    <For each=move || steps.get() key=|s| (s.id, s.status) let:step>
                        <li class="flex gap-3 items-center text-sm">
                            <span class="flex justify-center items-center size-4 shrink-0">
                                {match step.status {
                                    BootStatus::Done => {
                                        view! { <Check class="size-4 text-success" /> }.into_any()
                                    }
                                    BootStatus::Running => {
                                        view! { <Spinner class="size-4" /> }.into_any()
                                    }
                                    BootStatus::Failed => {
                                        view! { <TriangleAlert class="size-4 text-destructive" /> }
                                            .into_any()
                                    }
                                    BootStatus::Pending => {
                                        view! {
                                            <span class="rounded-full border size-2 border-border"></span>
                                        }
                                            .into_any()
                                    }
                                }}
                            </span>
                            <span class="flex flex-col">
                                <span class="font-medium">{step.title}</span>
                                <span class="text-xs text-muted-foreground">{step.detail}</span>
                            </span>
                        </li>
                    </For>
                </ul>

                <Show when=move || blocked.get()>
                    <div class="flex gap-2">
                        <Button
                            variant=ButtonVariant::Outline
                            class="flex-1"
                            on:click=move |_| app.retry_boot()
                        >
                            {copy::SPLASH_TRY_AGAIN}
                        </Button>
                        <Button class="flex-1" on:click=move |_| app.screen.set(Screen::Home)>
                            {copy::SPLASH_CONTINUE}
                        </Button>
                    </div>
                </Show>
            </div>
        </div>
    }
}

#[component]
fn DexLogo() -> impl IntoView {
    view! {
        <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            aria-hidden="true"
            class="text-foreground"
        >
            <rect x="8" y="8" width="48" height="48" rx="14" stroke="currentColor" stroke-width="3" />
            <path
                d="M22 24 L30 32 L22 40"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            <path d="M34 40 H44" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
    }
}

/// Sidebar / (empty ⟷ chat) / approval panel — the same three columns as the
/// Flutter home.
#[component]
fn Home() -> impl IntoView {
    let app = use_app();

    view! {
        <div class="flex overflow-hidden h-full">
            <Sidebar />
            <main class="flex flex-col min-w-0 grow">
                <ConnectionBanner />
                <Show
                    when=move || app.has_messages()
                    fallback=|| view! { <EmptyHome /> }
                >
                    <ChatView />
                </Show>
                <Composer />
            </main>
            <ApprovalPanel />
            <Modals />
        </div>
    }
}

/// Boot status per supervised process, mirrored from the shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BootStatus {
    Pending,
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootRow {
    pub id: &'static str,
    pub title: &'static str,
    pub detail: String,
    pub status: BootStatus,
    pub optional: bool,
}
