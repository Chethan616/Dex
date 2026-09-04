// In-app slash commands — the power-user command line inside the composer.
//
// When a message starts with `/`, the composer asks SlashCommands.handle()
// to run it locally (open a screen, set a model, save a fact, ...) instead
// of sending it to the agent. Unknown `/x` is reported, not sent. The
// composer also shows a live palette of matching commands as you type via
// SlashCommands.matching().

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/dex_memory.dart';
import '../../core/dex_gateway.dart';
import '../voice/voice_mode_screen.dart';
import '../../core/supervisor/supervisor.dart';
import '../../theme/tokens.dart';
import '../dex_toast.dart';
import '../model_picker.dart';
import '../settings/settings_dialog.dart';

/// Everything a command handler might need, so the registry stays free of
/// direct composer/store coupling.
class SlashContext {
  const SlashContext({
    required this.context,
    required this.sendMessage,
    this.sendToPanel,
    this.onStop,
    this.onClear,
    this.onNewChat,
    this.openScreen,
  });
  final BuildContext context;

  /// Send text to the agent as a normal turn (used by /image).
  final void Function(String) sendMessage;

  /// Send text to the Dex panel in the owner's browser, which opens beside the
  /// page. Null when the composer was built without it.
  final void Function(String)? sendToPanel;
  final VoidCallback? onStop;
  final VoidCallback? onClear;

  /// Start a new thread. Distinct from `onClear`, which empties the view
  /// without ending the conversation.
  final VoidCallback? onNewChat;

  /// Open one of the app's screens by name — 'workflows', 'schedules'.
  /// A callback rather than a Navigator push here, because which screens
  /// exist and how they open is the shell's business, not the composer's.
  final void Function(String screen)? openScreen;
}

typedef SlashRun = Future<void> Function(SlashContext ctx, String args);

/// What a command is about. Used only to group the palette, which starts to
/// matter past a handful: an alphabetical list of twenty is a list you read,
/// and a grouped one is a list you scan.
enum SlashGroup { chat, find, remember, run, app }

class SlashCommand {
  const SlashCommand({
    required this.name,
    required this.icon,
    required this.argsHint,
    required this.description,
    required this.run,
    this.group = SlashGroup.app,
    this.aliases = const <String>[],
  });

  final String name;
  final IconData icon;
  final String argsHint;
  final String description;
  final SlashRun run;
  final SlashGroup group;
  final List<String> aliases;

  /// Every string this command answers to.
  Iterable<String> get keys => [name, ...aliases];
}

extension SlashGroupLabel on SlashGroup {
  String get label => switch (this) {
        SlashGroup.chat => 'This chat',
        SlashGroup.find => 'Find',
        SlashGroup.remember => 'Remember',
        SlashGroup.run => 'Run',
        SlashGroup.app => 'App',
      };
}

class SlashCommands {
  SlashCommands._();

  static final List<SlashCommand> all = <SlashCommand>[
    SlashCommand(
      name: 'model',
      aliases: const <String>['models'],
      icon: LucideIcons.brain,
      argsHint: '',
      description: 'Pick the brain model (any provider; asks for a key if needed)',
      run: (ctx, _) => ModelPicker.show(ctx.context),
    ),
    SlashCommand(
      name: 'settings',
      icon: LucideIcons.settings,
      argsHint: '[memory|account|privacy|…]',
      description: 'Open Settings',
      run: (ctx, args) =>
          SettingsDialog.show(ctx.context, initial: _tabFromArg(args)),
    ),
    SlashCommand(
      name: 'fact',
      icon: LucideIcons.bookmark,
      argsHint: '<text>',
      description: 'Remember a fact (saved to memory)',
      run: (ctx, args) async {
        if (args.isEmpty) {
          _snack(ctx.context, 'Usage: /fact <something to remember>');
          return;
        }
        DexMemory.addFact(args);
        _snack(ctx.context, 'Remembered.');
      },
    ),
    SlashCommand(
      name: 'memory',
      icon: LucideIcons.list,
      argsHint: '',
      description: 'View what Dex remembers',
      run: (ctx, _) =>
          SettingsDialog.show(ctx.context, initial: SettingsTab.memory),
    ),
    SlashCommand(
      name: 'image',
      icon: LucideIcons.image,
      argsHint: '<prompt>',
      description: 'Generate an image',
      run: (ctx, args) async {
        if (args.isEmpty) {
          _snack(ctx.context, 'Usage: /image <what to draw>');
          return;
        }
        ctx.sendMessage('Generate an image: $args');
      },
    ),
    SlashCommand(
      name: 'clear',
      icon: LucideIcons.eraser,
      argsHint: '',
      description: 'Clear this conversation',
      run: (ctx, _) async => ctx.onClear?.call(),
    ),
    SlashCommand(
      name: 'stop',
      icon: LucideIcons.square,
      argsHint: '',
      description: 'Stop the running turn',
      run: (ctx, _) async => ctx.onStop?.call(),
    ),
    SlashCommand(
      name: 'restart',
      icon: LucideIcons.rotate_cw,
      argsHint: '',
      description: 'Restart the Dex core',
      run: (ctx, _) async {
        // This called GatewayManager, which spawned `dexagent/dex.mjs` — the
        // v1 OpenClaw gateway, a program this Dex does not have. The command
        // could only ever fail. The supervisor starts the real core and this
        // asks it to do that again.
        final supervisor = Supervisor.current;
        if (supervisor == null) {
          _snack(ctx.context, 'No supervisor — start Dex from the app.');
          return;
        }
        _snack(ctx.context, 'Restarting the core…');
        await supervisor.restart('core');
        await DexGatewayClient.current?.connect();
        if (ctx.context.mounted) {
          final ok = supervisor.step('core').status == BootStatus.done;
          _snack(ctx.context,
              ok ? 'Core restarted.' : 'Restart failed — see Diagnostics.');
        }
      },
    ),
    SlashCommand(
      name: 'reconnect',
      icon: LucideIcons.plug,
      argsHint: '',
      description: 'Reconnect to the Dex core',
      run: (ctx, _) async {
        await DexGatewayClient.current?.connect();
        if (ctx.context.mounted) _snack(ctx.context, 'Reconnecting…');
      },
    ),
    // Two commands here used to open a dialog saying they were planned.
    // A command that exists only to say it does not work is worse than no
    // command: it takes a name, appears in the palette, and teaches the owner
    // that the palette is not to be trusted. `/voice` opens the screen that
    // has been there all along; `/vision` is gone, because nothing behind it
    // was ever built.
    SlashCommand(
      name: 'voice',
      icon: LucideIcons.mic,
      argsHint: '',
      group: SlashGroup.chat,
      description: 'Talk to Dex',
      run: (ctx, _) async {
        await Navigator.of(ctx.context).push(
          MaterialPageRoute<void>(builder: (_) => const VoiceModeScreen()),
        );
      },
    ),

    // ── finding things ──────────────────────────────────────────────────────
    SlashCommand(
      name: 'find',
      icon: LucideIcons.file_search,
      argsHint: '<what to look for>',
      group: SlashGroup.find,
      aliases: const ['search'],
      description: 'Search this PC by name and by what is inside a file',
      run: (ctx, args) async {
        if (args.isEmpty) {
          _snack(ctx.context, 'Usage: /find <what to look for>');
          return;
        }
        ctx.sendMessage('Search my pc for $args');
      },
    ),
    SlashCommand(
      name: 'browser',
      icon: LucideIcons.globe,
      argsHint: '<what to do on the web>',
      group: SlashGroup.find,
      aliases: const ['web', 'chrome'],
      description: 'Run this in the browser you are signed in to, beside the page',
      run: (ctx, args) async {
        if (args.isEmpty) {
          _snack(ctx.context, 'Usage: /browser <what to do on the web>');
          return;
        }
        final toPanel = ctx.sendToPanel;
        if (toPanel == null) {
          // Not wired here, so send it normally rather than dropping it — the
          // routing rule sends browser work to their browser anyway.
          ctx.sendMessage(args);
          return;
        }
        toPanel(args);
      },
    ),
    SlashCommand(
      name: 'explain',
      icon: LucideIcons.eye,
      argsHint: '<file>',
      group: SlashGroup.find,
      description: 'Find a file and say what is in it',
      run: (ctx, args) async {
        if (args.isEmpty) {
          _snack(ctx.context, 'Usage: /explain <file>');
          return;
        }
        ctx.sendMessage('Find $args on my pc, open it and explain what is in it');
      },
    ),

    // ── things that happen later ────────────────────────────────────────────
    SlashCommand(
      name: 'remind',
      icon: LucideIcons.alarm_clock,
      argsHint: '<when> <what>',
      group: SlashGroup.run,
      description: 'Set a reminder — "20m stand up", "17:30 leave"',
      run: (ctx, args) async {
        final parsed = parseReminder(args);
        if (parsed == null) {
          _snack(ctx.context,
              'Usage: /remind 20m stand up  ·  /remind 17:30 leave for the dentist');
          return;
        }
        DexGatewayClient.current?.setReminder(parsed.text, parsed.at);
        if (ctx.context.mounted) {
          _snack(ctx.context, 'Reminder set for ${_when(parsed.at)}.');
        }
      },
    ),
    SlashCommand(
      name: 'schedules',
      icon: LucideIcons.calendar_clock,
      argsHint: '',
      group: SlashGroup.run,
      description: 'Things Dex does on a schedule',
      run: (ctx, _) async => ctx.openScreen?.call('schedules'),
    ),
    SlashCommand(
      name: 'workflow',
      icon: LucideIcons.repeat,
      argsHint: '',
      group: SlashGroup.run,
      aliases: const ['workflows'],
      description: 'Saved workflows',
      run: (ctx, _) async => ctx.openScreen?.call('workflows'),
    ),

    // ── the record ──────────────────────────────────────────────────────────
    SlashCommand(
      name: 'history',
      icon: LucideIcons.clock,
      argsHint: '[words to look for]',
      group: SlashGroup.remember,
      description: 'Past conversations, searched by what was said',
      run: (ctx, args) async {
        DexGatewayClient.current?.listConversations(query: args);
        if (ctx.context.mounted) {
          _snack(
            ctx.context,
            args.isEmpty
                ? 'History is in the sidebar.'
                : 'Showing conversations mentioning "$args".',
          );
        }
      },
    ),
    SlashCommand(
      name: 'new',
      icon: LucideIcons.message_square_plus,
      argsHint: '',
      group: SlashGroup.chat,
      description: 'Start a new conversation',
      run: (ctx, _) async => ctx.onNewChat?.call(),
    ),

    SlashCommand(
      name: 'help',
      icon: LucideIcons.circle_question_mark,
      argsHint: '',
      group: SlashGroup.app,
      description: 'List commands',
      run: (ctx, _) => _help(ctx.context),
    ),
  ];

  /// A reminder written the way a person writes one.
  ///
  /// Two forms, because those are the two people actually use: a duration from
  /// now ("20m", "2h"), and a time today or tomorrow ("17:30", "5pm"). Anything
  /// else returns null and the command says what it understands, rather than
  /// guessing a time and setting a reminder for the wrong moment — which is
  /// silently useless in a way that no reminder is not.
  static ({String text, DateTime at})? parseReminder(String input) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return null;

    final space = trimmed.indexOf(' ');
    if (space < 1) return null;
    final when = trimmed.substring(0, space).toLowerCase();
    final what = trimmed.substring(space + 1).trim();
    if (what.isEmpty) return null;

    final now = DateTime.now();

    final duration = RegExp(r'^(\d+)(m|min|mins|h|hr|hrs|d)$').firstMatch(when);
    if (duration != null) {
      final amount = int.parse(duration.group(1)!);
      final unit = duration.group(2)!;
      final at = switch (unit) {
        'h' || 'hr' || 'hrs' => now.add(Duration(hours: amount)),
        'd' => now.add(Duration(days: amount)),
        _ => now.add(Duration(minutes: amount)),
      };
      return (text: what, at: at);
    }

    final clock = RegExp(r'^(\d{1,2})(?::(\d{2}))?(am|pm)?$').firstMatch(when);
    if (clock != null) {
      var hour = int.parse(clock.group(1)!);
      final minute = int.parse(clock.group(2) ?? '0');
      final half = clock.group(3);
      if (half == 'pm' && hour < 12) hour += 12;
      if (half == 'am' && hour == 12) hour = 0;
      if (hour > 23 || minute > 59) return null;

      var at = DateTime(now.year, now.month, now.day, hour, minute);
      // A time already past today means tomorrow. "Remind me at 9" said at
      // ten in the morning is not a reminder for eleven hours ago.
      if (!at.isAfter(now)) at = at.add(const Duration(days: 1));
      return (text: what, at: at);
    }

    return null;
  }

  static String _when(DateTime at) {
    final delta = at.difference(DateTime.now());
    if (delta.inMinutes < 60) return 'in ${delta.inMinutes} min';
    if (delta.inHours < 24) return 'in ${delta.inHours}h';
    return '${at.day}/${at.month} at '
        '${at.hour.toString().padLeft(2, '0')}:'
        '${at.minute.toString().padLeft(2, '0')}';
  }

  /// True if [text] looks like a slash command invocation.
  static bool looksLikeCommand(String text) => text.trimLeft().startsWith('/');

  static SlashCommand? _find(String name) {
    for (final c in all) {
      if (c.name == name || c.aliases.contains(name)) return c;
    }
    return null;
  }

  /// Commands matching [token], best first.
  ///
  /// Prefix matching alone meant `/rem` found `/remind` and `/rmd` found
  /// nothing, so the palette only helped someone who already knew the name —
  /// which is the one person who does not need a palette. This scores three
  /// ways, and the order it produces is the point:
  ///
  ///   an exact name    the command you named
  ///   a prefix         what you were part-way through typing
  ///   a subsequence    `/wf` for `workflow`, `/hst` for `history`
  ///
  /// Ties break on the shorter name, so a short command is never buried under
  /// a longer one that happens to contain the same letters.
  static List<SlashCommand> matching(String token) {
    final t = token.toLowerCase().trim();
    if (t.isEmpty) return all;

    final scored = <(int, SlashCommand)>[];
    for (final c in all) {
      var best = -1;
      for (final key in c.keys) {
        final score = _score(key, t);
        if (score > best) best = score;
      }
      if (best >= 0) scored.add((best, c));
    }

    scored.sort((a, b) {
      final byScore = b.$1.compareTo(a.$1);
      if (byScore != 0) return byScore;
      return a.$2.name.length.compareTo(b.$2.name.length);
    });
    return [for (final entry in scored) entry.$2];
  }

  /// How well [key] answers to [typed]. Negative means it does not.
  static int _score(String key, String typed) {
    if (key == typed) return 1000;
    if (key.startsWith(typed)) return 500 - key.length;
    if (key.contains(typed)) return 200 - key.length;

    // A subsequence: every typed letter appears, in order. Tighter runs score
    // higher, so `hst` prefers `history` over a name where those letters are
    // scattered across the whole word.
    var at = 0;
    var gaps = 0;
    for (final letter in typed.split('')) {
      final found = key.indexOf(letter, at);
      if (found == -1) return -1;
      gaps += found - at;
      at = found + 1;
    }
    return 100 - gaps;
  }

  /// Run [text] as a command. Returns true when [text] was a slash command
  /// (handled or reported) and must NOT be sent to the agent; false when it
  /// should be sent normally.
  static Future<bool> handle(
    SlashContext ctx,
    String text,
  ) async {
    final trimmed = text.trim();
    if (!trimmed.startsWith('/')) return false;
    final sp = trimmed.indexOf(' ');
    final name =
        (sp < 0 ? trimmed.substring(1) : trimmed.substring(1, sp)).toLowerCase();
    final args = sp < 0 ? '' : trimmed.substring(sp + 1).trim();
    final cmd = _find(name);
    if (cmd == null) {
      _snack(ctx.context, 'Unknown command "/$name" — type / to see commands');
      return true;
    }
    await cmd.run(ctx, args);
    return true;
  }

  static SettingsTab _tabFromArg(String args) {
    final a = args.trim().toLowerCase();
    for (final t in SettingsTab.values) {
      if (t.name == a) return t;
    }
    return SettingsTab.preferences;
  }

  static void _snack(BuildContext context, String msg) {
    dexToast(context, msg);
  }

  // `_planned` lived here: a dialog saying a command was not built yet. Two
  // commands used it. A command whose only job is to say it does not work
  // takes a name, sits in the palette, and teaches the owner that the palette
  // is not to be trusted — so both are gone, one replaced by the screen that
  // was already there.

  static Future<void> _help(BuildContext context) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DexColors.surface2,
        title: Text('Commands', style: DexType.label(color: DexColors.text)),
        content: SizedBox(
          width: 360,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final c in all)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: RichText(
                    text: TextSpan(
                      style: DexType.body(color: DexColors.textDim),
                      children: [
                        TextSpan(
                          text: '/${c.name}'
                              '${c.argsHint.isEmpty ? '' : ' ${c.argsHint}'}  ',
                          style: DexType.mono(color: DexColors.text)
                              .copyWith(fontSize: 12.5),
                        ),
                        TextSpan(text: c.description),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}
