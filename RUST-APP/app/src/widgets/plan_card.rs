//! The plan checklist.
//!
//! Shown before any work starts and ticked as steps finish, so the owner can
//! see what Dex intends to do rather than reading about it afterwards.
//!
//! Deliberately **not** built on `ui::stepper`. That component derives every
//! row's state from a single "current step" index, which is right for a wizard
//! and wrong here: a Dex plan runs steps in parallel and one can fail while a
//! later one succeeds. Driving it from an index would have drawn three blue
//! ticks over a run that half failed — the exact bug
//! `conversation_store_test.dart` pins down. The stepper's visual vocabulary
//! (indicator circle, separator, title) is reused; its state model is not.

use icons::{Check, X};
use leptos::prelude::*;
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::card::{Card, CardContent, CardHeader, CardTitle};
use registry::ui::spinner::Spinner;

use dex_store::{PlanStep, PlanStepStatus};

use crate::copy;
use crate::state::use_app;

#[component]
pub fn PlanCard() -> impl IntoView {
    let app = use_app();
    let plan = Signal::derive(move || app.plan());
    // The view macro cannot parse a turbofish inside an attribute, so the
    // indexed list is built here rather than inline.
    let rows = Memo::new(move |_| {
        let steps = plan.get();
        let total = steps.len();
        steps
            .into_iter()
            .enumerate()
            .map(|(i, step)| (i, step, i + 1 == total))
            .collect::<Vec<_>>()
    });

    view! {
        <Show when=move || !plan.get().is_empty()>
            <Card class="w-full">
                <CardHeader class="flex-row gap-3 items-center">
                    <CardTitle class="text-sm">{copy::PLAN_TITLE}</CardTitle>
                    <PlanCounts plan=plan />
                </CardHeader>
                <CardContent class="pb-6">
                    <ol class="flex flex-col gap-0">
                        <For each=move || rows.get() key=|(i, step, _)| (*i, step.status) let:entry>
                            <PlanRow index=entry.0 step=entry.1 last=entry.2 />
                        </For>
                    </ol>
                </CardContent>
            </Card>
        </Show>
    }
}

/// "2/3" and, when anything failed, how much. The Flutter card shows both so a
/// run that half worked cannot read as a clean success.
#[component]
fn PlanCounts(plan: Signal<Vec<PlanStep>>) -> impl IntoView {
    let done = Signal::derive(move || {
        plan.get()
            .iter()
            .filter(|s| s.status == PlanStepStatus::Completed)
            .count()
    });
    let failed = Signal::derive(move || {
        plan.get()
            .iter()
            .filter(|s| s.status == PlanStepStatus::Failed)
            .count()
    });

    view! {
        <span class="flex gap-2 items-center ml-auto text-xs text-muted-foreground">
            <Show when=move || { failed.get() > 0 }>
                <Badge variant=BadgeVariant::Destructive>
                    {move || format!("{} failed", failed.get())}
                </Badge>
            </Show>
            <span>{move || format!("{}/{}", done.get(), plan.get().len())}</span>
        </span>
    }
}

#[component]
fn PlanRow(index: usize, step: PlanStep, last: bool) -> impl IntoView {
    let status = step.status;

    let indicator = match status {
        PlanStepStatus::Completed => "bg-primary text-primary-foreground border-primary",
        PlanStepStatus::Failed => "bg-destructive text-white border-destructive",
        PlanStepStatus::InProgress => "border-primary text-primary",
        PlanStepStatus::Pending => "border-border text-muted-foreground",
    };

    let label_class = match status {
        PlanStepStatus::Pending => "text-muted-foreground",
        PlanStepStatus::Failed => "text-destructive",
        _ => "text-foreground",
    };

    view! {
        <li class="flex relative gap-3 items-start">
            <div class="flex flex-col items-center self-stretch">
                <span
                    class=format!(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium {indicator}",
                    )
                    aria-hidden="true"
                >
                    {match status {
                        PlanStepStatus::Completed => view! { <Check class="size-3.5" /> }.into_any(),
                        PlanStepStatus::Failed => view! { <X class="size-3.5" /> }.into_any(),
                        PlanStepStatus::InProgress => {
                            view! { <Spinner class="size-3.5" /> }.into_any()
                        }
                        PlanStepStatus::Pending => {
                            view! { {(index + 1).to_string()} }.into_any()
                        }
                    }}
                </span>
                // The connector, omitted on the last row so the list ends clean.
                <Show when=move || !last>
                    <span class="flex-1 w-px min-h-4 bg-border" aria-hidden="true"></span>
                </Show>
            </div>
            <span class=format!("pt-0.5 pb-4 text-sm {label_class}")>{step.label}</span>
        </li>
    }
}
