//! The transcript.
//!
//! Human turns, agent prose, and — the point of the whole surface — a step
//! that is visible *while it runs*, not a summary once it is over.

use icons::{Check, Copy, ThumbsDown, ThumbsUp, TriangleAlert, X};
use leptos::prelude::*;
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::bubble::{Bubble, BubbleAlign, BubbleContent, BubbleVariant};
use registry::ui::button::{Button, ButtonSize, ButtonVariant};
use registry::ui::marker::{Marker, MarkerContent, MarkerIcon};
use registry::ui::message::{Message as MessageRow, MessageAlign, MessageContent};
use registry::ui::scroll_area::ScrollArea;
use registry::ui::spinner::Spinner;

use dex_protocol::FeedbackVerdict;
use dex_store::{AgentState, Message, MessageSpeaker, ToolChipState};

use crate::copy;
use crate::state::use_app;
use crate::genui::{GenUi, UiNode};
use crate::widgets::artifact_card::ArtifactCard;
use crate::widgets::plan_card::PlanCard;

#[component]
pub fn ChatView() -> impl IntoView {
    let app = use_app();

    view! {
        <div class="flex flex-col min-h-0 grow">
            <header class="flex gap-3 items-center px-6 py-3 border-b border-border shrink-0">
                <h2 class="text-sm font-medium">{copy::CHAT_TITLE}</h2>
                <AgentStatePill />
                <div class="ml-auto">
                    <Show when=move || app.is_busy()>
                        <Button
                            variant=ButtonVariant::Outline
                            size=ButtonSize::Sm
                            on:click=move |_| app.stop()
                        >
                            <X />
                            "Stop"
                        </Button>
                    </Show>
                </div>
            </header>

            <ScrollArea class="min-h-0 grow">
                <div class="flex flex-col gap-6 py-8 px-6 mx-auto w-full max-w-3xl">
                    <PlanCard />
                    <For
                        each=move || app.messages()
                        key=|m| (m.id.clone(), m.chip_state, m.artifact.is_some())
                        let:message
                    >
                        <MessageView message=message />
                    </For>
                    <ThinkingMarker />
                </div>
            </ScrollArea>
        </div>
    }
}

/// The state word and glyph the Flutter client draws beside the title.
#[component]
fn AgentStatePill() -> impl IntoView {
    let app = use_app();
    let state = Signal::derive(move || app.agent_state());

    view! {
        <span class="flex gap-1.5 items-center text-xs text-muted-foreground">
            <span aria-hidden="true">{move || state.get().glyph()}</span>
            <span>{move || state.get().label()}</span>
        </span>
    }
}

/// "thinking…" while the planner is working and nothing is on screen yet.
#[component]
fn ThinkingMarker() -> impl IntoView {
    let app = use_app();
    let show = Signal::derive(move || app.agent_state() == AgentState::Thinking);

    view! {
        <Show when=move || show.get()>
            <Marker role="status">
                <MarkerIcon>
                    <Spinner />
                </MarkerIcon>
                <MarkerContent class="shimmer">"thinking..."</MarkerContent>
            </Marker>
        </Show>
    }
}

#[component]
fn MessageView(message: Message) -> impl IntoView {
    match message.speaker {
        MessageSpeaker::Human => view! { <HumanMessage message=message /> }.into_any(),
        MessageSpeaker::ToolChip => view! { <StepRow message=message /> }.into_any(),
        MessageSpeaker::Agent | MessageSpeaker::Action => {
            view! { <AgentMessage message=message /> }.into_any()
        }
    }
}

#[component]
fn HumanMessage(message: Message) -> impl IntoView {
    view! {
        <MessageRow align=MessageAlign::End>
            <MessageContent>
                <Bubble align=BubbleAlign::End>
                    <BubbleContent>{message.text}</BubbleContent>
                </Bubble>
            </MessageContent>
        </MessageRow>
    }
}

#[component]
fn AgentMessage(message: Message) -> impl IntoView {
    let app = use_app();
    let request_id = message.request_id.clone().unwrap_or_default();
    let text_for_copy = message.text.clone();
    let generated = message.ui.as_ref().and_then(parse_ui);
    // Local and optimistic: clicking the same thumb again withdraws it.
    let verdict = RwSignal::new(0_i8);

    // Two buttons call this, so it is a Callback rather than a closure moved
    // into the first one.
    let vote = Callback::new(move |value: i8| {
        let next = if verdict.get() == value { 0 } else { value };
        verdict.set(next);
        app.feedback(
            &request_id,
            match next {
                1 => FeedbackVerdict::Up,
                -1 => FeedbackVerdict::Down,
                _ => FeedbackVerdict::None,
            },
        );
    });

    view! {
        <MessageRow>
            <MessageContent>
                <Bubble variant=BubbleVariant::Muted>
                    <BubbleContent class="whitespace-pre-wrap">{message.text}</BubbleContent>
                </Bubble>
                {generated.map(|node| view! { <GenUi node=node /> })}
                <div class="flex gap-1 items-center opacity-0 transition-opacity group-hover/message:opacity-100">
                    <Button
                        variant=ButtonVariant::Ghost
                        size=ButtonSize::IconXs
                        attr:aria-label="Like"
                        attr:aria-pressed=move || (verdict.get() == 1).to_string()
                        on:click=move |_| vote.run(1)
                    >
                        <ThumbsUp />
                    </Button>
                    <Button
                        variant=ButtonVariant::Ghost
                        size=ButtonSize::IconXs
                        attr:aria-label="Dislike"
                        attr:aria-pressed=move || (verdict.get() == -1).to_string()
                        on:click=move |_| vote.run(-1)
                    >
                        <ThumbsDown />
                    </Button>
                    <Button
                        variant=ButtonVariant::Ghost
                        size=ButtonSize::IconXs
                        attr:aria-label="Copy"
                        on:click=move |_| copy_to_clipboard(&text_for_copy)
                    >
                        <Copy />
                    </Button>
                </div>
            </MessageContent>
        </MessageRow>
    }
}

/// One step in the transcript: badge, name, engine pill, outcome — and its
/// artifact card when the step produced one.
#[component]
fn StepRow(message: Message) -> impl IntoView {
    let state = message.chip_state.unwrap_or(ToolChipState::Running);
    let badge = copy::step_badge(message.tool_id.as_deref().unwrap_or(""));
    let engine = message.engine.map(|e| e.label());
    let artifact = message.artifact.clone();
    let generated = message.ui.as_ref().and_then(parse_ui);

    view! {
        <div class="flex flex-col gap-2">
            <Marker>
                <MarkerIcon>
                    {match state {
                        ToolChipState::Running => view! { <Spinner /> }.into_any(),
                        ToolChipState::Done => view! { <Check class="text-success" /> }.into_any(),
                        ToolChipState::Failed => {
                            view! { <TriangleAlert class="text-destructive" /> }.into_any()
                        }
                        ToolChipState::Denied => view! { <X class="text-muted-foreground" /> }.into_any(),
                    }}
                </MarkerIcon>
                <MarkerContent class=if state == ToolChipState::Running { "shimmer" } else { "" }>
                    <span class="flex flex-wrap gap-2 items-center">
                        <Badge variant=BadgeVariant::Outline class="font-mono text-[10px]">
                            {badge}
                        </Badge>
                        <span class="font-medium text-foreground">{message.text}</span>
                        {engine
                            .map(|label| {
                                view! { <Badge variant=BadgeVariant::Secondary>{label}</Badge> }
                            })}
                    </span>
                </MarkerContent>
            </Marker>
            {artifact.map(|artifact| view! { <ArtifactCard artifact=artifact /> })}
            {generated.map(|node| view! { <GenUi node=node /> })}
        </div>
    }
}

/// Parse a stored spec. An unparseable one is dropped rather than drawn as
/// an error: the prose beside it still answers the question.
fn parse_ui(raw: &serde_json::Value) -> Option<UiNode> {
    UiNode::from_event(Some(&serde_json::json!({ "ui": raw })))
}

/// Best-effort clipboard write. There is nothing useful to do when the
/// permission is refused, so a failure is silent rather than an error toast.
fn copy_to_clipboard(text: &str) {
    if let Some(clipboard) = web_sys::window().map(|w| w.navigator().clipboard()) {
        let _ = clipboard.write_text(text);
    }
}
