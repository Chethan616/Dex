//! The slash-command palette.
//!
//! All nineteen commands from `app/lib/widgets/composer/slash_commands.dart`,
//! with the same fuzzy scoring so the same typing selects the same command.

/// What running a command does. The composer interprets these; the registry
/// stays declarative so the list reads as a list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlashAction {
    /// Send this text as a prompt, with `{args}` substituted.
    Send(&'static str),
    /// Open a surface in the app.
    Open(&'static str),
    /// Act on the conversation itself.
    Local(&'static str),
}

#[derive(Debug, Clone)]
pub struct SlashCommand {
    pub name: &'static str,
    pub aliases: &'static [&'static str],
    /// Present when the command needs arguments. A command with a hint writes
    /// `/name ` into the field instead of running immediately.
    pub args_hint: Option<&'static str>,
    pub description: &'static str,
    pub group: &'static str,
    pub action: SlashAction,
}

/// Group order, `slash_commands.dart:85`.
pub const GROUPS: &[&str] = &["This chat", "Find", "Remember", "Run", "App"];

pub const COMMANDS: &[SlashCommand] = &[
    SlashCommand {
        name: "model",
        aliases: &["models"],
        args_hint: None,
        description: "Pick the brain model (any provider; asks for a key if needed)",
        group: "App",
        action: SlashAction::Open("model"),
    },
    SlashCommand {
        name: "settings",
        aliases: &[],
        args_hint: Some("[memory|account|privacy|…]"),
        description: "Open Settings",
        group: "App",
        action: SlashAction::Open("settings"),
    },
    SlashCommand {
        name: "fact",
        aliases: &[],
        args_hint: Some("<text>"),
        description: "Remember a fact (saved to memory)",
        group: "Remember",
        action: SlashAction::Send("Remember this: {args}"),
    },
    SlashCommand {
        name: "memory",
        aliases: &[],
        args_hint: None,
        description: "View what Dex remembers",
        group: "Remember",
        action: SlashAction::Open("memory"),
    },
    SlashCommand {
        name: "image",
        aliases: &[],
        args_hint: Some("<prompt>"),
        description: "Generate an image",
        group: "Run",
        action: SlashAction::Send("Generate an image: {args}"),
    },
    SlashCommand {
        name: "clear",
        aliases: &[],
        args_hint: None,
        description: "Clear this conversation",
        group: "This chat",
        action: SlashAction::Local("clear"),
    },
    SlashCommand {
        name: "stop",
        aliases: &[],
        args_hint: None,
        description: "Stop the running turn",
        group: "This chat",
        action: SlashAction::Local("stop"),
    },
    SlashCommand {
        name: "restart",
        aliases: &[],
        args_hint: None,
        description: "Restart the Dex core",
        group: "App",
        action: SlashAction::Local("restart"),
    },
    SlashCommand {
        name: "reconnect",
        aliases: &[],
        args_hint: None,
        description: "Reconnect to the Dex core",
        group: "App",
        action: SlashAction::Local("reconnect"),
    },
    SlashCommand {
        name: "voice",
        aliases: &[],
        args_hint: None,
        description: "Talk to Dex",
        group: "App",
        action: SlashAction::Open("voice"),
    },
    SlashCommand {
        name: "find",
        aliases: &["search"],
        args_hint: Some("<what to look for>"),
        description: "Search this PC by name and by what is inside a file",
        group: "Find",
        action: SlashAction::Send("Search my pc for {args}"),
    },
    SlashCommand {
        name: "browser",
        aliases: &["web", "chrome"],
        args_hint: Some("<what to do on the web>"),
        description: "Run this in the browser you are signed in to, beside the page",
        group: "Run",
        action: SlashAction::Local("browser"),
    },
    SlashCommand {
        name: "explain",
        aliases: &[],
        args_hint: Some("<file>"),
        description: "Find a file and say what is in it",
        group: "Find",
        action: SlashAction::Send("Find {args} on my pc, open it and explain what is in it"),
    },
    SlashCommand {
        name: "remind",
        aliases: &[],
        args_hint: Some("<when> <what>"),
        description: "Set a reminder — \"20m stand up\", \"17:30 leave\"",
        group: "Remember",
        action: SlashAction::Local("remind"),
    },
    SlashCommand {
        name: "schedules",
        aliases: &[],
        args_hint: None,
        description: "Things Dex does on a schedule",
        group: "Remember",
        action: SlashAction::Open("reminders"),
    },
    SlashCommand {
        name: "workflow",
        aliases: &["workflows"],
        args_hint: None,
        description: "Saved workflows",
        group: "Remember",
        action: SlashAction::Open("memory"),
    },
    SlashCommand {
        name: "history",
        aliases: &[],
        args_hint: Some("[words to look for]"),
        description: "Past conversations, searched by what was said",
        group: "Find",
        action: SlashAction::Local("history"),
    },
    SlashCommand {
        name: "new",
        aliases: &[],
        args_hint: None,
        description: "Start a new conversation",
        group: "This chat",
        action: SlashAction::Local("new"),
    },
    SlashCommand {
        name: "help",
        aliases: &[],
        args_hint: None,
        description: "List commands",
        group: "App",
        action: SlashAction::Open("help"),
    },
];

/// Fuzzy score for one candidate name, from `slash_commands.dart:451`.
///
/// Exact 1000, prefix 500-len, contains 200-len, subsequence 100-gaps,
/// otherwise no match. Ties break on the shorter name, so `/new` beats
/// `/renew` for "new".
fn score_name(name: &str, query: &str) -> i32 {
    if query.is_empty() {
        return 1;
    }
    if name == query {
        return 1000;
    }
    if name.starts_with(query) {
        return 500 - i32::try_from(name.len()).unwrap_or(0);
    }
    if name.contains(query) {
        return 200 - i32::try_from(name.len()).unwrap_or(0);
    }

    // Subsequence: every character of the query appears in order.
    let mut gaps = 0;
    let mut chars = name.chars();
    for wanted in query.chars() {
        let mut stepped = 0;
        loop {
            match chars.next() {
                Some(c) if c == wanted => break,
                Some(_) => stepped += 1,
                None => return -1,
            }
        }
        gaps += stepped;
    }
    100 - gaps
}

/// The best score across a command's name and its aliases.
#[must_use]
pub fn score(command: &SlashCommand, query: &str) -> i32 {
    std::iter::once(command.name)
        .chain(command.aliases.iter().copied())
        .map(|name| score_name(name, query))
        .max()
        .unwrap_or(-1)
}

/// Commands matching `query` (the text after `/`), best first.
#[must_use]
pub fn matches(query: &str) -> Vec<&'static SlashCommand> {
    let query = query.to_lowercase();
    let mut scored: Vec<(i32, &'static SlashCommand)> = COMMANDS
        .iter()
        .map(|c| (score(c, &query), c))
        .filter(|(s, _)| *s >= 0)
        .collect();

    // Higher score first; equal scores go to the shorter name.
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.name.len().cmp(&b.1.name.len())));
    scored.into_iter().map(|(_, c)| c).collect()
}

/// `dex_composer.dart:803`.
#[must_use]
pub fn no_match(token: &str) -> String {
    format!("No command matches \"/{token}\"")
}

/// `slash_commands.dart:485`.
#[must_use]
pub fn unknown(name: &str) -> String {
    format!("Unknown command \"/{name}\" — type / to see commands")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_command_from_the_flutter_registry_is_present() {
        assert_eq!(COMMANDS.len(), 19, "the Flutter palette has nineteen");
    }

    #[test]
    fn an_exact_name_wins() {
        let found = matches("new");
        assert_eq!(found[0].name, "new");
    }

    #[test]
    fn a_prefix_beats_a_substring() {
        // "hist" prefixes /history and appears in nothing else.
        let found = matches("hist");
        assert_eq!(found[0].name, "history");
    }

    #[test]
    fn aliases_are_searched_too() {
        let found = matches("chrome");
        assert_eq!(found[0].name, "browser");
        let found = matches("web");
        assert_eq!(found[0].name, "browser");
    }

    #[test]
    fn an_empty_query_lists_everything() {
        assert_eq!(matches("").len(), COMMANDS.len());
    }

    #[test]
    fn nonsense_matches_nothing() {
        assert!(matches("zzzqqq").is_empty());
    }

    #[test]
    fn commands_needing_arguments_declare_a_hint() {
        let remind = COMMANDS
            .iter()
            .find(|c| c.name == "remind")
            .expect("/remind exists");
        assert!(remind.args_hint.is_some(), "it writes /remind into the field");
    }
}
