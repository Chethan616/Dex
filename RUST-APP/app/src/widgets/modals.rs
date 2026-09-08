//! Everything that opens over the chat.
//!
//! The Flutter client uses a `showGeneralDialog` per surface; here one signal
//! decides which is open, so two can never be.

use icons::{Check, ExternalLink, Trash, X};
use leptos::prelude::*;
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::button::{Button, ButtonSize, ButtonVariant};
use registry::ui::card::{CardSize, Card, CardContent, CardDescription, CardHeader, CardTitle};
use registry::ui::input::Input;
use registry::ui::scroll_area::ScrollArea;
use registry::ui::select::{Select, SelectContent, SelectOption, SelectTrigger, SelectValue};
use registry::ui::separator::Separator;
use registry::ui::spinner::Spinner;
use registry::ui::switch::Switch;

use crate::widgets::toggle::Toggle;

use dex_protocol::Inbound;

use crate::copy;
use crate::slash;
use crate::state::{Modal, use_app};

#[component]
pub fn Modals() -> impl IntoView {
    let app = use_app();

    view! {
        <Show when=move || app.modal.get() != Modal::None>
            <div
                class="flex fixed inset-0 z-40 justify-center items-center p-6 bg-black/40"
                role="dialog"
                aria-modal="true"
                on:click=move |_| app.close_modal()
            >
                <div
                    class="flex overflow-hidden flex-col w-full max-w-[760px] max-h-[640px] rounded-xl border shadow-2xl border-border bg-popover"
                    on:click=|ev| ev.stop_propagation()
                >
                    {move || match app.modal.get() {
                        Modal::Settings(tab) => view! { <SettingsDialog tab=tab /> }.into_any(),
                        Modal::Reminders => view! { <RemindersDialog /> }.into_any(),
                        Modal::ModelPicker => view! { <ModelPicker /> }.into_any(),
                        Modal::Help => view! { <HelpDialog /> }.into_any(),
                        Modal::Voice => view! { <VoiceDialog /> }.into_any(),
                        Modal::None => ().into_any(),
                    }}
                </div>
            </div>
        </Show>
    }
}

#[component]
fn DialogHeader(#[prop(into)] title: String) -> impl IntoView {
    let app = use_app();
    view! {
        <header class="flex gap-3 items-center px-5 py-3 border-b border-border shrink-0">
            <h2 class="text-sm font-semibold">{title}</h2>
            <Button
                class="ml-auto"
                variant=ButtonVariant::Ghost
                size=ButtonSize::IconSm
                attr:aria-label="Close"
                on:click=move |_| app.close_modal()
            >
                <X />
            </Button>
        </header>
    }
}

/// The eight-tab settings surface, 200px rail plus pane.
#[component]
fn SettingsDialog(tab: String) -> impl IntoView {
    let current = RwSignal::new(tab);

    view! {
        <DialogHeader title="Settings" />
        <div class="flex min-h-0 grow">
            <nav class="flex flex-col gap-0.5 p-2 w-[200px] shrink-0 border-r border-border">
                {copy::SETTINGS_TABS
                    .iter()
                    .map(|(id, label)| {
                        let id = *id;
                        view! {
                            <button
                                class=move || {
                                    if current.get() == id {
                                        "rounded-md px-3 py-2 text-left text-sm bg-accent text-accent-foreground"
                                    } else {
                                        "rounded-md px-3 py-2 text-left text-sm hover:bg-accent/50"
                                    }
                                }
                                on:click=move |_| current.set(id.to_owned())
                            >
                                {*label}
                            </button>
                        }
                    })
                    .collect_view()}
            </nav>

            <ScrollArea class="min-h-0 grow">
                <div class="flex flex-col gap-6 p-5">
                    {move || match current.get().as_str() {
                        "intelligence" => view! { <IntelligenceTab /> }.into_any(),
                        "preferences" => view! { <PreferencesTab /> }.into_any(),
                        "memory" => view! { <MemoryTab /> }.into_any(),
                        "account" => view! { <AccountTab /> }.into_any(),
                        "connectors" => view! { <ConnectorsTab /> }.into_any(),
                        "diagnostics" => view! { <DiagnosticsTab /> }.into_any(),
                        "privacy" => view! { <PrivacyTab /> }.into_any(),
                        _ => view! { <AboutTab /> }.into_any(),
                    }}
                </div>
            </ScrollArea>
        </div>
    }
}

#[component]
fn SettingsSection(
    #[prop(into)] title: String,
    #[prop(into, optional)] detail: String,
    /// Some sections are a heading and a paragraph with nothing under them.
    #[prop(optional)]
    children: Option<Children>,
) -> impl IntoView {
    view! {
        <section class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
                <h3 class="text-sm font-medium">{title}</h3>
                <Show when={
                    let detail = detail.clone();
                    move || !detail.is_empty()
                }>
                    <p class="text-xs text-muted-foreground">{detail.clone()}</p>
                </Show>
            </div>
            {children.map(|c| c())}
        </section>
    }
}

#[component]
fn IntelligenceTab() -> impl IntoView {
    let app = use_app();
    let settings = app.gateway.settings;

    let brain = Signal::derive(move || {
        settings
            .get()
            .and_then(|s| {
                let brain = s.get("brain")?;
                let provider = brain.get("provider")?.as_str()?.to_owned();
                let model = brain
                    .get("model")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                Some((provider, model))
            })
            .unwrap_or_else(|| ("not chosen".to_owned(), String::new()))
    });

    view! {
        <SettingsSection title=copy::BRAIN_TITLE detail=copy::BRAIN_DETAIL>
            <Card size=CardSize::Sm>
                <CardHeader class="pt-4">
                    <CardTitle class="flex gap-2 items-center text-sm">
                        {copy::CLAUDE_CODE}
                        <Badge variant=BadgeVariant::Secondary>{copy::CLAUDE_CODE_BADGE}</Badge>
                    </CardTitle>
                    <CardDescription>{copy::CLAUDE_CODE_DETAIL}</CardDescription>
                </CardHeader>
                <CardContent class="flex gap-2 items-center pb-4">
                    <span class="text-xs text-muted-foreground">
                        {move || {
                            let (provider, model) = brain.get();
                            if model.is_empty() {
                                format!("Brain: {provider}")
                            } else {
                                format!("Brain: {provider} / {model}")
                            }
                        }}
                    </span>
                    <Button
                        class="ml-auto"
                        variant=ButtonVariant::Outline
                        size=ButtonSize::Sm
                        on:click=move |_| app.gateway.send(&Inbound::ClaudeSignin)
                    >
                        "Sign in"
                    </Button>
                </CardContent>
            </Card>
            <Button
                variant=ButtonVariant::Outline
                size=ButtonSize::Sm
                on:click=move |_| app.open(Modal::ModelPicker)
            >
                "Choose a model"
            </Button>
        </SettingsSection>

        <Separator />
        <FullAccessCard />
        <Separator />

        <SettingsSection title=copy::WHERE_KEPT detail=copy::KEYS_ENCRYPTED>
            <ul class="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                <li>{copy::WHERE_KEPT_SETTINGS}</li>
                <li>{copy::WHERE_KEPT_CREDS}</li>
            </ul>
        </SettingsSection>
    }
}

/// The Full Access switch, with the four things it does and does not do.
#[component]
fn FullAccessCard() -> impl IntoView {
    let app = use_app();
    let enabled = app.gateway.full_access;

    view! {
        <SettingsSection title=copy::FULL_ACCESS_TITLE>
            <div class="flex gap-3 items-start">
                // `ui::switch` owns its own state and offers no change
                // callback, so a controlled toggle is used where the value has
                // to round-trip to the core.
                <Toggle
                    checked=enabled
                    aria_label=copy::FULL_ACCESS_TITLE
                    on_change=Callback::new(move |on: bool| {
                        app.gateway.send(&Inbound::FullAccess { enabled: on });
                    })
                />
                <p class="text-xs text-muted-foreground">
                    {move || {
                        if enabled.get() { copy::FULL_ACCESS_ON } else { copy::FULL_ACCESS_OFF }
                    }}
                </p>
            </div>
            <p class="text-xs text-muted-foreground">{copy::FULL_ACCESS_UAC}</p>
            <div class="flex flex-col gap-2 p-3 rounded-md border border-border">
                <p class="text-xs font-medium">{copy::FULL_ACCESS_RED}</p>
                <p class="text-xs text-muted-foreground">{copy::FULL_ACCESS_RED_DETAIL}</p>
                <p class="text-xs font-medium">{copy::FULL_ACCESS_HANDOFF}</p>
                <p class="text-xs text-muted-foreground">{copy::FULL_ACCESS_HANDOFF_DETAIL}</p>
            </div>
        </SettingsSection>
    }
}

#[component]
fn PreferencesTab() -> impl IntoView {
    let app = use_app();
    let theme = RwSignal::new("Dark".to_owned());
    let hotkey = RwSignal::new("Ctrl+K".to_owned());

    // The theme is a class on <html>, the same mechanism as upstream.
    Effect::new(move |_| {
        let dark = theme.get() != "Light";
        if let Some(root) = web_sys::window()
            .and_then(|w| w.document())
            .and_then(|d| d.document_element())
        {
            let list = root.class_list();
            let _ = if dark { list.add_1("dark") } else { list.remove_1("dark") };
        }
    });

    view! {
        <SettingsSection title="Theme">
            <Select
                default_value="Dark"
                on_change=Callback::new(move |v: Option<String>| {
                    theme.set(v.unwrap_or_else(|| "Dark".to_owned()));
                })
            >
                <SelectTrigger class="w-[200px]">
                    <SelectValue placeholder="Theme" />
                </SelectTrigger>
                <SelectContent>
                    <SelectOption value="System">"System"</SelectOption>
                    <SelectOption value="Dark">"Dark"</SelectOption>
                    <SelectOption value="Light">"Light"</SelectOption>
                </SelectContent>
            </Select>
        </SettingsSection>

        <SettingsSection
            title="Global hotkey to summon Dex"
            detail="May conflict with certain applications or accessibility features."
        >
            <Select
                default_value="Ctrl+K"
                on_change=Callback::new(move |v: Option<String>| {
                    hotkey.set(v.unwrap_or_else(|| "None".to_owned()));
                })
            >
                <SelectTrigger class="w-[200px]">
                    <SelectValue placeholder="Hotkey" />
                </SelectTrigger>
                <SelectContent>
                    <SelectOption value="None">"None"</SelectOption>
                    <SelectOption value="Ctrl+K">"Ctrl+K"</SelectOption>
                    <SelectOption value="Alt+Space">"Alt+Space"</SelectOption>
                </SelectContent>
            </Select>
            <Button
                variant=ButtonVariant::Outline
                size=ButtonSize::Sm
                class="w-fit"
                on:click=move |_| app.set_hotkey(&hotkey.get())
            >
                "Apply"
            </Button>
        </SettingsSection>

        <SettingsSection
            title="On close, keep the app running"
            detail="Closing the window hides Dex to the tray instead of exiting."
        >
            <Switch aria_label="Quit on close" />
        </SettingsSection>
    }
}

#[component]
fn MemoryTab() -> impl IntoView {
    let app = use_app();
    let workflows = app.gateway.workflows;
    let query = RwSignal::new(String::new());

    Effect::new(move |prev: Option<()>| {
        if prev.is_none() {
            app.gateway.send(&Inbound::GetWorkflows);
            app.gateway.send(&Inbound::GetHistory { query: None, limit: Some(50) });
            app.gateway.send(&Inbound::GetStats { days: Some(7) });
        }
    });

    view! {
        <SettingsSection title=copy::MEMORY_TITLE />
        <SettingsSection title=copy::MEMORY_WORKFLOWS detail=copy::MEMORY_WORKFLOWS_DETAIL>
            <Show
                when=move || !workflows.get().is_empty()
                fallback=|| {
                    view! {
                        <p class="text-xs text-muted-foreground">{copy::MEMORY_WORKFLOWS_EMPTY}</p>
                    }
                }
            >
                <ul class="flex flex-col gap-2">
                    {move || {
                        workflows
                            .get()
                            .iter()
                            .map(|w| {
                                let name = w
                                    .get("name")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default()
                                    .to_owned();
                                let steps = w.get("steps").and_then(serde_json::Value::as_u64).unwrap_or(0);
                                let runs = w.get("runCount").and_then(serde_json::Value::as_u64).unwrap_or(0);
                                let for_delete = name.clone();
                                view! {
                                    <li class="flex gap-3 items-center p-2 rounded-md border border-border">
                                        <span class="flex flex-col min-w-0">
                                            <span class="text-sm truncate">{name.clone()}</span>
                                            <span class="text-xs text-muted-foreground">
                                                {format!("{steps} steps · replayed {runs}×")}
                                            </span>
                                        </span>
                                        <Button
                                            class="ml-auto"
                                            variant=ButtonVariant::Ghost
                                            size=ButtonSize::IconSm
                                            attr:aria-label=format!("Forget {name}")
                                            on:click=move |_| {
                                                app.gateway
                                                    .send(
                                                        &Inbound::DeleteWorkflow {
                                                            name: for_delete.clone(),
                                                        },
                                                    );
                                                app.gateway.send(&Inbound::GetWorkflows);
                                            }
                                        >
                                            <Trash class="text-destructive" />
                                        </Button>
                                    </li>
                                }
                            })
                            .collect_view()
                    }}
                </ul>
            </Show>
        </SettingsSection>

        <SettingsSection title=copy::MEMORY_RECENT>
            <Input
                attr:placeholder=copy::MEMORY_SEARCH
                prop:value=move || query.get()
                on:input=move |ev| {
                    let value = event_target_value(&ev);
                    query.set(value.clone());
                    app.gateway
                        .send(
                            &Inbound::GetHistory {
                                query: (!value.is_empty()).then_some(value),
                                limit: Some(50),
                            },
                        );
                }
            />
            <HistoryRows />
        </SettingsSection>
    }
}

#[component]
fn HistoryRows() -> impl IntoView {
    let app = use_app();
    let history = app.gateway.history;

    view! {
        <Show
            when=move || !history.get().is_empty()
            fallback=|| view! { <p class="text-xs text-muted-foreground">{copy::MEMORY_NOTHING}</p> }
        >
            <ul class="flex flex-col gap-1">
                {move || {
                    history
                        .get()
                        .iter()
                        .map(|task| {
                            let text = task
                                .get("text")
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or_default()
                                .to_owned();
                            let status = task
                                .get("status")
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            let ok = matches!(status.as_str(), "COMPLETED" | "ANSWERED");
                            view! {
                                <li class="flex gap-2 items-center py-1 text-sm">
                                    <Badge variant=if ok {
                                        BadgeVariant::Secondary
                                    } else {
                                        BadgeVariant::Destructive
                                    }>{status}</Badge>
                                    <span class="truncate">{text}</span>
                                </li>
                            }
                        })
                        .collect_view()
                }}
            </ul>
        </Show>
    }
}

#[component]
fn AccountTab() -> impl IntoView {
    view! {
        <SettingsSection title=copy::ACCOUNT_MACHINE detail=copy::ACCOUNT_MACHINE_DETAIL />
        <Separator />
        <SettingsSection title=copy::ACCOUNT_KEPT detail=copy::ACCOUNT_KEPT_DETAIL />
    }
}

#[component]
fn ConnectorsTab() -> impl IntoView {
    let app = use_app();
    let health = app.gateway.health;

    Effect::new(move |prev: Option<()>| {
        if prev.is_none() {
            app.gateway.send(&Inbound::GetHealth);
        }
    });

    let summary = Signal::derive(move || {
        let all = health.get();
        let ready = all
            .iter()
            .filter(|c| c.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false))
            .count();
        format!(
            "{ready} of {} available. Checked live — the daemon by its pipe, the agents by their ports.",
            all.len(),
        )
    });

    view! {
        <SettingsSection title=copy::NAV_CAPABILITIES>
            <p class="text-xs text-muted-foreground">{move || summary.get()}</p>
            {copy::CAPABILITY_GROUPS
                .iter()
                .map(|(group, blurb)| {
                    let group = *group;
                    view! {
                        <div class="flex flex-col gap-2">
                            <h4 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {group}
                            </h4>
                            <p class="text-xs text-muted-foreground">{*blurb}</p>
                            <ul class="flex flex-col gap-1">
                                {move || {
                                    health
                                        .get()
                                        .iter()
                                        .filter(|c| {
                                            c.get("group").and_then(serde_json::Value::as_str)
                                                == Some(group)
                                        })
                                        .map(|c| {
                                            let name = c
                                                .get("name")
                                                .and_then(serde_json::Value::as_str)
                                                .unwrap_or_default()
                                                .to_owned();
                                            let detail = c
                                                .get("detail")
                                                .and_then(serde_json::Value::as_str)
                                                .unwrap_or_default()
                                                .to_owned();
                                            let ok = c
                                                .get("ok")
                                                .and_then(serde_json::Value::as_bool)
                                                .unwrap_or(false);
                                            view! {
                                                <li class="flex gap-2 items-center text-sm">
                                                    <Badge variant=if ok {
                                                        BadgeVariant::Secondary
                                                    } else {
                                                        BadgeVariant::Outline
                                                    }>{if ok { "ready" } else { "off" }}</Badge>
                                                    <span>{name}</span>
                                                    <span class="text-xs truncate text-muted-foreground">
                                                        {detail}
                                                    </span>
                                                </li>
                                            }
                                        })
                                        .collect_view()
                                }}
                            </ul>
                        </div>
                    }
                })
                .collect_view()}
        </SettingsSection>
    }
}

#[component]
fn DiagnosticsTab() -> impl IntoView {
    let app = use_app();
    let log = app.gateway.log;
    let source = RwSignal::new("core".to_owned());

    let fetch = move |name: &str| {
        app.gateway.send(&Inbound::GetLog {
            name: name.to_owned(),
            lines: Some(600),
        });
    };

    Effect::new(move |prev: Option<()>| {
        if prev.is_none() {
            fetch("core");
        }
    });

    view! {
        <SettingsSection title="Diagnostics" detail=copy::DIAGNOSTICS_DETAIL>
            <div class="flex flex-wrap gap-2">
                {copy::LOG_SOURCES
                    .iter()
                    .map(|(id, label, blurb)| {
                        let id = *id;
                        view! {
                            // `variant` is a plain enum, not a signal, so the
                            // selected state rides on a class.
                            <Button
                                variant=ButtonVariant::Outline
                                size=ButtonSize::Sm
                                attr:data-selected=move || (source.get() == id).to_string()
                                attr:class="data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                                attr:title=*blurb
                                on:click=move |_| {
                                    source.set(id.to_owned());
                                    fetch(id);
                                }
                            >
                                {*label}
                            </Button>
                        }
                    })
                    .collect_view()}
            </div>

            <ScrollArea class="h-64 rounded-md border border-border">
                <pre class="p-3 font-mono text-xs whitespace-pre-wrap">
                    {move || {
                        // An empty pane cannot distinguish "no lines yet" from
                        // "nothing is listening", and those need different
                        // things from the owner.
                        if app.gateway.state.get() != dex_protocol::ConnectionState::Connected {
                            return copy::DIAGNOSTICS_NOT_CONNECTED.to_owned();
                        }
                        log.get()
                            .filter(|(name, _)| *name == source.get())
                            .map(|(_, text)| text)
                            .filter(|text| !text.trim().is_empty())
                            .unwrap_or_else(|| copy::DIAGNOSTICS_EMPTY.to_owned())
                    }}
                </pre>
            </ScrollArea>
        </SettingsSection>
    }
}

#[component]
fn PrivacyTab() -> impl IntoView {
    view! {
        <SettingsSection title=copy::PRIVACY_TITLE />
        <SettingsSection title=copy::PRIVACY_CONTEXT detail=copy::PRIVACY_CONTEXT_DETAIL>
            <Switch checked=true aria_label=copy::PRIVACY_CONTEXT />
        </SettingsSection>
        <SettingsSection
            title=copy::PRIVACY_DIAGNOSTICS
            detail=copy::PRIVACY_DIAGNOSTICS_DETAIL
        >
            <Switch aria_label=copy::PRIVACY_DIAGNOSTICS />
        </SettingsSection>
    }
}

#[component]
fn AboutTab() -> impl IntoView {
    view! {
        <SettingsSection title="About">
            <p class="text-sm">{copy::ABOUT_TAGLINE}</p>
            <p class="text-xs text-muted-foreground">{copy::ABOUT_OPEN_SOURCE}</p>
            <a
                class="flex gap-1.5 items-center text-xs underline text-primary underline-offset-2"
                href="https://github.com/rust-ui/ui"
                target="_blank"
                rel="noopener noreferrer"
            >
                "Source & licenses"
                <ExternalLink class="size-3" />
            </a>
        </SettingsSection>
    }
}

/// Reminders, with the briefing tile the Flutter screen shows once.
#[component]
fn RemindersDialog() -> impl IntoView {
    let app = use_app();
    let reminders = app.gateway.reminders;
    let draft = RwSignal::new(String::new());
    let briefing = RwSignal::new(true);

    Effect::new(move |prev: Option<()>| {
        if prev.is_none() {
            app.gateway.send(&Inbound::GetReminders);
        }
    });

    view! {
        <DialogHeader title=copy::REMINDERS_TITLE />
        <ScrollArea class="min-h-0 grow">
            <div class="flex flex-col gap-4 p-5">
                <Show when=move || briefing.get()>
                    <Card size=CardSize::Sm>
                        <CardHeader class="pt-4">
                            <CardTitle class="text-sm">{copy::REMINDERS_BRIEFING_HEAD}</CardTitle>
                        </CardHeader>
                        <CardContent class="flex flex-col gap-3 pb-4">
                            <p class="text-xs text-muted-foreground">{copy::REMINDERS_BRIEFING}</p>
                            <Button
                                class="w-fit"
                                variant=ButtonVariant::Outline
                                size=ButtonSize::Sm
                                on:click=move |_| briefing.set(false)
                            >
                                {copy::REMINDERS_BRIEFING_DISMISS}
                            </Button>
                        </CardContent>
                    </Card>
                </Show>

                <div class="flex gap-2">
                    <Input
                        class="grow"
                        attr:placeholder=copy::REMINDERS_PLACEHOLDER
                        prop:value=move || draft.get()
                        on:input=move |ev| draft.set(event_target_value(&ev))
                    />
                    <Button on:click=move |_| {
                        app.set_reminder(&draft.get());
                        draft.set(String::new());
                    }>"Set"</Button>
                </div>

                <h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {copy::REMINDERS_UPCOMING}
                </h3>

                <Show
                    when=move || !reminders.get().is_empty()
                    fallback=|| {
                        view! { <p class="text-sm text-muted-foreground">{copy::REMINDERS_EMPTY}</p> }
                    }
                >
                    <ul class="flex flex-col gap-1">
                        {move || {
                            reminders
                                .get()
                                .iter()
                                .map(|r| {
                                    let name = r
                                        .get("name")
                                        .and_then(serde_json::Value::as_str)
                                        .unwrap_or_default()
                                        .to_owned();
                                    let text = r
                                        .get("text")
                                        .and_then(serde_json::Value::as_str)
                                        .unwrap_or_default()
                                        .to_owned();
                                    let at = r.get("at").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
                                    view! {
                                        <li class="flex gap-3 items-center p-2 rounded-md border border-border">
                                            <span class="flex flex-col min-w-0">
                                                <span class="text-sm truncate">{text}</span>
                                                <span class="text-xs text-muted-foreground">
                                                    {relative_time(at)}
                                                </span>
                                            </span>
                                            <Button
                                                class="ml-auto"
                                                variant=ButtonVariant::Ghost
                                                size=ButtonSize::IconSm
                                                attr:aria-label="Cancel reminder"
                                                on:click=move |_| {
                                                    app.gateway
                                                        .send(
                                                            &Inbound::DeleteReminder { name: name.clone() },
                                                        );
                                                    app.gateway.send(&Inbound::GetReminders);
                                                }
                                            >
                                                <X />
                                            </Button>
                                        </li>
                                    }
                                })
                                .collect_view()
                        }}
                    </ul>
                </Show>
            </div>
        </ScrollArea>
    }
}

/// `reminders_screen.dart:434`.
fn relative_time(at: f64) -> String {
    let now = js_sys::Date::now();
    let delta = at - now;
    if delta <= 0.0 {
        return "overdue".to_owned();
    }
    let minutes = (delta / 60_000.0).round();
    if minutes < 60.0 {
        return format!("in {minutes:.0}m");
    }
    let hours = minutes / 60.0;
    if hours < 24.0 {
        return format!("in {hours:.0}h");
    }
    format!("in {:.0}d", hours / 24.0)
}

/// The provider catalogue from `core/models_catalog.dart`.
const PROVIDERS: &[(&str, &str, &[(&str, &str)])] = &[
    (
        "anthropic",
        "Anthropic Claude",
        &[
            ("claude-sonnet-4-6", "Claude Sonnet 4.6"),
            ("claude-opus-4-1", "Claude Opus 4.1"),
            ("claude-haiku-4-5", "Claude Haiku 4.5 (fast)"),
        ],
    ),
    (
        "google",
        "Google Gemini",
        &[
            ("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (free, fast)"),
            ("gemini-2.5-flash", "Gemini 2.5 Flash"),
            ("gemini-2.5-pro", "Gemini 2.5 Pro"),
        ],
    ),
    (
        "openai",
        "OpenAI",
        &[
            ("gpt-5.5", "GPT-5.5"),
            ("gpt-5.1", "GPT-5.1"),
            ("gpt-5-mini", "GPT-5 mini (fast)"),
        ],
    ),
    (
        "groq",
        "Groq",
        &[
            ("llama-3.3-70b", "Llama 3.3 70B (fast, free)"),
            ("qwen-3-32b", "Qwen 3 32B"),
        ],
    ),
    (
        "ollama",
        "Ollama (local)",
        &[("llama3.3", "Llama 3.3"), ("qwen2.5", "Qwen 2.5")],
    ),
];

#[component]
fn ModelPicker() -> impl IntoView {
    let app = use_app();

    view! {
        <DialogHeader title="Choose a model" />
        <ScrollArea class="min-h-0 grow">
            <div class="flex flex-col gap-5 p-5">
                {PROVIDERS
                    .iter()
                    .map(|(id, name, models)| {
                        let id = *id;
                        view! {
                            <section class="flex flex-col gap-2">
                                <h3 class="text-sm font-medium">{*name}</h3>
                                <ul class="flex flex-col gap-1">
                                    {models
                                        .iter()
                                        .map(|(model, label)| {
                                            let model = *model;
                                            view! {
                                                <li>
                                                    <button
                                                        class="flex gap-2 items-center px-2 py-1.5 w-full text-sm text-left rounded-md hover:bg-accent"
                                                        on:click=move |_| {
                                                            app.gateway
                                                                .send(
                                                                    &Inbound::SetBrain {
                                                                        provider: id.to_owned(),
                                                                        model: Some(model.to_owned()),
                                                                    },
                                                                );
                                                            app.notify(&format!("{model} set."));
                                                            app.close_modal();
                                                        }
                                                    >
                                                        <Check class="size-3.5 opacity-0" />
                                                        {*label}
                                                    </button>
                                                </li>
                                            }
                                        })
                                        .collect_view()}
                                </ul>
                            </section>
                        }
                    })
                    .collect_view()}
            </div>
        </ScrollArea>
    }
}

/// The `/help` list.
#[component]
fn HelpDialog() -> impl IntoView {
    view! {
        <DialogHeader title="Commands" />
        <ScrollArea class="min-h-0 grow">
            <div class="flex flex-col gap-5 p-5">
                {slash::GROUPS
                    .iter()
                    .map(|group| {
                        let group = *group;
                        view! {
                            <section class="flex flex-col gap-1">
                                <h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    {group}
                                </h3>
                                <ul class="flex flex-col">
                                    {slash::COMMANDS
                                        .iter()
                                        .filter(|c| c.group == group)
                                        .map(|c| {
                                            view! {
                                                <li class="flex gap-3 items-baseline py-1 text-sm">
                                                    <span class="font-mono shrink-0">
                                                        {format!("/{}", c.name)}
                                                    </span>
                                                    <span class="text-xs text-muted-foreground">
                                                        {c.description}
                                                    </span>
                                                </li>
                                            }
                                        })
                                        .collect_view()}
                                </ul>
                            </section>
                        }
                    })
                    .collect_view()}
            </div>
        </ScrollArea>
    }
}

/// Voice is a shell in the Flutter client too — the mic buttons are no-ops
/// there. Saying so is better than drawing a control that does nothing.
#[component]
fn VoiceDialog() -> impl IntoView {
    view! {
        <DialogHeader title="Voice" />
        <div class="flex flex-col gap-3 items-center p-10">
            <Spinner />
            <p class="text-sm">"I'm listening"</p>
            <p class="text-xs text-center text-muted-foreground">
                "Voice capture is not wired up yet. Type instead — everything else works."
            </p>
        </div>
    }
}
