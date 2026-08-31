import 'dart:async';

import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../theme/tokens.dart';
import '../widgets/primitives/primitives.dart';

/// The five log files, without leaving the app.
///
/// This matters more here than it would in most applications. Dex runs five
/// processes with no console between them, so `%LOCALAPPDATA%\DEX\*.log` is
/// the *only* output there is. Making that a tab rather than a folder someone
/// has to be told about is most of the difference between a diagnosable
/// failure and a mysterious one.
///
/// Read through the core rather than from disk directly: the core already
/// tails safely — the last 256KB rather than a multi-megabyte file — and the
/// name is validated there against a pattern, so no path can be talked into
/// reading something that is not a Dex log.
class LogsScreen extends StatefulWidget {
  const LogsScreen({super.key, required this.client});

  final GatewayClient client;

  @override
  State<LogsScreen> createState() => _LogsScreenState();
}

class _LogsScreenState extends State<LogsScreen> {
  static const logs = [
    ('core', 'Core', 'Planning, verification, the WebSocket'),
    ('daemon', 'Daemon', 'Everything privileged'),
    ('app', 'App agent', 'UI Automation'),
    ('browser', 'Browser', 'The web'),
    ('desktop', 'Vision', 'Screen reading'),
  ];

  String _selected = 'core';
  Timer? _poll;
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    widget.client.addListener(_onChange);
    widget.client.refreshLog(_selected);
    // Polled rather than pushed. A file tail is not worth a second channel,
    // and two seconds is well inside the time it takes to read a screen.
    _poll = Timer.periodic(
      const Duration(seconds: 2),
      (_) => widget.client.refreshLog(_selected),
    );
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _poll?.cancel();
    widget.client.removeListener(_onChange);
    _scroll.dispose();
    super.dispose();
  }

  void _select(String name) {
    setState(() => _selected = name);
    widget.client.refreshLog(name);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final text = widget.client.logs[_selected];

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
              Wrap(
                spacing: DexTokens.spaceSm,
                children: [
                  for (final log in logs)
                    Tooltip(
                      message: log.$3,
                      child: DexButton(
                        label: log.$2,
                        dense: true,
                        variant: _selected == log.$1
                            ? DexButtonVariant.primary
                            : DexButtonVariant.secondary,
                        onTap: () => _select(log.$1),
                      ),
                    ),
                ],
              ),
              const Spacer(),
              Text(
                '%LOCALAPPDATA%\\DEX\\$_selected.log',
                style: DexType.code(color: t.textFaint),
              ),
            ],
          ),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              DexTokens.spaceXl,
              0,
              DexTokens.spaceXl,
              DexTokens.spaceXl,
            ),
            child: DexPanel(
              padding: EdgeInsets.zero,
              clip: true,
              child: text == null
                  ? Center(
                      child: Text('Reading…',
                          style: DexType.caption(color: t.textFaint)),
                    )
                  : text.trim().isEmpty
                      ? Center(
                          child: Text(
                            'Nothing in this log yet.',
                            style: DexType.caption(color: t.textFaint),
                          ),
                        )
                      : Scrollbar(
                          controller: _scroll,
                          child: SingleChildScrollView(
                            controller: _scroll,
                            padding: const EdgeInsets.all(DexTokens.spaceLg),
                            child: SelectableText(
                              text,
                              style: DexType.codeSm(color: t.textMuted),
                            ),
                          ),
                        ),
            ),
          ),
        ),
      ],
    );
  }
}
