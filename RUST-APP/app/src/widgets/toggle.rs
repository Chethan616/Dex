//! A controlled switch.
//!
//! `ui::switch` keeps its own state and exposes no change callback, which is
//! right for a form that is read on submit and wrong for a setting that has to
//! round-trip to the core. This is the same markup and the same classes, with
//! the state owned by the caller.

use leptos::prelude::*;

#[component]
pub fn Toggle(
    #[prop(into)] checked: Signal<bool>,
    #[prop(into)] on_change: Callback<bool>,
    #[prop(into, optional)] aria_label: String,
    #[prop(into, optional)] class: String,
) -> impl IntoView {
    let state = move || if checked.get() { "checked" } else { "unchecked" };

    view! {
        <button
            data-name="Switch"
            type="button"
            role="switch"
            aria-checked=move || checked.get().to_string()
            aria-label=aria_label
            data-state=state
            class=tw_merge::tw_merge!(
                "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
                class,
            )
            on:click=move |_| on_change.run(!checked.get())
        >
            <span
                data-state=state
                class="block rounded-full ring-0 shadow-lg transition-transform pointer-events-none size-5 bg-background data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
            />
        </button>
    }
}
