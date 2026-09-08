//! The home screen before a conversation starts. First impression, so it
//! gets the most polish in the app: a typewritten tagline, a breathing status
//! mark, and a grid of suggestions that arrive one at a time rather than all
//! at once.
//!
//! The suggestions are **not** built on `ui::chips::ChipItem`. That component
//! is a checkbox-based filter chip — `<label><input type="checkbox">` — meant
//! to stay toggled, with a `has-[:checked]:bg-warning` style for the selected
//! state. Wrapping it in a `<button on:click>` nested interactive content
//! inside a button, which is invalid HTML; the browser's handling of that is
//! exactly what painted a chip warning-orange with warning-orange text
//! (background and text share one token, so "selected" reads as blank) the
//! first time it was clicked. A suggestion here is a one-shot prompt, not a
//! persistent filter — the right component is a plain button.

use icons::{Camera, FileSpreadsheet, FolderPlus, FolderSearch, Globe, MailOpen, Reply, Sparkles};
use leptos::prelude::*;
use wasm_bindgen::JsCast;

use crate::copy;
use crate::state::use_app;

/// Total time for the typewriter, matching `empty_home.dart:92`.
const TYPE_MS: f64 = 700.0;

/// One suggestion, paired with an icon. Order matches `copy::SUGGESTIONS`.
const SUGGESTION_ICONS: &[fn() -> AnyView] = &[
    || view! { <FileSpreadsheet /> }.into_any(),
    || view! { <FolderSearch /> }.into_any(),
    || view! { <Camera /> }.into_any(),
    || view! { <Globe /> }.into_any(),
    || view! { <MailOpen /> }.into_any(),
    || view! { <FolderPlus /> }.into_any(),
    || view! { <Reply /> }.into_any(),
    || view! { <Sparkles /> }.into_any(),
];

#[component]
pub fn EmptyHome() -> impl IntoView {
    let app = use_app();
    let tagline = app.tagline;
    let typed = RwSignal::new(0_usize);

    // Reveal a character at a time over TYPE_MS, easeOutCubic, so it lands
    // rather than stopping.
    Effect::new(move |_| {
        let full = tagline.get();
        let total = full.chars().count();
        typed.set(0);
        if total == 0 {
            return;
        }
        for step in 1..=total {
            let progress = step as f64 / total as f64;
            // easeOutCubic: 1 - (1 - t)^3
            let eased = 1.0 - (1.0 - progress).powi(3);
            let delay = TYPE_MS * eased;
            let closure = wasm_bindgen::closure::Closure::once_into_js(move || {
                typed.set(step);
            });
            if let Some(window) = web_sys::window()
                && let Some(function) = closure.dyn_ref::<js_sys::Function>()
            {
                let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                    function,
                    delay as i32,
                );
            }
        }
    });

    view! {
        <div class="overflow-hidden relative flex-col justify-center items-center px-6 mx-auto w-full max-w-3xl grow flex">
            <div class="flex relative flex-col items-center duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
                <span class="flex gap-1.5 items-center px-2.5 py-1 mb-5 text-[11px] font-medium tracking-wide uppercase rounded-full border border-border text-muted-foreground">
                    <span class="relative flex size-1.5">
                        <span class="inline-flex absolute w-full h-full rounded-full opacity-75 animate-ping bg-foreground/40"></span>
                        <span class="inline-flex relative rounded-full size-1.5 bg-foreground/70"></span>
                    </span>
                    "Dex"
                </span>

                <h1 class="text-4xl font-semibold tracking-tight text-center sm:text-5xl">
                    {app.heading.get()}
                </h1>

                <p class="mt-4 min-h-6 max-w-md text-sm text-center text-muted-foreground">
                    {move || tagline.get().chars().take(typed.get()).collect::<String>()}
                    // A caret, so a half-typed line reads as in-progress.
                    <Show when=move || typed.get() < tagline.get().chars().count()>
                        <span class="inline-block ml-0.5 w-px h-4 align-middle animate-pulse bg-foreground"></span>
                    </Show>
                </p>
            </div>

            <div class="grid relative grid-cols-1 gap-2.5 mt-10 w-full sm:grid-cols-2">
                {copy::SUGGESTIONS
                    .iter()
                    .enumerate()
                    .map(|(i, suggestion)| {
                        let icon = SUGGESTION_ICONS.get(i).copied();
                        // Staggered arrival: each card is ~60ms behind the
                        // last, so the grid fills in rather than snapping into
                        // place all at once. Capped so a longer list never
                        // makes the owner wait to start typing.
                        let delay_ms = 120 + (i * 60).min(400);
                        view! {
                            <button
                                class="flex gap-3 items-center p-3.5 text-left rounded-xl border transition-all duration-200 group border-border bg-card hover:bg-accent hover:border-foreground/20 hover:-translate-y-0.5 active:scale-[0.98] animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both"
                                style=format!("animation-delay: {delay_ms}ms; animation-duration: 400ms")
                                on:click=move |_| app.submit(suggestion)
                            >
                                <span class="flex shrink-0 justify-center items-center rounded-lg border transition-colors size-8 border-border bg-muted text-muted-foreground group-hover:text-foreground group-hover:border-foreground/30 [&_svg]:size-4">
                                    {icon.map(|f| f())}
                                </span>
                                <span class="text-sm leading-snug text-foreground/90 group-hover:text-foreground">
                                    {*suggestion}
                                </span>
                            </button>
                        }
                    })
                    .collect_view()}
            </div>
        </div>
    }
}
