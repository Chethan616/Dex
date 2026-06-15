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
import '../../core/gateway_client.dart';
import '../../core/gateway_process.dart';
import '../../theme/tokens.dart';
import '../model_picker.dart';
import '../settings/settings_dialog.dart';

/// Everything a command handler might need, so the registry stays free of
/// direct composer/store coupling.
class SlashContext {
  const SlashContext({
    required this.context,
    required this.sendMessage,
    this.onStop,
    this.onClear,
  });
  final BuildContext context;

  /// Send text to the agent as a normal turn (used by /image).
  final void Function(String) sendMessage;
  final VoidCallback? onStop;
  final VoidCallback? onClear;
}

typedef SlashRun = Future<void> Function(SlashContext ctx, String args);

class SlashCommand {
  const SlashCommand({
    required this.name,
    required this.icon,
    required this.argsHint,
    required this.description,
    required this.run,
    this.aliases = const <String>[],
  });
  final String name;
  final IconData icon;
  final String argsHint;
  final String description;
  final SlashRun run;
  final List<String> aliases;
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
      description: 'Restart the gateway',
      run: (ctx, _) async {
        _snack(ctx.context, 'Restarting gateway…');
        final ok = await GatewayManager.restart();
        if (ok) await GatewayClient.current?.connect();
        if (ctx.context.mounted) {
          _snack(ctx.context, ok ? 'Gateway restarted.' : 'Restart failed — see Diagnostics.');
        }
      },
    ),
    SlashCommand(
      name: 'reconnect',
      icon: LucideIcons.plug,
      argsHint: '',
      description: 'Reconnect to the gateway',
      run: (ctx, _) async {
        await GatewayClient.current?.connect();
        if (ctx.context.mounted) _snack(ctx.context, 'Reconnecting…');
      },
    ),
    SlashCommand(
      name: 'vision',
      icon: LucideIcons.glasses,
      argsHint: '[question]',
      description: 'Share your screen with Dex (coming soon)',
      run: (ctx, _) => _planned(ctx.context, 'Vision',
          'Screen sharing lets Dex see what you see and act on it. It is '
          'planned — the command is reserved so it lights up the moment it ships.'),
    ),
    SlashCommand(
      name: 'voice',
      icon: LucideIcons.mic,
      argsHint: '',
      description: 'Talk to Dex (coming soon)',
      run: (ctx, _) => _planned(ctx.context, 'Voice',
          'Voice mode lets you speak to Dex and hear replies. It is planned; '
          'the command is reserved for when it ships.'),
    ),
    SlashCommand(
      name: 'help',
      icon: LucideIcons.circle_question_mark,
      argsHint: '',
      description: 'List commands',
      run: (ctx, _) => _help(ctx.context),
    ),
  ];

  /// True if [text] looks like a slash command invocation.
  static bool looksLikeCommand(String text) => text.trimLeft().startsWith('/');

  static SlashCommand? _find(String name) {
    for (final c in all) {
      if (c.name == name || c.aliases.contains(name)) return c;
    }
    return null;
  }

  /// Commands whose name/alias starts with [token] (no leading slash),
  /// for the live palette. Empty token returns all.
  static List<SlashCommand> matching(String token) {
    final t = token.toLowerCase();
    if (t.isEmpty) return all;
    return all
        .where((c) =>
            c.name.startsWith(t) || c.aliases.any((a) => a.startsWith(t)))
        .toList(growable: false);
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
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  static Future<void> _planned(BuildContext context, String title, String body) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DexColors.surface2,
        title: Text('$title — planned',
            style: DexType.label(color: DexColors.text)),
        content: Text(body, style: DexType.body(color: DexColors.textDim)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Got it'),
          ),
        ],
      ),
    );
  }

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
