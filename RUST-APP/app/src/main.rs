//! The DEX client UI.
//!
//! Leptos CSR, rendered inside the Tauri shell. The shell owns the tray, the
//! hotkey and the supervised processes; this owns everything on screen.

use leptos::prelude::*;

mod copy;
mod gateway;
mod genui;
mod screens;
mod slash;
mod state;
mod widgets;

fn main() {
    console_error_panic_hook::set_once();
    _ = console_log::init_with_level(log::Level::Debug);
    leptos::mount::mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
    // The overlay is a second window of the same bundle. It takes one prompt
    // and hands it over, so it never opens a socket of its own — two clients
    // would both receive every broadcast.
    if gateway::is_spotlight() {
        return view! { <widgets::spotlight::Spotlight /> }.into_any();
    }

    // One socket, one store, provided once at the root.
    let gateway = gateway::Gateway::start();
    let app = state::AppState::new(gateway);
    provide_context(app);

    // Prompts typed into the overlay arrive here and run as if typed in place.
    gateway::on_spotlight_prompt(move |text| app.submit(&text));

    view! { <screens::Root /> }.into_any()
}
