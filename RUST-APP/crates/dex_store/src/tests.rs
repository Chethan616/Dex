//! Ported from `app/test/conversation_store_test.dart`.
//!
//! The store turns Dex's plan stream into what the app draws. The whole reason
//! that surface exists is on this page: the owner wanted to watch steps happen,
//! not read a summary once they were over. So these check that a step is on
//! screen *while it runs* — a card that only appears at the end is the failure
//! being fixed, and it would pass any test that only looked at the final state.

use dex_protocol::{
    ConfirmationRequest, ConfirmationVerdict, DexEvent, DexFrame, DexFrameKind, EventType,
    GatewayResult,
};
use serde_json::{Value, json};

use crate::models::{AgentState, MessageSpeaker, PlanStepStatus, ToolActivityState};
use crate::store::Store;

/// A step event, matching the Dart helper of the same name.
fn step(
    event_type: EventType,
    request: &str,
    step_id: Option<&str>,
    message: &str,
    data: Option<Value>,
) -> DexFrame {
    let event = DexEvent {
        event_type,
        message: message.to_owned(),
        request_id: request.to_owned(),
        step_id: step_id.map(str::to_owned),
        timestamp: 0.0,
        data,
    };
    DexFrame {
        kind: DexFrameKind::Step,
        message: message.to_owned(),
        request_id: Some(request.to_owned()),
        step_id: step_id.map(str::to_owned),
        event: Some(event),
        confirmation: None,
        result: None,
    }
}

fn planning(steps: Value) -> DexFrame {
    step(
        EventType::Planning,
        "req-1",
        None,
        "Plan",
        Some(json!({ "steps": steps })),
    )
}

fn selecting(request: &str, step_id: &str, capability: &str, action: &str) -> DexFrame {
    step(
        EventType::Selecting,
        request,
        Some(step_id),
        "selected",
        Some(json!({ "capability": capability, "action": action })),
    )
}

fn approval(request: &str, step_id: &str) -> DexFrame {
    let confirmation = ConfirmationRequest {
        request_id: request.to_owned(),
        step_id: step_id.to_owned(),
        step_version: format!("v-{step_id}"),
        capability: "can_control_os".to_owned(),
        action: "run_command".to_owned(),
        params: json!({ "command": ["powercfg", "/setactive", step_id] })
            .as_object()
            .cloned()
            .unwrap_or_default(),
        tier: 2,
        description: "Run a command".to_owned(),
        created_at: 0.0,
        expires_at: 0.0,
    };
    DexFrame {
        kind: DexFrameKind::Confirmation,
        message: confirmation.description.clone(),
        request_id: Some(request.to_owned()),
        step_id: Some(step_id.to_owned()),
        event: None,
        confirmation: Some(confirmation),
        result: None,
    }
}

fn result(status: &str, message: &str) -> DexFrame {
    DexFrame {
        kind: DexFrameKind::Result,
        message: message.to_owned(),
        request_id: Some("req-1".to_owned()),
        step_id: None,
        event: None,
        confirmation: None,
        result: Some(GatewayResult {
            status: Some(status.to_owned()),
            summary: Some("Retrieve the system volume".to_owned()),
            request_id: Some("req-1".to_owned()),
            answer: Some(message.to_owned()),
            needs_clarification: None,
            ui: None,
        }),
    }
}

fn store() -> Store {
    Store::new("c-test")
}

#[test]
fn the_plan_appears_before_any_work_starts() {
    let mut s = store();
    s.apply(&planning(json!([
        { "action": "get_volume", "params": {} },
        { "action": "set_volume", "params": { "level": 35 } },
    ])));

    assert_eq!(s.plan.len(), 2);
    assert_eq!(s.plan[0].label, "get volume");
    // Parameters make the checklist readable: "set volume — level 35" says
    // what will happen; "set_volume" does not.
    assert!(s.plan[1].label.contains("level 35"), "{}", s.plan[1].label);
    assert!(s.plan.iter().all(|p| p.status == PlanStepStatus::Pending));
}

#[test]
fn a_repaired_plan_ticks_the_step_that_actually_finished() {
    // Real ids from a repaired plan: `step_1_step_1` and `step_1_step_2`.
    // Reading the first number in each made both of them step one, so the
    // second step ran, finished, and the checklist stayed at 1/2 with a hollow
    // circle beside work that was already done.
    let mut s = store();
    s.apply(&planning(json!([
        { "action": "find_files", "params": { "query": "aadhar" } },
        { "action": "find_files", "params": { "query": "aadhaar" } },
    ])));

    s.apply(&step(EventType::Done, "req-1", Some("step_1_step_1"), "Verified", None));
    s.apply(&step(EventType::Done, "req-1", Some("step_1_step_2"), "Verified", None));

    assert!(
        s.plan.iter().all(|p| p.status == PlanStepStatus::Completed),
        "both steps finished, so both rows must be ticked: {:?}",
        s.plan
    );
}

#[test]
fn a_file_search_is_drawn_as_a_card_not_read_out() {
    let mut s = store();
    s.apply(&planning(json!([
        { "action": "find_files", "params": { "query": "aadhar" } },
    ])));
    s.apply(&selecting("req-1", "step_1", "can_control_files", "find_files"));
    s.apply(&step(
        EventType::Done,
        "req-1",
        Some("step_1"),
        "Verified",
        Some(json!({
            "artifact": {
                "kind": "files",
                "title": "2 files found",
                "total": 2,
                "items": [
                    { "label": "aadhar.pdf", "detail": "C:/Users/cheth/aadhar.pdf" },
                    { "label": "scan001.jpg", "detail": "C:/Users/cheth/scan001.jpg" },
                ],
            },
        })),
    ));

    let chip = s
        .messages
        .iter()
        .rev()
        .find(|m| m.speaker == MessageSpeaker::ToolChip)
        .expect("a tool chip should have been drawn");
    let artifact = chip.artifact.as_ref().expect("the card is the evidence");
    assert_eq!(artifact.items.len(), 2);
    assert_eq!(artifact.items[0].label, "aadhar.pdf");
}

#[test]
fn a_failed_step_is_drawn_as_failed_not_ticked() {
    // Three steps, two of which failed in a tenth of a second each. The
    // checklist read 3/3 with three blue ticks, which said the task had gone
    // fine while the transcript directly above it said the opposite.
    let mut s = store();
    s.apply(&planning(json!([
        { "action": "find_files", "params": { "query": "UI.png" } },
        { "action": "run_command", "params": {} },
        { "action": "trace_image", "params": {} },
    ])));

    s.apply(&step(EventType::Done, "req-1", Some("step_1"), "Verified", None));
    s.apply(&step(EventType::Failed, "req-1", Some("step_2"), "could not be resolved", None));
    s.apply(&step(EventType::Failed, "req-1", Some("step_3"), "could not be resolved", None));

    assert_eq!(s.plan[0].status, PlanStepStatus::Completed);
    assert_eq!(s.plan[1].status, PlanStepStatus::Failed);
    assert_eq!(s.plan[2].status, PlanStepStatus::Failed);
}

#[test]
fn a_step_is_visible_while_it_is_still_running() {
    let mut s = store();
    s.apply(&planning(json!([
        { "action": "get_volume", "params": {} },
    ])));
    s.apply(&selecting("req-1", "step_1", "can_control_os", "get_volume"));

    let running = s.current_activity().expect("no card while the step is running");
    assert_eq!(running.state, ToolActivityState::Running);
    assert_eq!(running.tool_id, "get_volume");
    assert_eq!(s.plan[0].status, PlanStepStatus::InProgress);
    assert_eq!(s.state(), AgentState::Acting);
    // And the inline chip, which is what appears in the transcript itself.
    assert!(s.running_engine_chip().is_some());
}

#[test]
fn finishing_a_step_carries_the_verification_not_just_a_tick() {
    let mut s = store();
    s.apply(&selecting("req-1", "step_1", "can_control_os", "get_volume"));
    s.apply(&step(
        EventType::Done,
        "req-1",
        Some("step_1"),
        "SystemAgent verified it: Endpoint reports 30%",
        None,
    ));

    let activity = &s.activities[0];
    assert_eq!(activity.state, ToolActivityState::Done);
    assert_eq!(activity.ok, Some(true));
    // The sentence the owner reads is the evidence, not "done".
    let summary = activity.summary.as_deref().unwrap_or_default();
    assert!(summary.contains("30%"), "{summary}");
    assert!(s.current_activity().is_none());
}

#[test]
fn a_failed_step_is_marked_failed_not_quietly_finished() {
    let mut s = store();
    s.apply(&selecting("req-1", "step_1", "can_control_app", "click_element"));
    s.apply(&step(
        EventType::Failed,
        "req-1",
        Some("step_1"),
        "No control named \"1920 x 1080\"",
        None,
    ));

    assert_eq!(s.activities[0].state, ToolActivityState::Failed);
    assert_eq!(s.activities[0].ok, Some(false));
}

#[test]
fn steps_from_a_new_task_do_not_reach_back_into_the_last_one() {
    // Step ids are per-request: every task has a step_1. Keying a card on the
    // bare id made a new task's first step flip the previous task's first card
    // to "done" — seen on screen before this was fixed.
    let mut s = store();
    s.apply(&selecting("req-A", "step_1", "can_control_os", "get_dns"));
    s.apply(&step(EventType::Failed, "req-A", Some("step_1"), "daemon down", None));
    s.apply(&selecting("req-B", "step_1", "can_control_os", "get_volume"));
    s.apply(&step(EventType::Done, "req-B", Some("step_1"), "verified", None));

    assert_eq!(s.activities.len(), 2);
    let dns = s.activities.iter().find(|a| a.tool_id == "get_dns").expect("get_dns");
    let volume = s.activities.iter().find(|a| a.tool_id == "get_volume").expect("get_volume");
    assert_eq!(
        dns.state,
        ToolActivityState::Failed,
        "the earlier task was rewritten by the later one"
    );
    assert_eq!(volume.state, ToolActivityState::Done);
}

#[test]
fn a_confirmation_becomes_an_approval_card_carrying_its_step_version() {
    let mut s = store();
    let mut frame = approval("req-1", "step_2");
    if let Some(request) = frame.confirmation.as_mut() {
        request.description = "Change the display resolution".to_owned();
        request.action = "set_display".to_owned();
        request.params = json!({ "resolution": "1920x1080" })
            .as_object()
            .cloned()
            .unwrap_or_default();
    }
    s.apply(&frame);

    assert_eq!(s.state(), AgentState::Awaiting);
    let pending = s.pending().expect("a card should be on screen");
    assert!(pending.is_approval_request);
    // The card shows what will actually happen, not just the step's name.
    let shown = pending
        .steps
        .iter()
        .map(|p| p.text.clone())
        .collect::<Vec<_>>()
        .join(" | ");
    assert!(shown.contains("1920x1080"), "{shown}");
}

#[test]
fn the_closing_line_is_the_answer_not_a_restatement_of_the_task() {
    let mut s = store();
    s.apply(&result("COMPLETED", "Your volume is 30% and muted."));

    let last = s.messages.last().expect("a closing line");
    assert_eq!(last.speaker, MessageSpeaker::Agent);
    assert_eq!(last.text, "Your volume is 30% and muted.");
    assert_eq!(s.state(), AgentState::Idle);
}

#[test]
fn a_step_still_running_when_the_task_ends_does_not_spin_forever() {
    let mut s = store();
    s.apply(&selecting("req-1", "step_1", "can_control_os", "get_volume"));
    // No terminal event for the step — the task just ends.
    s.apply(&result("COMPLETED", "done"));

    assert!(
        s.current_activity().is_none(),
        "a spinner left running forever is worse than an unknown outcome"
    );
}

#[test]
fn each_capability_routes_to_the_engine_pill_the_ui_already_draws() {
    let mut s = store();
    for (capability, action) in [
        ("can_control_os", "get_dns"),
        ("can_control_app", "click_element"),
        ("can_browse_web", "navigate"),
        ("can_control_gui", "run_task"),
    ] {
        s.apply(&selecting(capability, "step_1", capability, action));
    }
    assert_eq!(s.activities.iter().filter(|a| a.engine.is_some()).count(), 4);
}

#[test]
fn a_done_without_a_step_id_is_ignored() {
    // The `result` frame closes the turn; printing this too would duplicate
    // the closing line.
    let mut s = store();
    s.apply(&step(EventType::Done, "req-1", None, "Done: something", None));
    assert!(s.messages.is_empty(), "{:?}", s.messages);
}

#[test]
fn starting_a_new_chat_starts_a_new_thread() {
    let mut s = store();
    s.apply(&result("COMPLETED", "hello"));
    let before = s.conversation_id.clone();

    s.new_conversation("c-next");

    assert_ne!(s.conversation_id, before);
    assert!(s.messages.is_empty());
}

mod approvals_queue_rather_than_overwrite {
    // The bug this replaces, exactly as it happened: a plan produced twelve
    // independent run_command steps. The Orchestrator runs everything whose
    // dependencies are met in parallel, so twelve cards were raised at once.
    // The store held one. The other eleven were never shown, went unanswered,
    // and expired at their 120-second timeout — on screen, ten steps failing
    // simultaneously at "2m 0s" and the task stopping two steps from the end.
    use super::*;

    #[test]
    fn twelve_at_once_are_all_kept() {
        let mut s = store();
        for i in 1..=12 {
            s.apply(&approval("req-1", &format!("step_{i}")));
        }
        assert_eq!(
            s.approvals_waiting(),
            12,
            "eleven approvals were dropped and expired unseen"
        );
        assert!(s.pending().is_some());
        assert_eq!(s.state(), AgentState::Awaiting);
    }

    #[test]
    fn the_first_raised_is_the_first_shown() {
        let mut s = store();
        s.apply(&approval("req-1", "step_1"));
        s.apply(&approval("req-1", "step_2"));
        // Oldest first: it is closest to its own timeout.
        let pending = s.pending().expect("a card");
        assert!(pending.id.contains("step_1"), "{}", pending.id);
    }

    #[test]
    fn answering_one_immediately_shows_the_next() {
        let mut s = store();
        s.apply(&approval("req-1", "step_1"));
        s.apply(&approval("req-1", "step_2"));

        let sent = s.respond(ConfirmationVerdict::Approved);
        assert!(sent.is_some());

        assert_eq!(s.approvals_waiting(), 1);
        let pending = s.pending().expect("the next card");
        assert!(
            pending.id.contains("step_2"),
            "a gap between cards is a step quietly expiring: {}",
            pending.id
        );
        assert_eq!(s.state(), AgentState::Awaiting);
    }

    #[test]
    fn answering_the_last_one_leaves_none_and_resumes() {
        let mut s = store();
        s.apply(&approval("req-1", "step_1"));
        s.respond(ConfirmationVerdict::Approved);

        assert_eq!(s.approvals_waiting(), 0);
        assert!(s.pending().is_none());
        assert_eq!(s.state(), AgentState::Acting);
    }

    #[test]
    fn approve_all_clears_the_queue() {
        let mut s = store();
        for i in 1..=12 {
            s.apply(&approval("req-1", &format!("step_{i}")));
        }
        let sent = s.respond_all(ConfirmationVerdict::Approved);

        assert_eq!(sent.len(), 12, "one verdict per step, never a bulk approve");
        assert_eq!(s.approvals_waiting(), 0);
        assert!(s.pending().is_none());
    }

    #[test]
    fn a_withdrawn_approval_is_removed_from_the_middle_not_just_the_head() {
        let mut s = store();
        s.apply(&approval("req-1", "step_1"));
        s.apply(&approval("req-1", "step_2"));
        s.apply(&approval("req-1", "step_3"));

        // step_2 expires while step_1 is still on screen.
        s.apply(&DexFrame {
            kind: DexFrameKind::ConfirmationClosed,
            message: String::new(),
            request_id: Some("req-1".to_owned()),
            step_id: Some("step_2".to_owned()),
            event: None,
            confirmation: None,
            result: None,
        });

        assert_eq!(s.approvals_waiting(), 2);
        let pending = s.pending().expect("the visible card");
        assert!(
            pending.id.contains("step_1"),
            "withdrawing a queued card must not disturb the visible one: {}",
            pending.id
        );
    }

    #[test]
    fn the_same_approval_arriving_twice_is_only_queued_once() {
        let mut s = store();
        s.apply(&approval("req-1", "step_1"));
        s.apply(&approval("req-1", "step_1"));
        assert_eq!(s.approvals_waiting(), 1);
    }

    #[test]
    fn a_new_turn_clears_anything_left_unanswered() {
        let mut s = store();
        s.apply(&approval("req-1", "step_1"));
        s.apply(&approval("req-1", "step_2"));

        s.send_human_message("something else");

        assert_eq!(s.approvals_waiting(), 0);
        assert!(s.pending().is_none());
    }

    #[test]
    fn the_verdict_echoes_the_step_version_verbatim() {
        let mut s = store();
        s.apply(&approval("req-1", "step_7"));
        let sent = s.respond(ConfirmationVerdict::ApprovedSession).expect("a verdict");

        let json = serde_json::to_string(&sent).unwrap_or_default();
        assert!(json.contains("\"stepVersion\":\"v-step_7\""), "{json}");
        assert!(json.contains("\"verdict\":\"approved_session\""), "{json}");
    }
}
