//! The approval card.
//!
//! Safety-critical. Two rules from the Flutter client are load-bearing and are
//! kept exactly:
//!
//! 1. **The queue is shown, not hidden.** A fanned-out plan raises many cards
//!    at once; the count is on screen so the owner knows how many are waiting
//!    rather than discovering it as steps expire.
//! 2. **`step_version` is echoed verbatim.** The store holds it; this panel
//!    never rebuilds or reformats it. The core refuses a stale one, which is
//!    what stops an approval built for an older version of a step from
//!    approving a newer one.
//!
//! `Approve` is a hold-to-confirm button, per the spec's "this button for full
//! access and important things". `Deny` is a plain click: making refusal harder
//! than approval is the wrong way round.

use icons::{Check, ShieldAlert, X};
use leptos::prelude::*;
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::button::{Button, ButtonVariant};
use registry::ui::button_action::ButtonAction;
use registry::ui::card::{CardSize, Card, CardContent, CardHeader, CardTitle};
use registry::ui::scroll_area::ScrollArea;

use dex_protocol::ConfirmationVerdict;

use crate::copy;
use crate::state::use_app;

/// How long `Approve` must be held. Long enough to be deliberate, short enough
/// not to feel broken.
const HOLD_MS: u32 = 700;

#[component]
pub fn ApprovalPanel() -> impl IntoView {
    let app = use_app();
    let pending = Signal::derive(move || app.pending());
    let waiting = Signal::derive(move || app.approvals_waiting());

    view! {
        <Show when=move || pending.get().is_some()>
            <aside
                class="flex flex-col w-[380px] shrink-0 border-l border-border bg-sidenav"
                aria-label=copy::APPROVAL_HEADER
            >
                <header class="flex gap-2 items-center px-4 py-3 border-b border-border">
                    <ShieldAlert class="size-4 text-warning" />
                    <h2 class="text-sm font-medium">{copy::APPROVAL_HEADER}</h2>
                    <span class="sr-only">"pending approval"</span>
                    <Show when=move || { waiting.get() > 1 }>
                        <Badge variant=BadgeVariant::Secondary class="ml-auto">
                            {move || format!("{} waiting", waiting.get())}
                        </Badge>
                    </Show>
                </header>

                <ScrollArea class="min-h-0 grow">
                    <div class="flex flex-col gap-4 p-4">
                        {move || {
                            pending
                                .get()
                                .map(|preview| {
                                    view! {
                                        <Card size=CardSize::Sm>
                                            <CardHeader class="pt-4">
                                                <CardTitle class="text-sm">{preview.title}</CardTitle>
                                            </CardHeader>
                                            <CardContent class="pb-4">
                                                <ul class="flex flex-col gap-1.5">
                                                    {preview
                                                        .steps
                                                        .into_iter()
                                                        .map(|step| {
                                                            view! {
                                                                <li class="font-mono text-xs break-all text-muted-foreground">
                                                                    {step.text}
                                                                </li>
                                                            }
                                                        })
                                                        .collect_view()}
                                                </ul>
                                            </CardContent>
                                        </Card>
                                    }
                                })
                        }}

                        // The whole reason Full Access exists, said plainly and
                        // only when the queue is actually long enough to hurt.
                        <Show when=move || { waiting.get() > 1 }>
                            <p class="text-xs text-muted-foreground">
                                {move || copy::approval_queue_warning(waiting.get())}
                            </p>
                        </Show>
                    </div>
                </ScrollArea>

                <footer class="flex flex-col gap-2 p-4 border-t border-border">
                    // ButtonAction defaults to the destructive variant; a red
                    // "Approve" would read as the dangerous choice.
                    <ButtonAction
                        duration_ms=HOLD_MS
                        variant=ButtonVariant::Default
                        class="w-full"
                        on_complete=Callback::new(move |()| {
                            app.respond(ConfirmationVerdict::Approved);
                        })
                    >
                        <Check />
                        <span>{copy::APPROVAL_APPROVE}</span>
                    </ButtonAction>

                    <Show when=move || { waiting.get() > 1 }>
                        <ButtonAction
                            duration_ms=HOLD_MS
                            variant=ButtonVariant::Secondary
                            class="w-full"
                            on_complete=Callback::new(move |()| {
                                app.respond_all(ConfirmationVerdict::Approved);
                            })
                        >
                            <Check />
                            <span>{move || copy::approval_approve_all(waiting.get())}</span>
                        </ButtonAction>
                    </Show>

                    <Button
                        variant=ButtonVariant::Outline
                        class="w-full"
                        on:click=move |_| app.respond(ConfirmationVerdict::Rejected)
                    >
                        <X />
                        {copy::APPROVAL_DENY}
                    </Button>
                </footer>
            </aside>
        </Show>
    }
}
