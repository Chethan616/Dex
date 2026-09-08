//! Every user-facing string, carried over verbatim from the Flutter client.
//!
//! Kept in one file on purpose. The requirement was that the new app say
//! exactly what the old one said, and a single list is the only way to check
//! that by reading rather than by hunting through components.
//!
//! Source files are named against each block so a change upstream can be
//! traced back.

/// `app/lib/core/dex_taglines.dart:9`. One is picked per launch, like the CLI
/// banner, and typewritten on the home screen.
pub const TAGLINES: &[&str] = &[
    "A calm cockpit for commanding agents you can trust.",
    "Your terminal just grew claws — type something and let the bot pinch the busywork.",
    "I run on caffeine, JSON5, and the audacity of \"it worked on my machine.\"",
    "I speak fluent bash, mild sarcasm, and aggressive tab-completion energy.",
    "One CLI to rule them all, and one more restart because you changed the port.",
    "If it works, it's automation; if it breaks, it's a \"learning opportunity.\"",
    "Your .env is showing; don't worry, I'll pretend I didn't see it.",
    "I'll do the boring stuff while you dramatically stare at the logs like it's cinema.",
    "I'm not saying your workflow is chaotic... I'm just bringing a linter and a helmet.",
    "I don't judge, but your missing API keys are absolutely judging you.",
    "I can grep it, git blame it, and gently roast it — pick your coping mechanism.",
    "Hot reload for config, cold sweat for deploys.",
    "I keep secrets like a vault... unless you print them in debug logs again.",
    "Automation with claws: minimal fuss, maximal pinch.",
    "If you're lost, run doctor; if you're brave, run prod; if you're wise, run tests.",
    "I can't fix your code taste, but I can fix your build and your backlog.",
    "I'm not magic — I'm just extremely persistent with retries and coping strategies.",
    "I read logs so you can keep pretending you don't have to.",
    "If something's on fire, I can't extinguish it — but I can write a beautiful postmortem.",
    "I'll refactor your busywork like it owes me money.",
    "Less clicking, more shipping, fewer \"where did that file go\" moments.",
    "If it's repetitive, I'll automate it; if it's hard, I'll bring jokes and a rollback plan.",
    "I don't sleep, I just enter low-power mode and dream of clean diffs.",
    "Your personal assistant, minus the passive-aggressive calendar reminders.",
    "I've seen your commit messages. We'll work on that together.",
    "Running on your hardware, reading your logs, judging nothing (mostly).",
    "Self-hosted, self-updating, self-aware (just kidding... unless?).",
    "Somewhere between 'hello world' and 'oh god what have I built.'",
    "I'm the middleware between your ambition and your attention span.",
    "Making 'I'll automate that later' happen now.",
    "Your second brain, except this one actually remembers where you left things.",
    "I don't have opinions about tabs vs spaces. I have opinions about everything else.",
    "I've survived more breaking changes than your last three relationships.",
    "I'm not AI-powered, I'm AI-possessed. Big difference.",
    "You had me at 'dex gateway start.'",
];

/// `app/lib/screens/home_desktop.dart:51`.
pub const SUGGESTIONS: &[&str] = &[
    "Open Excel and total column B",
    "Find a file on this PC",
    "Take a screenshot of this app",
    "Summarise the open browser tab",
    "Read my last email",
    "Start a new project",
    "Draft a reply",
    "Show me what you can do",
];

/// `app/lib/widgets/home/empty_home.dart:145`.
pub const DISCLAIMER: &str =
    "Dex is an agent and may make mistakes. Every action shows a preview first.";

/// `app/lib/screens/home_desktop.dart:49` was a fixed "Hi there". By explicit
/// request the big home-screen heading now rotates too, one per launch like
/// [`TAGLINES`] and cached the same way — short, dialogue-style, in the same
/// self-aware voice as `dex_taglines.dart` rather than a generic greeting.
/// Not a Flutter source string; a deliberate exception to the verbatim rule.
pub const HEADINGS: &[&str] = &[
    "Hi there",
    "Hello there",
    "Hey, welcome back",
    "Look who's here",
    "Good to see you",
    "Ready when you are",
    "Reporting for duty",
    "Standing by",
    "At your service",
    "Online and caffeinated",
    "Awake and ready",
    "Booted and waiting",
    "Locked and loaded",
    "Present and accounted for",
    "What's the mission?",
    "What's first?",
    "What are we building?",
    "What's on the docket?",
    "What's the plan?",
    "Let's get to it",
    "Let's build something",
    "Let's make a mess",
    "Let's ship something",
    "Let's get weird",
    "Fire away",
    "All ears",
    "Your move",
    "Here to help",
    "Systems are up",
    "No fires, for now",
];
/// `app/lib/screens/home_desktop.dart:49` — the Flutter source's fixed
/// greeting, unused now that [`HEADINGS`] rotates, kept for the record.
pub const GREETING_NAME: &str = "there";
/// `app/lib/screens/home_desktop.dart:256`.
pub const SIDEBAR_USER: &str = "Dex user";
/// `app/lib/screens/home_desktop.dart:302`.
pub const CHAT_TITLE: &str = "Conversation";
/// `app/lib/widgets/composer/dex_composer.dart:32`.
pub const COMPOSER_PLACEHOLDER: &str = "Message Dex";

/// `app/lib/core/supervisor/supervisor.dart:92`.
pub struct BootStepCopy {
    pub id: &'static str,
    pub title: &'static str,
    pub running: &'static str,
    pub done: &'static str,
    /// A failed optional step still lets Dex open, degraded.
    pub optional: bool,
}

pub const BOOT_STEPS: &[BootStepCopy] = &[
    BootStepCopy {
        id: "preflight",
        title: "Checking the machine",
        running: "Looking for Node, Python and the Dex tree",
        done: "Everything Dex needs is here",
        optional: false,
    },
    BootStepCopy {
        id: "daemon",
        title: "Privileged daemon",
        running: "Waking the daemon that talks to Windows",
        done: "Daemon listening",
        optional: false,
    },
    BootStepCopy {
        id: "app",
        title: "App agent",
        running: "Starting UI Automation — driving apps without screenshots",
        done: "App agent ready",
        optional: false,
    },
    BootStepCopy {
        id: "desktop",
        title: "Vision agent",
        running: "Starting the screen-reading agent",
        done: "Vision agent ready",
        optional: true,
    },
    BootStepCopy {
        id: "browser",
        title: "Browser agent",
        running: "Starting the agent that uses the web",
        done: "Browser agent ready",
        optional: true,
    },
    BootStepCopy {
        id: "core",
        title: "Dex core",
        running: "Starting planning, verification and memory",
        done: "Dex is thinking",
        optional: false,
    },
];

/// `app/lib/widgets/connection_banner.dart:99`.
pub const BANNER_DISCONNECTED: (&str, &str) =
    ("disconnected", "Reconnecting to the Dex core…");
pub const BANNER_CONNECTING: (&str, &str) = ("connecting", "Opening the link to the Dex core…");
pub const BANNER_NO_CORE: (&str, &str) = (
    "core not running",
    "The Dex core is not listening. See %LOCALAPPDATA%\\DEX\\core.log",
);
pub const BANNER_READY: &str = "ready";
pub const BANNER_START_CORE: &str = "Start the core";
pub const BANNER_RETRY: &str = "Retry";

/// `app/lib/widgets/action_preview_card.dart`.
pub const APPROVAL_HEADER: &str = "Action Preview";
// "Approval needed" is the store's fallback title, in dex_store::store.
pub const APPROVAL_DENY: &str = "Deny";
pub const APPROVAL_APPROVE: &str = "Approve";
/// `:86` — the full sentence is built with the count.
#[must_use]
pub fn approval_queue_warning(waiting: usize) -> String {
    format!(
        "{waiting} steps need approving. Turn on Full Access in Settings to stop being asked."
    )
}
#[must_use]
pub fn approval_approve_all(waiting: usize) -> String {
    format!("Approve all {waiting}")
}

/// `app/lib/screens/splash_screen.dart`.
pub const SPLASH_TITLE: &str = "Dex";
pub const SPLASH_TRY_AGAIN: &str = "Try again";
pub const SPLASH_CONTINUE: &str = "Continue anyway";

/// `app/lib/widgets/dex_sidebar.dart`.
pub const NAV_NEW_CHAT: &str = "New chat";
pub const NAV_HEADING_AUTOMATE: &str = "Automate";
pub const NAV_WORKFLOWS: &str = "Workflows";
pub const NAV_SCHEDULES: &str = "Schedules";
pub const NAV_HEADING_MACHINE: &str = "This machine";
pub const NAV_CAPABILITIES: &str = "Capabilities";
pub const NAV_LOGS: &str = "Logs";
pub const NAV_SETTINGS: &str = "Settings";
pub const NAV_HISTORY: &str = "History";
pub const NAV_SEARCH_PLACEHOLDER: &str = "words anyone said…";
pub const NAV_COLLAPSE: &str = "Collapse sidebar";
pub const NAV_EXPAND: &str = "Expand sidebar";

/// Day buckets, `dex_sidebar.dart:367`.
pub const BUCKET_TODAY: &str = "Today";
pub const BUCKET_YESTERDAY: &str = "Yesterday";
pub const BUCKET_EARLIER: &str = "Earlier";

/// `app/lib/core/state/conversation_store.dart:304`.
pub const NOT_CONNECTED: &str =
    "The Dex core is not connected yet. It starts with the app — check the Logs if this does not clear.";
/// `:327`.
pub const STOPPING: &str = "Stopping…";

/// `app/lib/widgets/chat/task_plan_card.dart:41`.
pub const PLAN_TITLE: &str = "Plan";

/// Step badges, `app/lib/widgets/chat/step_row.dart:27`.
#[must_use]
pub fn step_badge(tool_id: &str) -> &'static str {
    match tool_id {
        t if t.contains("click") || t.contains("window") || t.contains("focus") => "WIN",
        t if t.contains("navigate") || t.contains("browse") => "WWW",
        t if t.contains("exec") || t.contains("bash") || t.contains("command") || t.contains("process") => "EXE",
        t if t.contains("parse_screen") || t.contains("omniparser") => "EYE",
        t if t.contains("message") || t.contains("send") => "MSG",
        t if t.contains("read") || t.contains("write") || t.contains("edit") || t.contains("patch") => "DOC",
        _ => "USE",
    }
}

/// `app/lib/widgets/composer/add_menu.dart:32`.
pub const ADD_MENU: &[(&str, &str)] = &[
    ("Add images or files", "Attach them to your next message"),
    ("Take screenshot", "Capture the screen and attach it"),
    ("Use connectors and apps", "See what Dex can reach right now"),
];

/// `app/lib/widgets/composer/composer_mode.dart:18`.
pub const MODES: &[(&str, &str, &str)] = &[
    ("Fast", "Haiku — enough for most automation", "haiku"),
    ("Smart", "Sonnet — better on long, multi-step tasks", "sonnet"),
    ("Think deeper", "Opus — for plans that keep coming out wrong", "opus"),
];

/// `app/lib/widgets/settings/settings_dialog.dart:34`.
pub const SETTINGS_TABS: &[(&str, &str)] = &[
    ("intelligence", "Intelligence"),
    ("preferences", "Preferences"),
    ("memory", "Memory"),
    ("account", "Account"),
    ("connectors", "Connectors & Apps"),
    ("diagnostics", "Diagnostics"),
    ("privacy", "Privacy"),
    ("about", "About"),
];

/// `app/lib/widgets/composer/dex_composer.dart:859`.
pub const PALETTE_HINT: &str = "↑↓ choose    ⏎ run";

/// `app/lib/screens/reminders_screen.dart`.
pub const REMINDERS_TITLE: &str = "Reminders";
pub const REMINDERS_PLACEHOLDER: &str = "Remind me to ...";
pub const REMINDERS_UPCOMING: &str = "Upcoming";
pub const REMINDERS_EMPTY: &str = "No reminders yet. Type one above and pick a time.";
pub const REMINDERS_BRIEFING_HEAD: &str = "About Dex";
pub const REMINDERS_BRIEFING_DISMISS: &str = "Got it";
/// `:289`.
pub const REMINDERS_BRIEFING: &str = "Dex is a Windows-first personal AI assistant. It drives your real apps with one-tap approval, sees what is on your screen when you ask, and helps you find files across your connected devices. Reminders let you tell Dex what to do later -- \"remind me to open vtop.vit.ac.in at 4pm\" -- and Dex surfaces them here so nothing slips. Tap the bell beside any row to cancel.";

/// `app/lib/widgets/settings/tabs/about_tab.dart`.
pub const ABOUT_TAGLINE: &str = "A calm cockpit for commanding agents you can trust.";
pub const ABOUT_OPEN_SOURCE: &str =
    "Built on open source: OpenClaw (agent core), Microsoft UFO² … MIT-licensed.";

/// `app/lib/widgets/settings/full_access_card.dart`.
pub const FULL_ACCESS_TITLE: &str = "Full Access";
pub const FULL_ACCESS_ON: &str = "Privileged steps run without asking.";
pub const FULL_ACCESS_OFF: &str =
    "Dex asks before each privileged step. A plan with a dozen of them means a dozen approvals.";
pub const FULL_ACCESS_UAC: &str = "One Windows prompt, once. After that a logon task runs the daemon elevated in your own session, so DNS, Wi-Fi, power plans and registry writes work without asking again.";
pub const FULL_ACCESS_RED: &str = "RED registry keys stay refused.";
pub const FULL_ACCESS_RED_DETAIL: &str = "Defender, Group Policy, services, Winlogon, LSA, autostart, UAC. Full Access does not unlock them.";
pub const FULL_ACCESS_HANDOFF: &str = "Hand-offs still reach you.";
pub const FULL_ACCESS_HANDOFF_DETAIL: &str = "No privilege lets Dex read a CAPTCHA or type a password it does not know. Those always stop and ask.";

/// `app/lib/widgets/settings/tabs/privacy_tab.dart`.
pub const PRIVACY_TITLE: &str = "Privacy";
pub const PRIVACY_CONTEXT: &str = "Context clues";
pub const PRIVACY_CONTEXT_DETAIL: &str = "Allow Dex to read the current window, open tabs, or what is on screen to give better answers. Everything stays on this machine.";
pub const PRIVACY_DIAGNOSTICS: &str = "Share anonymous diagnostics";
pub const PRIVACY_DIAGNOSTICS_DETAIL: &str =
    "Off by default. Dex sends no usage data unless you turn this on.";

/// `app/lib/widgets/settings/tabs/account_tab.dart`.
pub const ACCOUNT_MACHINE: &str = "This machine";
pub const ACCOUNT_MACHINE_DETAIL: &str = "Dex runs entirely on your PC. There is no Dex account and nothing is uploaded — the Windows account you are already signed in to is the only identity involved.";
pub const ACCOUNT_KEPT: &str = "What is kept, and where";
pub const ACCOUNT_KEPT_DETAIL: &str = "Settings, encrypted API keys, task history, evidence from verified steps, and the five log files. Nothing else, and nothing outside this folder.";

/// `app/lib/widgets/settings/tabs/intelligence_tab.dart`.
pub const BRAIN_TITLE: &str = "Brain";
pub const BRAIN_DETAIL: &str = "Which model decides what Dex should do. Everything else — pressing buttons, reading the screen, changing settings — is direct Windows API calls and uses no model at all.";
pub const CLAUDE_CODE: &str = "Claude Code";
pub const CLAUDE_CODE_BADGE: &str = "RECOMMENDED";
pub const CLAUDE_CODE_DETAIL: &str = "Uses the Claude you are already signed in to on this machine. No API key, and nothing extra to pay if you have Claude Pro or Max.";
pub const WHERE_KEPT: &str = "Where things are kept";
pub const WHERE_KEPT_SETTINGS: &str = "%LOCALAPPDATA%\\DEX\\settings.json";
pub const WHERE_KEPT_CREDS: &str = "%LOCALAPPDATA%\\DEX\\credentials  (encrypted)";
pub const KEYS_ENCRYPTED: &str = "Keys are encrypted by Windows against this account, so they are unreadable on any other machine — and they are never in the project folder or in a settings file.";

/// `app/lib/widgets/settings/tabs/connectors_tab.dart:29`.
pub const CAPABILITY_GROUPS: &[(&str, &str)] = &[
    ("built in", "Always present. No model, no window — direct Windows API calls."),
    ("agents", "Separate processes Dex starts. Each one can be down on its own."),
    ("chat", "Talk to Dex from your phone, and have files sent back to you."),
    ("accounts", "Connected accounts Dex can read and write on your behalf."),
];

/// `app/lib/widgets/settings/tabs/diagnostics_tab.dart:27`.
pub const LOG_SOURCES: &[(&str, &str, &str)] = &[
    ("core", "Core", "Planning, verification, memory"),
    ("daemon", "Daemon", "Everything privileged"),
    ("browser", "Browser", "The web"),
    ("app", "App agent", "UI Automation"),
    ("desktop", "Vision", "Screen reading"),
];
pub const DIAGNOSTICS_DETAIL: &str = "Live from %LOCALAPPDATA%\\DEX. With no console anywhere, these files are the only output Dex produces — so this is where a failure explains itself.";
pub const DIAGNOSTICS_NOT_CONNECTED: &str = "The Dex core is not connected.";
pub const DIAGNOSTICS_EMPTY: &str =
    "Nothing in this log yet — that process may not have started.";

/// `app/lib/widgets/settings/tabs/memory_tab.dart`.
pub const MEMORY_TITLE: &str = "What Dex remembers";
pub const MEMORY_WORKFLOWS: &str = "Saved workflows";
pub const MEMORY_WORKFLOWS_DETAIL: &str = "Every task that works is saved here on its own, with the values you chose turned into parameters. Ask for the same thing again and it replays with your new values and no planning call at all.";
pub const MEMORY_WORKFLOWS_EMPTY: &str = "Nothing yet. Finish a task and it appears here.";
pub const MEMORY_RECENT: &str = "Recent tasks";
pub const MEMORY_SEARCH: &str = "Search what you have asked for…";
pub const MEMORY_NOTHING: &str = "Nothing yet.";

/// `app/lib/widgets/profile/profile_menu.dart:76`.
pub const PROFILE_MENU: &[&str] = &[
    "Settings",
    "Memory",
    "Reminders",
    "Give feedback",
    "Sign out",
];

// The tray labels live in `src-tauri/src/main.rs`. They are the shell's, not
// the UI's, and duplicating them here would give them two homes.

/// `app/lib/spotlight_window.dart`.
pub const SPOTLIGHT_PLACEHOLDER: &str = "Ask Dex anything...";
pub const SPOTLIGHT_SUGGESTIONS: &[&str] = &[
    "Open this file",
    "Summarise this tab",
    "Take a screenshot",
    "Send an email",
];
