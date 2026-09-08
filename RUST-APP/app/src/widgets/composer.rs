//! The prompt field.
//!
//! Built on `ui::input_prompt`, plus the three things the Flutter composer has
//! that it does not: the slash palette, attachments, and shell-style history
//! recall on the arrow keys.

use icons::{ArrowUp, Camera, Paperclip, Plus, Square, X};
use leptos::html;
use leptos::prelude::*;
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::button::{Button, ButtonSize, ButtonVariant};
use registry::ui::dropdown_menu::{
    DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger,
};
use registry::ui::input_prompt::{InputPrompt, InputPromptFooter, InputPromptTools};

use dex_protocol::{Attachment, AttachmentKind};

use crate::copy;
use crate::slash::{self, SlashAction, SlashCommand};
use crate::state::{Modal, use_app};

/// Prompt history depth, matching `core/prompt_history.dart`.
const HISTORY_CAP: usize = 200;

#[component]
pub fn Composer() -> impl IntoView {
    let app = use_app();

    let text = RwSignal::new(String::new());
    let attachments = RwSignal::new(Vec::<Attachment>::new());
    let history = RwSignal::new(Vec::<String>::new());
    let history_index = RwSignal::new(None::<usize>);
    let palette_index = RwSignal::new(0_usize);
    let textarea: NodeRef<html::Textarea> = NodeRef::new();

    // The palette is open while the field holds a single `/token` with no
    // space — the same rule as `dex_composer.dart:139`.
    let palette_query = Signal::derive(move || {
        let value = text.get();
        let rest = value.strip_prefix('/')?;
        (!rest.contains(char::is_whitespace)).then(|| rest.to_owned())
    });
    let palette_matches =
        Signal::derive(move || palette_query.get().map(|q| slash::matches(&q)).unwrap_or_default());
    let palette_open = Signal::derive(move || palette_query.get().is_some());

    let remember = move |value: &str| {
        history.update(|h| {
            // Dedupe consecutive repeats: holding Up through five identical
            // prompts is not history, it is noise.
            if h.last().map(String::as_str) != Some(value) {
                h.push(value.to_owned());
                if h.len() > HISTORY_CAP {
                    h.remove(0);
                }
            }
        });
        history_index.set(None);
    };

    let submit = move || {
        let value = text.get();
        let trimmed = value.trim().to_owned();
        if trimmed.is_empty() {
            return;
        }

        if let Some(command) = trimmed.strip_prefix('/') {
            run_slash(command, app, text, attachments);
            remember(&trimmed);
            return;
        }

        let attached = attachments.get();
        if attached.is_empty() {
            app.submit(&trimmed);
        } else {
            app.submit_with_attachments(&trimmed, attached);
        }
        remember(&trimmed);
        text.set(String::new());
        attachments.set(Vec::new());
    };

    let accept_palette = move || {
        let matches = palette_matches.get();
        let Some(command) = matches.get(palette_index.get()).copied() else {
            return;
        };
        if command.args_hint.is_some() {
            // Needs arguments, so write it into the field rather than running
            // a command with nothing to act on.
            text.set(format!("/{} ", command.name));
            if let Some(node) = textarea.get() {
                let _ = node.focus();
            }
        } else {
            run_command(command, "", app, text, attachments);
        }
        palette_index.set(0);
    };

    let on_keydown = move |ev: web_sys::KeyboardEvent| {
        let key = ev.key();

        if palette_open.get() {
            let len = palette_matches.get().len();
            match key.as_str() {
                "ArrowDown" if len > 0 => {
                    ev.prevent_default();
                    palette_index.update(|i| *i = (*i + 1) % len);
                    return;
                }
                "ArrowUp" if len > 0 => {
                    ev.prevent_default();
                    palette_index.update(|i| *i = if *i == 0 { len - 1 } else { *i - 1 });
                    return;
                }
                "Enter" if !ev.shift_key() && len > 0 => {
                    ev.prevent_default();
                    accept_palette();
                    return;
                }
                "Escape" => {
                    ev.prevent_default();
                    text.set(String::new());
                    return;
                }
                _ => {}
            }
        }

        match key.as_str() {
            "Enter" if !ev.shift_key() => {
                ev.prevent_default();
                submit();
            }
            // History recall only at the edges of the field, so the arrows
            // still move the caret in a multi-line prompt.
            "ArrowUp" if at_start(&textarea) => {
                let entries = history.get();
                if entries.is_empty() {
                    return;
                }
                ev.prevent_default();
                let next = match history_index.get() {
                    None => entries.len() - 1,
                    Some(0) => 0,
                    Some(i) => i - 1,
                };
                history_index.set(Some(next));
                if let Some(entry) = entries.get(next) {
                    text.set(entry.clone());
                }
            }
            "ArrowDown" if at_end(&textarea) => {
                let entries = history.get();
                let Some(current) = history_index.get() else {
                    return;
                };
                ev.prevent_default();
                if current + 1 >= entries.len() {
                    history_index.set(None);
                    text.set(String::new());
                } else {
                    history_index.set(Some(current + 1));
                    if let Some(entry) = entries.get(current + 1) {
                        text.set(entry.clone());
                    }
                }
            }
            _ => {}
        }
    };

    view! {
        <div class="relative px-6 pb-6 mx-auto w-full max-w-3xl">
            <SlashPalette
                open=palette_open
                matches=palette_matches
                selected=palette_index
                query=palette_query
                on_pick=Callback::new(move |i: usize| {
                    palette_index.set(i);
                    accept_palette();
                })
            />

            <AttachmentStrip attachments=attachments />

            <InputPrompt>
                <textarea
                    node_ref=textarea
                    data-slot="input-group-control"
                    class="flex-1 py-3 px-3 max-h-48 text-sm bg-transparent rounded-none border-0 shadow-none resize-none field-sizing-content min-h-[52px] focus-visible:ring-0 dark:bg-transparent placeholder:text-muted-foreground"
                    placeholder=copy::COMPOSER_PLACEHOLDER
                    prop:value=move || text.get()
                    on:input=move |ev| {
                        text.set(event_target_value(&ev));
                        palette_index.set(0);
                    }
                    on:keydown=on_keydown
                ></textarea>

                <InputPromptFooter>
                    <InputPromptTools>
                        <AddMenu attachments=attachments />
                        <ModeMenu />
                    </InputPromptTools>

                    <div class="flex gap-1 items-center ml-auto">
                        <Show
                            when=move || app.is_busy()
                            fallback=move || {
                                view! {
                                    <Button
                                        size=ButtonSize::IconSm
                                        attr:aria-label="Send"
                                        attr:disabled=move || text.get().trim().is_empty()
                                        on:click=move |_| submit()
                                    >
                                        <ArrowUp />
                                    </Button>
                                }
                            }
                        >
                            <Button
                                size=ButtonSize::IconSm
                                variant=ButtonVariant::Secondary
                                attr:aria-label="Stop"
                                on:click=move |_| app.stop()
                            >
                                <Square />
                            </Button>
                        </Show>
                    </div>
                </InputPromptFooter>
            </InputPrompt>

            <p class="pt-2 text-xs text-center text-muted-foreground">{copy::DISCLAIMER}</p>
        </div>
    }
}

#[component]
fn SlashPalette(
    open: Signal<bool>,
    matches: Signal<Vec<&'static SlashCommand>>,
    selected: RwSignal<usize>,
    query: Signal<Option<String>>,
    on_pick: Callback<usize>,
) -> impl IntoView {
    view! {
        <Show when=move || open.get()>
            <div class="absolute right-6 bottom-full left-6 z-20 mb-2 rounded-lg border shadow-lg border-border bg-popover">
                <Show
                    when=move || !matches.get().is_empty()
                    fallback=move || {
                        view! {
                            <p class="p-3 text-sm text-muted-foreground">
                                {move || slash::no_match(&query.get().unwrap_or_default())}
                            </p>
                        }
                    }
                >
                    <ul class="overflow-y-auto p-1 max-h-72" role="listbox">
                        {move || {
                            matches
                                .get()
                                .into_iter()
                                .enumerate()
                                .map(|(i, command)| {
                                    let active = selected.get() == i;
                                    view! {
                                        <li role="option" aria-selected=active.to_string()>
                                            <button
                                                class=if active {
                                                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm bg-accent text-accent-foreground"
                                                } else {
                                                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
                                                }
                                                on:click=move |_| on_pick.run(i)
                                            >
                                                <span class="font-mono">{format!("/{}", command.name)}</span>
                                                {command
                                                    .args_hint
                                                    .map(|hint| {
                                                        view! {
                                                            <span class="font-mono text-xs text-muted-foreground">
                                                                {hint}
                                                            </span>
                                                        }
                                                    })}
                                                <span class="ml-auto text-xs truncate text-muted-foreground">
                                                    {command.description}
                                                </span>
                                            </button>
                                        </li>
                                    }
                                })
                                .collect_view()
                        }}
                    </ul>
                    <footer class="flex gap-3 justify-between px-3 py-1.5 text-xs border-t border-border text-muted-foreground">
                        <span>{copy::PALETTE_HINT}</span>
                        <span>
                            {move || format!("{} of {}", selected.get() + 1, matches.get().len())}
                        </span>
                    </footer>
                </Show>
            </div>
        </Show>
    }
}

#[component]
fn AttachmentStrip(attachments: RwSignal<Vec<Attachment>>) -> impl IntoView {
    view! {
        <Show when=move || !attachments.get().is_empty()>
            <div class="flex flex-wrap gap-2 pb-2">
                {move || {
                    attachments
                        .get()
                        .into_iter()
                        .enumerate()
                        .map(|(i, item)| {
                            let name = item.name.clone();
                            view! {
                                <Badge variant=BadgeVariant::Secondary class="gap-1.5 pr-1">
                                    <Paperclip class="size-3" />
                                    <span class="max-w-40 truncate">{name.clone()}</span>
                                    <button
                                        class="rounded-sm hover:bg-background/50"
                                        aria-label=format!("Remove {name}")
                                        on:click=move |_| {
                                            attachments
                                                .update(|list| {
                                                    if i < list.len() {
                                                        list.remove(i);
                                                    }
                                                })
                                        }
                                    >
                                        <X class="size-3" />
                                    </button>
                                </Badge>
                            }
                        })
                        .collect_view()
                }}
            </div>
        </Show>
    }
}

/// Fast / Smart / Think deeper.
///
/// Only meaningful on Claude Code, where these are aliases for Haiku, Sonnet
/// and Opus; with a direct provider key the model is whatever Settings chose,
/// so the pill would be lying. It sets the brain either way and the core
/// ignores an alias it cannot use.
#[component]
fn ModeMenu() -> impl IntoView {
    let app = use_app();
    let current = RwSignal::new(copy::MODES[0].0);

    view! {
        <DropdownMenu>
            <DropdownMenuTrigger class="h-8 rounded-md px-2 text-xs" attr:aria-label="Mode">
                {move || current.get()}
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-[280px]">
                <DropdownMenuGroup>
                    {copy::MODES
                        .iter()
                        .map(|(label, detail, model)| {
                            let (label, model) = (*label, *model);
                            view! {
                                <DropdownMenuItem on:click=move |_| {
                                    current.set(label);
                                    app.set_brain_model(model);
                                }>
                                    <span class="flex flex-col">
                                        <span class="text-sm">{label}</span>
                                        <span class="text-xs text-muted-foreground">{*detail}</span>
                                    </span>
                                </DropdownMenuItem>
                            }
                        })
                        .collect_view()}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    }
}

#[component]
fn AddMenu(attachments: RwSignal<Vec<Attachment>>) -> impl IntoView {
    let app = use_app();

    view! {
        <DropdownMenu>
            <DropdownMenuTrigger class="flex justify-center items-center p-0 w-8 h-8 rounded-md" attr:aria-label="Add">
                <Plus class="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-[260px]">
                <DropdownMenuGroup>
                    <DropdownMenuItem on:click=move |_| pick_files(attachments)>
                        <span class="flex gap-2 items-center">
                            <Paperclip class="size-4" />
                            <span class="flex flex-col">
                                <span class="text-sm">{copy::ADD_MENU[0].0}</span>
                                <span class="text-xs text-muted-foreground">
                                    {copy::ADD_MENU[0].1}
                                </span>
                            </span>
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem on:click=move |_| app.capture_screen()>
                        <span class="flex gap-2 items-center">
                            <Camera class="size-4" />
                            <span class="flex flex-col">
                                <span class="text-sm">{copy::ADD_MENU[1].0}</span>
                                <span class="text-xs text-muted-foreground">
                                    {copy::ADD_MENU[1].1}
                                </span>
                            </span>
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem on:click=move |_| {
                        app.open(Modal::Settings("connectors".to_owned()))
                    }>
                        <span class="flex gap-2 items-center">
                            <Plus class="size-4" />
                            <span class="flex flex-col">
                                <span class="text-sm">{copy::ADD_MENU[2].0}</span>
                                <span class="text-xs text-muted-foreground">
                                    {copy::ADD_MENU[2].1}
                                </span>
                            </span>
                        </span>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    }
}

/// Open the native picker through the Tauri shell and attach what comes back.
fn pick_files(attachments: RwSignal<Vec<Attachment>>) {
    leptos::task::spawn_local(async move {
        for path in crate::gateway::pick_files().await {
            let name = path
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or(&path)
                .to_owned();
            let kind = if is_image(&name) {
                AttachmentKind::Image
            } else {
                AttachmentKind::File
            };
            attachments.update(|list| {
                list.push(Attachment {
                    kind,
                    name,
                    path: Some(path),
                    mime: None,
                    bytes: None,
                    text: None,
                });
            });
        }
    });
}

fn is_image(name: &str) -> bool {
    let lower = name.to_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn run_slash(
    raw: &str,
    app: crate::state::AppState,
    text: RwSignal<String>,
    attachments: RwSignal<Vec<Attachment>>,
) {
    let (name, args) = raw.split_once(char::is_whitespace).unwrap_or((raw, ""));
    let Some(command) = slash::COMMANDS
        .iter()
        .find(|c| c.name == name || c.aliases.contains(&name))
    else {
        app.notify(&slash::unknown(name));
        text.set(String::new());
        return;
    };
    run_command(command, args.trim(), app, text, attachments);
}

fn run_command(
    command: &SlashCommand,
    args: &str,
    app: crate::state::AppState,
    text: RwSignal<String>,
    attachments: RwSignal<Vec<Attachment>>,
) {
    match &command.action {
        SlashAction::Send(template) => {
            let prompt = template.replace("{args}", args);
            if args.is_empty() && template.contains("{args}") {
                app.notify(&format!(
                    "Usage: /{} {}",
                    command.name,
                    command.args_hint.unwrap_or_default()
                ));
                return;
            }
            app.submit(&prompt);
        }
        SlashAction::Open(surface) => match *surface {
            "settings" => {
                let tab = if args.is_empty() { "intelligence" } else { args };
                app.open(Modal::Settings(tab.to_owned()));
            }
            "memory" => app.open(Modal::Settings("memory".to_owned())),
            "reminders" => app.open(Modal::Reminders),
            "model" => app.open(Modal::ModelPicker),
            "help" => app.open(Modal::Help),
            "voice" => app.open(Modal::Voice),
            _ => {}
        },
        SlashAction::Local(what) => match *what {
            "clear" | "new" => app.new_conversation(),
            "stop" => app.stop(),
            "reconnect" | "restart" => app.gateway.reconnect_now(),
            "browser" => {
                if args.is_empty() {
                    app.notify("Usage: /browser <what to do on the web>");
                    return;
                }
                app.submit_to_panel(args);
            }
            "remind" => {
                if args.is_empty() {
                    app.notify(
                        "Usage: /remind 20m stand up  ·  /remind 17:30 leave for the dentist",
                    );
                    return;
                }
                app.set_reminder(args);
            }
            "history" => app.notify("History is in the sidebar."),
            _ => {}
        },
    }
    text.set(String::new());
    attachments.set(Vec::new());
}

fn at_start(node: &NodeRef<html::Textarea>) -> bool {
    node.get()
        .and_then(|n| n.selection_start().ok().flatten())
        .is_some_and(|pos| pos == 0)
}

fn at_end(node: &NodeRef<html::Textarea>) -> bool {
    node.get().is_some_and(|n| {
        let len = u32::try_from(n.value().len()).unwrap_or(u32::MAX);
        n.selection_start()
            .ok()
            .flatten()
            .is_some_and(|pos| pos >= len)
    })
}
