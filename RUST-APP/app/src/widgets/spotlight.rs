//! The Ctrl+K overlay.
//!
//! Its own window: 720x420, borderless, always on top. It takes one prompt and
//! hands it to the main window, which is raised *after* the handover so the
//! owner lands on the reply already streaming.
//!
//! Deliberately not connected to the core. Two sockets from one app would mean
//! two clients receiving every broadcast, and this window closes the moment it
//! has something to say.

use icons::CornerDownLeft;
use leptos::html;
use leptos::prelude::*;
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::kbd::Kbd;

use crate::copy;

#[component]
pub fn Spotlight() -> impl IntoView {
    let text = RwSignal::new(String::new());
    let input: NodeRef<html::Input> = NodeRef::new();

    // The window is summoned to be typed into; anything else is a wasted press.
    Effect::new(move |prev: Option<()>| {
        if prev.is_none()
            && let Some(node) = input.get()
        {
            let _ = node.focus();
        }
    });

    let submit = move || {
        let value = text.get().trim().to_owned();
        if value.is_empty() {
            return;
        }
        crate::gateway::spotlight_submit(&value);
        text.set(String::new());
    };

    view! {
        <div class="flex flex-col p-4 h-screen bg-background text-foreground">
            <div class="flex overflow-hidden flex-col rounded-xl border shadow-2xl border-border bg-popover">
                <div class="flex gap-3 items-center px-4 py-3 border-b border-border">
                    <Badge variant=BadgeVariant::Secondary>"Dex"</Badge>
                    <input
                        node_ref=input
                        class="flex-1 text-base bg-transparent border-0 outline-none placeholder:text-muted-foreground"
                        placeholder=copy::SPOTLIGHT_PLACEHOLDER
                        prop:value=move || text.get()
                        on:input=move |ev| text.set(event_target_value(&ev))
                        on:keydown=move |ev| {
                            match ev.key().as_str() {
                                "Enter" => {
                                    ev.prevent_default();
                                    submit();
                                }
                                "Escape" => {
                                    ev.prevent_default();
                                    crate::gateway::spotlight_dismiss();
                                }
                                _ => {}
                            }
                        }
                    />
                    <Kbd>"esc"</Kbd>
                </div>

                <ul class="flex flex-col p-2">
                    {copy::SPOTLIGHT_SUGGESTIONS
                        .iter()
                        .map(|suggestion| {
                            view! {
                                <li>
                                    <button
                                        class="flex gap-2 items-center px-2 py-2 w-full text-sm text-left rounded-md hover:bg-accent"
                                        on:click=move |_| {
                                            text.set((*suggestion).to_owned());
                                            submit();
                                        }
                                    >
                                        <CornerDownLeft class="size-3.5 text-muted-foreground" />
                                        {*suggestion}
                                    </button>
                                </li>
                            }
                        })
                        .collect_view()}
                </ul>
            </div>
        </div>
    }
}
