//! The home screen before a conversation starts.
//!
//! A tagline picked once per launch and typewritten, then the eight
//! suggestions — the same ones the Flutter home offers.

use leptos::prelude::*;
use wasm_bindgen::JsCast;
use registry::ui::chips::{ChipItem, ChipsContainer};

use crate::copy;
use crate::state::use_app;

/// Total time for the typewriter, matching `empty_home.dart:92`.
const TYPE_MS: f64 = 700.0;

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
        <div class="flex flex-col justify-center items-center px-6 mx-auto w-full max-w-3xl grow">
            <h1 class="text-3xl font-semibold tracking-tight">
                {format!("Hi {}", copy::GREETING_NAME)}
            </h1>

            <p class="mt-3 min-h-6 text-sm text-center text-muted-foreground">
                {move || {
                    tagline.get().chars().take(typed.get()).collect::<String>()
                }}
                // A caret, so a half-typed line reads as in-progress.
                <Show when=move || typed.get() < tagline.get().chars().count()>
                    <span class="inline-block ml-0.5 w-px h-4 align-middle animate-pulse bg-foreground"></span>
                </Show>
            </p>

            <div class="mt-8 w-full">
                <ChipsContainer>
                    {copy::SUGGESTIONS
                        .iter()
                        .map(|suggestion| {
                            view! {
                                <button on:click=move |_| app.submit(suggestion)>
                                    <ChipItem label=*suggestion />
                                </button>
                            }
                        })
                        .collect_view()}
                </ChipsContainer>
            </div>
        </div>
    }
}
