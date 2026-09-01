import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../core/models.dart';
import '../core/supervisor/supervisor.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/confirmation_card.dart';
import '../widgets/primitives/primitives.dart';
import '../widgets/step_stream.dart';

/// Ask, watch, and see what Dex just did.
///
/// The same three things the bar shows, with room to breathe: a prompt, the
/// live step stream, and any confirmation waiting on you. A card that appears
/// here is the same card the bar raises, and it carries the same injected-click
/// guard — a control that decides whether Dex may change your DNS does not get
/// to be easier to press because it is on a larger screen.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.client, required this.supervisor});

  final GatewayClient client;
  final Supervisor supervisor;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    widget.client.addListener(_onChange);
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.client.removeListener(_onChange);
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    widget.client.submit(text);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final client = widget.client;
    final connected = client.connection == CoreConnection.connected;
    final pending = client.pending.values.toList();
    final events = client.current?.events ?? const <DexEvent>[];

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            DexTokens.spaceXl,
            DexTokens.spaceXl,
            DexTokens.spaceXl,
            DexTokens.spaceMd,
          ),
          child: Row(
            children: [
              Expanded(
                child: DexField(
                  controller: _controller,
                  hint: connected
                      ? 'Ask Dex to do something'
                      : 'Waiting for the core…',
                  prefix: Icons.bolt_rounded,
                  autofocus: true,
                  onSubmitted: (_) => _submit(),
                ),
              ),
              const SizedBox(width: DexTokens.spaceMd),
              DexButton(
                label: 'Run',
                variant: DexButtonVariant.primary,
                enabled: connected,
                onTap: _submit,
              ),
              if (client.current?.phase == TaskPhase.running) ...[
                const SizedBox(width: DexTokens.spaceSm),
                DexButton(
                  label: 'Stop',
                  tone: t.negative,
                  consequential: true,
                  onTap: client.cancelCurrent,
                ),
              ],
            ],
          ),
        ),
        if (client.lastNotice != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: DexTokens.spaceXl),
            child: _Notice(
              text: client.lastNotice!,
              onDismiss: client.dismissNotice,
            ),
          ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              DexTokens.spaceXl,
              DexTokens.spaceSm,
              DexTokens.spaceXl,
              DexTokens.spaceXl,
            ),
            children: [
              for (final request in pending)
                Padding(
                  padding: const EdgeInsets.only(bottom: DexTokens.spaceLg),
                  child: ConfirmationCard(
                    request: request,
                    onRespond: (verdict) => client.respond(request, verdict),
                    onCancelTask: client.cancelCurrent,
                  ),
                ),
              // The answer first, above the working. What Dex found is the
              // thing that was asked for; how it got there is supporting
              // detail, and burying "Balanced" under nine step lines is how a
              // read came to look like it reported nothing.
              if (client.current?.answer != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: DexTokens.spaceLg),
                  child: _Answer(text: client.current!.answer!),
                ),
              if (events.isNotEmpty)
                DexPanel(
                  padding: const EdgeInsets.all(DexTokens.spaceLg),
                  child: StepStream(events: events, shrinkWrap: true),
                )
              else if (pending.isEmpty && client.current?.answer == null)
                _Empty(client: client),
              const SizedBox(height: DexTokens.spaceXl),
              _RecentTasks(client: client),
            ],
          ),
        ),
      ],
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.onDismiss});

  final String text;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return DexEntrance(
      child: Container(
        margin: const EdgeInsets.only(bottom: DexTokens.spaceMd),
        padding: const EdgeInsets.symmetric(
          horizontal: DexTokens.spaceMd,
          vertical: DexTokens.spaceSm,
        ),
        decoration: BoxDecoration(
          color: t.warn.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(DexTokens.radiusSm),
          border: Border.all(color: t.warn.withValues(alpha: 0.35)),
        ),
        child: Row(
          children: [
            Expanded(child: Text(text, style: DexType.caption(color: t.warn))),
            DexIconButton(
              icon: Icons.close_rounded,
              tooltip: 'Dismiss',
              onTap: onDismiss,
            ),
          ],
        ),
      ),
    );
  }
}

/// What to show when nothing is happening.
///
/// Suggestions rather than a logo, and every one of them is a task Dex can
/// actually complete today — an empty state that advertises something that
/// does not work is worse than a blank panel.
class _Empty extends StatelessWidget {
  const _Empty({required this.client});

  final GatewayClient client;

  static const suggestions = [
    'set my volume to 30',
    'what is my battery level',
    'open notepad and type today’s date',
    'every weekday at 9 as standup: open my calendar',
  ];

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return DexEntrance(
      child: DexPanel(
        padding: const EdgeInsets.all(DexTokens.spaceXl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Try something', style: DexType.title(color: t.text)),
            const SizedBox(height: DexTokens.spaceSm),
            Text(
              'Dex reaches for the OS first, the application second, and the '
              'screen only when nothing else will do.',
              style: DexType.caption(color: t.textMuted),
            ),
            const SizedBox(height: DexTokens.spaceLg),
            Wrap(
              spacing: DexTokens.spaceSm,
              runSpacing: DexTokens.spaceSm,
              children: [
                for (final suggestion in suggestions)
                  DexButton(
                    label: suggestion,
                    dense: true,
                    onTap: () => client.submit(suggestion),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RecentTasks extends StatelessWidget {
  const _RecentTasks({required this.client});

  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final recent = client.history.take(5).toList();
    if (recent.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Earlier today', style: DexType.label(color: t.textMuted)),
        const SizedBox(height: DexTokens.spaceSm),
        for (final run in recent)
          Padding(
            padding: const EdgeInsets.only(bottom: DexTokens.spaceXs),
            child: Row(
              children: [
                Icon(
                  run.phase == TaskPhase.done
                      ? Icons.check_rounded
                      : run.phase == TaskPhase.failed
                          ? Icons.close_rounded
                          : Icons.more_horiz_rounded,
                  size: 14,
                  color: run.phase == TaskPhase.done
                      ? t.positive
                      : run.phase == TaskPhase.failed
                          ? t.negative
                          : t.textFaint,
                ),
                const SizedBox(width: DexTokens.spaceSm),
                Expanded(
                  child: Text(
                    run.prompt,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: DexType.caption(color: t.textMuted),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// What Dex has to say.
///
/// Its own panel, not another line in the step stream. The stream is a record
/// of what Dex did; this is the thing that was asked for, and the two have
/// been the same colour and the same size for long enough that a read looked
/// like it had reported nothing at all.
///
/// Selectable, because the answer is often a value someone wants to copy — a
/// hash, a DNS server, a file path.
class _Answer extends StatelessWidget {
  const _Answer({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return DexEntrance(
      child: DexPanel(
        padding: const EdgeInsets.all(DexTokens.spaceLg),
        accent: t.info,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(Icons.chat_bubble_outline_rounded, size: 15, color: t.info),
            ),
            const SizedBox(width: DexTokens.spaceMd),
            Expanded(
              child: SelectableText(
                text,
                style: DexType.body(color: t.text),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
