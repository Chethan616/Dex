// Connectors: what Dex can reach, and whether it can reach it right now.
//
// This listed twenty integrations — Slack, Signal, iMessage, Matrix, Teams,
// Google Chat, Voice calls — that this Dex has never had, each with an Install
// button wired to a gateway that no longer exists. Every button was inert and
// most of the list was aspiration.
//
// It now shows the capabilities Dex actually has, each probed live: the daemon
// by looking for its pipe, the agents by connecting to their ports, the chat
// channels by whether both halves of their configuration are present. A
// capability list nobody can verify is a brochure. This one asks, every two
// seconds, and says what to do about anything that is down.

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/dex_gateway.dart';
import '../../../core/models/capability_health.dart';
import '../../../theme/tokens.dart';
import '../account_setup.dart';
import '../browser_signin.dart';
import '../connector_setup.dart';
import '../settings_dialog.dart';

const _groupOrder = ['built in', 'agents', 'chat', 'accounts'];

const _groupBlurb = {
  'built in': 'Always present. No model, no window — direct Windows API calls.',
  'agents': 'Separate processes Dex starts. Each one can be down on its own.',
  'chat': 'Talk to Dex from your phone, and have files sent back to you.',
  'accounts': 'Connected accounts Dex can read and write on your behalf.',
};

class ConnectorsTab extends StatefulWidget {
  const ConnectorsTab({super.key, this.onNavigate});

  final void Function(SettingsTab)? onNavigate;

  @override
  State<ConnectorsTab> createState() => _ConnectorsTabState();
}

class _ConnectorsTabState extends State<ConnectorsTab> {
  Timer? _poll;

  DexGatewayClient? get _client => DexGatewayClient.current;

  @override
  void initState() {
    super.initState();
    _client?.addListener(_onChange);
    _client?.refreshHealth();
    _poll = Timer.periodic(
      const Duration(seconds: 2),
      (_) => _client?.refreshHealth(),
    );
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _poll?.cancel();
    _client?.removeListener(_onChange);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final health = _client?.health;

    if (health == null) {
      return const Center(
        child: SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(strokeWidth: 2, color: DexColors.accent),
        ),
      );
    }

    final ready = health.where((c) => c.ok).length;

    return ListView(
      padding: const EdgeInsets.fromLTRB(28, 24, 28, 40),
      children: [
        const Text(
          'Capabilities',
          style: TextStyle(
            color: DexColors.text,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          '$ready of ${health.length} available. Checked live — the daemon by '
          'its pipe, the agents by their ports.',
          style: const TextStyle(
            color: DexColors.textDim,
            fontSize: 12.5,
            height: 1.55,
          ),
        ),
        const SizedBox(height: 22),
        for (final group in _groupOrder) ...[
          if (health.any((c) => c.group == group)) ...[
            _GroupHeader(
              title: group,
              blurb: _groupBlurb[group] ?? '',
            ),
            const SizedBox(height: 10),
            // Chat rows are set up in place. Everything else is a status: the
            // daemon and the agents are started by Dex and there is nothing to
            // type. A channel needs a token and an id, and the row that said
            // "no owner id" used to name a problem with no way to fix it — the
            // only route was an environment variable and a restart, which the
            // screen never mentioned.
            if (group == 'chat')
              for (final id in const ['telegram', 'discord', 'whatsapp'])
                ConnectorSetup(channel: id)
            else
              for (final capability in health.where((c) => c.group == group))
                _Row(
                  capability: capability,
                  onFix: capability.reason?.contains('Intelligence') ?? false
                      ? () => widget.onNavigate?.call(SettingsTab.intelligence)
                      : null,
                ),
            if (group == 'agents') ...[
              const SizedBox(height: 8),
              const BrowserSignIn(),
            ],
            if (group == 'accounts') ...[
              const SizedBox(height: 8),
              const AccountSetup(account: 'google'),
            ],
            const SizedBox(height: 22),
          ],
        ],
      ],
    );
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({required this.title, required this.blurb});

  final String title;
  final String blurb;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: DexColors.textFaint,
              fontSize: 10,
              letterSpacing: 1.3,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            blurb,
            style: const TextStyle(
              color: DexColors.textFaint,
              fontSize: 11.5,
              height: 1.45,
            ),
          ),
        ],
      );
}

class _Row extends StatelessWidget {
  const _Row({required this.capability, this.onFix});

  final CapabilityHealth capability;
  final VoidCallback? onFix;

  @override
  Widget build(BuildContext context) {
    final ok = capability.ok;
    final tone = ok ? DexColors.stateApprove : DexColors.textFaint;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DexColors.surface.withValues(alpha: ok ? 0.45 : 0.25),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: ok ? DexColors.border : DexColors.border.withValues(alpha: 0.6),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  capability.name,
                  style: TextStyle(
                    color: ok ? DexColors.text : DexColors.textDim,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  capability.detail,
                  style: const TextStyle(
                    color: DexColors.textDim,
                    fontSize: 11.5,
                    height: 1.45,
                  ),
                ),
                // The reason is the useful half. "Unavailable" tells you
                // nothing; "add a bot token in Intelligence" is a next step.
                if (!ok && capability.reason != null) ...[
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          capability.reason!,
                          style: const TextStyle(
                            color: DexColors.stateAwaiting,
                            fontSize: 11.5,
                            height: 1.4,
                          ),
                        ),
                      ),
                      if (onFix != null) ...[
                        const SizedBox(width: 8),
                        MouseRegion(
                          cursor: SystemMouseCursors.click,
                          child: GestureDetector(
                            onTap: onFix,
                            child: const Text(
                              'Open',
                              style: TextStyle(
                                color: DexColors.accent,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(
            ok ? 'ready' : 'off',
            style: TextStyle(
              color: tone,
              fontSize: 10,
              letterSpacing: 0.7,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
