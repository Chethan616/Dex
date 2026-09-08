//! The conversation reducer.
//!
//! `apply(frame)` is the whole thing: frames in, drawable state out. It is a
//! pure function of the frames it has seen, which is why it lives in a crate
//! with no UI framework and no socket — the tests below drive it directly.
//!
//! Ported from `app/lib/core/state/conversation_store.dart`, whose behaviour is
//! specified by `app/test/conversation_store_test.dart`. Every non-obvious rule
//! here exists because something was visibly wrong on screen without it; those
//! reasons are kept in the comments.

use dex_protocol::{
    ConfirmationRequest, ConfirmationVerdict, DexFrame, DexFrameKind, EventType, Inbound,
};
use serde_json::Value;

use crate::models::{
    ActionPreview, AgentState, EngineId, Message, MessageSpeaker, PlanStep, PlanStepStatus,
    PreviewStep, ToolActivity, ToolActivityState, ToolChipState,
};

/// Activities kept before the oldest is dropped. Matches the Flutter client.
const MAX_ACTIVITIES: usize = 50;

#[derive(Debug, Default)]
pub struct Store {
    pub messages: Vec<Message>,
    pub state: AgentStateCell,
    pub plan: Vec<PlanStep>,
    pub activities: Vec<ToolActivity>,
    /// A queue, not a slot.
    ///
    /// The Orchestrator runs every step whose dependencies are met in parallel,
    /// so a fanned-out plan raises many cards at once. Holding one meant the
    /// rest were never shown, went unanswered, and expired at their 120s
    /// timeout — on screen, ten steps failing together at "2m 0s".
    pub approvals: Vec<ConfirmationRequest>,
    pub conversation_id: String,
    pub active_request_id: Option<String>,
    /// Monotonic stand-in for a clock, so ordering is deterministic in tests.
    tick: f64,
}

/// Wrapper so `Store` can derive `Default` with a non-`Idle`-defaulting enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentStateCell(pub AgentState);

impl Default for AgentStateCell {
    fn default() -> Self {
        Self(AgentState::Idle)
    }
}

impl Store {
    #[must_use]
    pub fn new(conversation_id: impl Into<String>) -> Self {
        Self {
            conversation_id: conversation_id.into(),
            ..Default::default()
        }
    }

    #[must_use]
    pub fn state(&self) -> AgentState {
        self.state.0
    }

    #[must_use]
    pub fn is_busy(&self) -> bool {
        self.state.0.is_busy()
    }

    /// The step currently running, if any. Drives the inline spinner.
    #[must_use]
    pub fn current_activity(&self) -> Option<&ToolActivity> {
        self.activities
            .iter()
            .find(|a| a.state == ToolActivityState::Running)
    }

    /// The engine pill shown beside a running step.
    #[must_use]
    pub fn running_engine_chip(&self) -> Option<EngineId> {
        self.current_activity().and_then(|a| a.engine)
    }

    #[must_use]
    pub fn approvals_waiting(&self) -> usize {
        self.approvals.len()
    }

    /// The card on screen: the oldest unanswered approval, because it is
    /// closest to its own timeout.
    #[must_use]
    pub fn pending(&self) -> Option<ActionPreview> {
        self.approvals.first().map(|r| preview_of(r, self.tick))
    }

    /// Start a fresh thread. The id must change, or history conflates them.
    pub fn new_conversation(&mut self, id: impl Into<String>) {
        self.messages.clear();
        self.plan.clear();
        self.activities.clear();
        self.approvals.clear();
        self.state = AgentStateCell(AgentState::Idle);
        self.active_request_id = None;
        self.conversation_id = id.into();
    }

    /// Record the owner's message and the intent to send it.
    ///
    /// Anything still waiting for an answer is dropped: those cards belong to
    /// the turn being replaced, and leaving them on screen invites approving
    /// a step from a task the owner has already moved on from.
    pub fn send_human_message(&mut self, text: &str) -> Inbound {
        self.approvals.clear();
        self.plan.clear();
        let ts = self.next_tick();
        self.messages.push(Message::human(text, ts));
        self.state = AgentStateCell(AgentState::Thinking);
        Inbound::submit(text, Some(self.conversation_id.clone()))
    }

    /// Answer the visible card and immediately show the next.
    ///
    /// The queue is advanced here rather than on the core's acknowledgement: a
    /// gap between cards reads as a step quietly expiring.
    pub fn respond(&mut self, verdict: ConfirmationVerdict) -> Option<Inbound> {
        if self.approvals.is_empty() {
            return None;
        }
        let request = self.approvals.remove(0);

        if self.approvals.is_empty() {
            // Nothing left to answer, so the run resumes.
            self.state = AgentStateCell(AgentState::Acting);
        }

        Some(Inbound::Respond {
            request_id: request.request_id,
            step_id: request.step_id,
            // Echoed verbatim: it is a content hash of the step as shown, and
            // the core refuses one built for an older version.
            step_version: request.step_version,
            verdict,
        })
    }

    /// Answer every queued card. Still one verdict per step — the core has no
    /// bulk form, and inventing one client-side would approve steps the owner
    /// never saw.
    pub fn respond_all(&mut self, verdict: ConfirmationVerdict) -> Vec<Inbound> {
        let mut sent = Vec::new();
        while let Some(message) = self.respond(verdict) {
            sent.push(message);
        }
        sent
    }

    /// The single entry point. Everything the UI shows is a consequence of the
    /// frames passed here.
    pub fn apply(&mut self, frame: &DexFrame) {
        match frame.kind {
            DexFrameKind::Step => self.apply_step(frame),
            DexFrameKind::Confirmation => self.apply_confirmation(frame),
            DexFrameKind::ConfirmationClosed => self.apply_confirmation_closed(frame),
            DexFrameKind::Result => self.apply_result(frame),
            DexFrameKind::Error => self.apply_error(frame),
        }
    }

    fn apply_step(&mut self, frame: &DexFrame) {
        let Some(event) = frame.event.as_ref() else {
            return;
        };
        self.active_request_id = Some(event.request_id.clone());

        match event.event_type {
            EventType::Thinking | EventType::Routing => {
                self.state = AgentStateCell(AgentState::Thinking);
            }
            EventType::Planning => {
                self.plan = plan_from(event.data.as_ref());
                self.state = AgentStateCell(AgentState::Acting);
            }
            EventType::Selecting => self.begin_activity(frame),
            EventType::Dispatching | EventType::Executing | EventType::Retrying => {
                if let Some(activity) = self.activity_mut(frame)
                    && !frame.message.is_empty()
                {
                    activity.output_lines.push(frame.message.clone());
                }
            }
            EventType::Awaiting => self.state = AgentStateCell(AgentState::Awaiting),
            EventType::Done => self.finish_step(frame, true),
            EventType::Failed => self.finish_step(frame, false),
            EventType::Cancelled => {
                self.close_running(ToolActivityState::Aborted);
                self.state = AgentStateCell(AgentState::Idle);
            }
        }
    }

    /// `selecting` is where a step becomes visible.
    ///
    /// The card and the inline chip are created here, while the step is still
    /// running. A card that only appears once the step is over is the failure
    /// this whole surface exists to fix.
    fn begin_activity(&mut self, frame: &DexFrame) {
        let Some(key) = activity_key(frame) else {
            return;
        };
        let data = frame.event.as_ref().and_then(|e| e.data.as_ref());
        let action = string_field(data, "action").unwrap_or_else(|| "step".to_owned());
        let engine = string_field(data, "capability")
            .as_deref()
            .and_then(EngineId::from_capability);

        let display_name = friendly_name(&action);

        self.activities.push(ToolActivity {
            call_id: key.clone(),
            tool_id: action.clone(),
            display_name: display_name.clone(),
            engine,
            output_lines: Vec::new(),
            summary: None,
            ok: None,
            state: ToolActivityState::Running,
        });
        if self.activities.len() > MAX_ACTIVITIES {
            self.activities.remove(0);
        }

        let ts = self.next_tick();
        self.messages.push(Message {
            id: key.clone(),
            speaker: MessageSpeaker::ToolChip,
            text: display_name,
            ts,
            request_id: frame.request_id.clone(),
            call_id: Some(key),
            tool_id: Some(action),
            chip_state: Some(ToolChipState::Running),
            engine,
            artifact: None,
            ui: None,
        });

        self.mark_plan(frame, PlanStepStatus::InProgress);
        self.state = AgentStateCell(AgentState::Acting);
    }

    fn finish_step(&mut self, frame: &DexFrame, ok: bool) {
        // A terminal event without a step id closes the *task*, not a step.
        // On `done` the `result` frame carries the actual answer, so this one
        // is deliberately ignored rather than printed as a duplicate line.
        let Some(key) = activity_key(frame) else {
            if !ok && !frame.message.is_empty() {
                let ts = self.next_tick();
                self.messages.push(Message::agent(
                    frame.message.clone(),
                    ts,
                    frame.request_id.clone(),
                ));
                self.state = AgentStateCell(AgentState::Error);
            }
            return;
        };

        let artifact = frame.event.as_ref().and_then(dex_protocol::DexEvent::artifact);
        let generated = frame.event.as_ref().and_then(dex_protocol::DexEvent::ui);
        let summary = (!frame.message.is_empty()).then(|| frame.message.clone());

        if let Some(activity) = self.activities.iter_mut().find(|a| a.call_id == key) {
            activity.state = if ok {
                ToolActivityState::Done
            } else {
                ToolActivityState::Failed
            };
            activity.ok = Some(ok);
            activity.summary = summary.clone();
        }

        if let Some(message) = self
            .messages
            .iter_mut()
            .find(|m| m.call_id.as_deref() == Some(key.as_str()))
        {
            message.chip_state = Some(if ok {
                ToolChipState::Done
            } else {
                ToolChipState::Failed
            });
            if artifact.is_some() {
                message.artifact = artifact;
            }
            if generated.is_some() {
                message.ui = generated;
            }
        }

        self.mark_plan(
            frame,
            if ok {
                PlanStepStatus::Completed
            } else {
                PlanStepStatus::Failed
            },
        );
    }

    fn apply_confirmation(&mut self, frame: &DexFrame) {
        let Some(request) = frame.confirmation.as_ref() else {
            return;
        };
        // The same card can arrive twice on a reconnect; queueing it twice
        // would ask the owner the same question two ways.
        let already = self.approvals.iter().any(|existing| {
            existing.request_id == request.request_id && existing.step_id == request.step_id
        });
        if !already {
            self.approvals.push(request.clone());
        }
        self.state = AgentStateCell(AgentState::Awaiting);
    }

    /// A card can be withdrawn from anywhere in the queue, not just the head:
    /// an expiry in the middle must not disturb the one on screen.
    fn apply_confirmation_closed(&mut self, frame: &DexFrame) {
        let Some(request_id) = frame.request_id.as_deref() else {
            return;
        };
        self.approvals.retain(|existing| {
            existing.request_id != request_id
                || frame
                    .step_id
                    .as_deref()
                    .is_some_and(|step| existing.step_id != step)
        });
        if self.approvals.is_empty() && self.state.0 == AgentState::Awaiting {
            self.state = AgentStateCell(AgentState::Acting);
        }
    }

    fn apply_result(&mut self, frame: &DexFrame) {
        // A step still running when the task ends would otherwise spin
        // forever, which reads worse than an unknown outcome.
        self.close_running(ToolActivityState::Aborted);

        let generated = frame.result.as_ref().and_then(|r| r.ui.clone());
        if !frame.message.is_empty() || generated.is_some() {
            let ts = self.next_tick();
            let mut message = Message::agent(
                frame.message.clone(),
                ts,
                frame.request_id.clone(),
            );
            message.ui = generated;
            self.messages.push(message);
        }

        let failed = frame
            .result
            .as_ref()
            .and_then(|r| r.status.as_deref())
            .is_some_and(|s| matches!(s, "FAILED" | "ABORTED"));

        self.state = AgentStateCell(if failed {
            AgentState::Error
        } else {
            AgentState::Idle
        });
        self.approvals.clear();
        self.active_request_id = None;
    }

    fn apply_error(&mut self, frame: &DexFrame) {
        self.close_running(ToolActivityState::Aborted);
        if !frame.message.is_empty() {
            let ts = self.next_tick();
            self.messages
                .push(Message::agent(frame.message.clone(), ts, None));
        }
        self.state = AgentStateCell(AgentState::Error);
    }

    fn close_running(&mut self, as_state: ToolActivityState) {
        for activity in &mut self.activities {
            if activity.state == ToolActivityState::Running {
                activity.state = as_state;
                activity.ok = Some(false);
            }
        }
        for message in &mut self.messages {
            if message.chip_state == Some(ToolChipState::Running) {
                message.chip_state = Some(ToolChipState::Failed);
            }
        }
    }

    fn activity_mut(&mut self, frame: &DexFrame) -> Option<&mut ToolActivity> {
        let key = activity_key(frame)?;
        self.activities.iter_mut().find(|a| a.call_id == key)
    }

    /// Tick the plan row this step belongs to.
    fn mark_plan(&mut self, frame: &DexFrame, status: PlanStepStatus) {
        let Some(index) = frame.step_id.as_deref().and_then(plan_index) else {
            return;
        };

        if let Some(row) = self.plan.get_mut(index) {
            row.status = status;
            return;
        }

        // A repaired plan can emit ids past the end of the checklist we drew.
        // Falling back to the first unfinished row keeps the count honest
        // rather than silently dropping the update.
        if let Some(row) = self
            .plan
            .iter_mut()
            .find(|r| r.status == PlanStepStatus::Pending || r.status == PlanStepStatus::InProgress)
        {
            row.status = status;
        }
    }

    fn next_tick(&mut self) -> f64 {
        self.tick += 1.0;
        self.tick
    }
}

/// A string field out of an event's untyped `data` bag.
fn string_field(data: Option<&Value>, key: &str) -> Option<String> {
    data?.get(key)?.as_str().map(str::to_owned)
}

/// `"{request_id}:{step_id}"`, or `None` for a task-level event.
fn activity_key(frame: &DexFrame) -> Option<String> {
    let step = frame.step_id.as_deref()?;
    let request = frame.request_id.as_deref().unwrap_or_default();
    Some(format!("{request}:{step}"))
}

/// The plan row a step id refers to.
///
/// The **last** number wins. A repaired plan emits `step_1_step_1` and
/// `step_1_step_2`; reading the first number made both of them step one, so
/// the checklist stayed at 1/2 with a hollow circle beside finished work.
fn plan_index(step_id: &str) -> Option<usize> {
    let mut last: Option<usize> = None;
    let mut digits = String::new();
    for ch in step_id.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else if !digits.is_empty() {
            last = digits.parse().ok();
            digits.clear();
        }
    }
    if !digits.is_empty() {
        last = digits.parse().ok();
    }
    last.and_then(|n| n.checked_sub(1))
}

fn plan_from(data: Option<&Value>) -> Vec<PlanStep> {
    let Some(steps) = data.and_then(|d| d.get("steps")).and_then(Value::as_array) else {
        return Vec::new();
    };
    steps
        .iter()
        .map(|step| PlanStep {
            label: label_for(step),
            status: PlanStepStatus::Pending,
        })
        .collect()
}

/// "set volume — level 35".
///
/// The parameters are what make the checklist readable: "set volume" alone
/// does not say what is about to happen. Two are enough for one line.
fn label_for(step: &Value) -> String {
    let action = step
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("step")
        .replace('_', " ");

    let Some(params) = step.get("params").and_then(Value::as_object) else {
        return action;
    };

    let described: Vec<String> = params
        .iter()
        .take(2)
        .map(|(key, value)| format!("{} {}", key.replace('_', " "), scalar(value)))
        .collect();

    if described.is_empty() {
        action
    } else {
        format!("{action} \u{2014} {}", described.join(", "))
    }
}

fn scalar(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(scalar).collect::<Vec<_>>().join(" "),
        other => other.to_string(),
    }
}

/// Tool id to something a person would say. From `core/tool_registry.dart:20`.
fn friendly_name(action: &str) -> String {
    match action {
        "click_element" | "type_text" | "focus_window" => "Windows app".to_owned(),
        "navigate" | "browse" | "run_task" => "Browser".to_owned(),
        "run_shell" | "run_command" => "Shell".to_owned(),
        "list_processes" | "kill_process" | "launch_app" => "Process".to_owned(),
        "read_document" | "describe_file" | "find_files" => "File read".to_owned(),
        "write_file" => "File write".to_owned(),
        "edit_file" | "apply_patch" => "File edit".to_owned(),
        other => other.replace('_', " "),
    }
}

/// The approval card. It shows what will actually happen — the parameters —
/// rather than only the step's name.
fn preview_of(request: &ConfirmationRequest, ts: f64) -> ActionPreview {
    let mut steps = Vec::new();
    if !request.description.is_empty() {
        steps.push(PreviewStep {
            text: request.description.clone(),
        });
    }
    for (key, value) in request.params.iter().take(4) {
        steps.push(PreviewStep {
            text: format!("{}: {}", key.replace('_', " "), scalar(value)),
        });
    }
    if steps.is_empty() {
        steps.push(PreviewStep {
            text: request.action.replace('_', " "),
        });
    }

    ActionPreview {
        id: format!("{}:{}", request.request_id, request.step_id),
        title: if request.description.is_empty() {
            // Matches `conversation_store.dart:546`.
            "Approval needed".to_owned()
        } else {
            request.description.clone()
        },
        steps,
        ts,
        is_approval_request: true,
    }
}
