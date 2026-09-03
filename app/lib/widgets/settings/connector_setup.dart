// Pairing a chat channel, and proving it works.
//
// The Connectors tab could report a channel's state and do nothing about it —
// the only way to pair one was to set an environment variable and restart the
// core, which the screen never mentioned. So the row that said "no owner id"
// was accurate and useless: it named a problem with no way to fix it.
//
// Two fields and two buttons. The token goes to the OS credential store on the
// core side and is never echoed back, which is why the box shows whether one
// is saved rather than what it is. The owner id is a username, not a secret,
// so it comes back and can be edited.
//
// "Send a test message" is the part that matters. Everything else on this
// screen is a claim: a token can be valid, the bot can be running, and the
// owner id can be a plausible number belonging to somebody else, and every
// status would still say connected. A message that arrives on your phone is
// the only check that covers the whole path.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/dex_gateway.dart';
import '../../theme/tokens.dart';

class ConnectorSetup extends StatefulWidget {
  const ConnectorSetup({super.key, required this.channel});

  /// 'telegram', 'discord' or 'whatsapp'.
  final String channel;

  @override
  State<ConnectorSetup> createState() => _ConnectorSetupState();
}

class _ConnectorSetupState extends State<ConnectorSetup> {
  final _token = TextEditingController();
  final _owner = TextEditingController();
  bool _open = false;
  bool _seeded = false;

  DexGatewayClient? get _client => DexGatewayClient.current;

  Map<String, dynamic>? get _state {
    for (final row in _client?.channels ?? const <Map<String, dynamic>>[]) {
      if (row['id'] == widget.channel) return row;
    }
    return null;
  }

  Map<String, dynamic>? get _test => _client?.connectorTests[widget.channel];

  /// What the owner id is called on this platform, in their words.
  String get _ownerLabel => switch (widget.channel) {
        'telegram' => 'Your Telegram user id',
        'discord' => 'Your Discord user id',
        _ => 'Your WhatsApp number, with country code',
      };

  String get _ownerHint => switch (widget.channel) {
        'telegram' => 'Message @userinfobot on Telegram to find it',
        'discord' => 'Enable Developer Mode, then right-click yourself',
        _ => '919999999999',
      };

  @override
  void initState() {
    super.initState();
    _client?.addListener(_onChange);
    _client?.listChannels();
  }

  void _onChange() {
    if (!mounted) return;
    // Filled once, from what the core has. Re-filling on every notification
    // would fight the owner's typing.
    if (!_seeded && _state != null) {
      _seeded = true;
      _owner.text = (_state?['owner'] as String?) ?? _owner.text;
    }
    setState(() {});
  }

  @override
  void dispose() {
    _client?.removeListener(_onChange);
    _token.dispose();
    _owner.dispose();
    super.dispose();
  }

  void _save() {
    _client?.setChannel(
      widget.channel,
      // An untouched token box leaves the stored one alone. Sending an empty
      // string would clear it, which is not what "I only changed my user id"
      // should do.
      token: _token.text.trim().isEmpty ? null : _token.text.trim(),
      owner: _owner.text.trim(),
      enabled: widget.channel == 'whatsapp' ? true : null,
    );
    _token.clear();
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    final running = state?['running'] == true;
    final configured = state?['configured'] == true;
    final reason = (state?['reason'] as String?) ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: DexColors.surface.withValues(alpha: 0.35),
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _open = !_open),
            borderRadius: DexRadius.rsm,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  Icon(
                    running
                        ? LucideIcons.circle_check
                        : configured
                            ? LucideIcons.circle_dashed
                            : LucideIcons.circle,
                    size: 14,
                    color: running
                        ? DexColors.stateApprove
                        : configured
                            ? DexColors.stateAwaiting
                            : DexColors.textFaint,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    (state?['name'] as String?) ?? widget.channel,
                    style: DexType.label(color: DexColors.text),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      running ? 'connected' : reason,
                      style: DexType.caption(color: DexColors.textFaint),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Icon(
                    _open ? LucideIcons.chevron_up : LucideIcons.chevron_down,
                    size: 14,
                    color: DexColors.textFaint,
                  ),
                ],
              ),
            ),
          ),
          if (_open) ...[
            const Divider(height: 1, color: DexColors.border),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (widget.channel != 'whatsapp') ...[
                    _Field(
                      controller: _token,
                      label: 'Bot token',
                      hint: configured
                          ? 'A token is saved — type a new one to replace it'
                          : 'Paste the token from BotFather',
                      obscure: true,
                    ),
                    const SizedBox(height: 10),
                  ],
                  _Field(
                    controller: _owner,
                    label: _ownerLabel,
                    hint: _ownerHint,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _Button(
                        label: 'Save and connect',
                        icon: LucideIcons.plug,
                        onTap: _save,
                      ),
                      const SizedBox(width: 8),
                      _Button(
                        label: 'Send a test message',
                        icon: LucideIcons.send,
                        // Only once it is actually running: offering the test
                        // on a channel that has not started would fail for a
                        // reason the row already gives.
                        onTap: running
                            ? () => _client?.testChannel(widget.channel)
                            : null,
                      ),
                    ],
                  ),
                  if (_test != null) ...[
                    const SizedBox(height: 10),
                    _Result(
                      ok: _test?['ok'] == true,
                      detail: (_test?['detail'] as String?) ?? '',
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.hint,
    this.obscure = false,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final bool obscure;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: DexType.caption(color: DexColors.textDim)),
        const SizedBox(height: 4),
        TextField(
          controller: controller,
          obscureText: obscure,
          style: DexType.body(color: DexColors.text),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: DexType.caption(color: DexColors.textFaint),
            isDense: true,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            filled: true,
            fillColor: DexColors.surface2,
            border: OutlineInputBorder(
              borderRadius: DexRadius.rsm,
              borderSide: const BorderSide(color: DexColors.border),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: DexRadius.rsm,
              borderSide: const BorderSide(color: DexColors.border),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: DexRadius.rsm,
              borderSide: const BorderSide(color: DexColors.accent),
            ),
          ),
        ),
      ],
    );
  }
}

class _Button extends StatelessWidget {
  const _Button({required this.label, required this.icon, this.onTap});

  final String label;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return InkWell(
      onTap: onTap,
      borderRadius: DexRadius.rsm,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: enabled ? DexColors.accentQuiet : Colors.transparent,
          borderRadius: DexRadius.rsm,
          border: Border.all(color: DexColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon,
                size: 13,
                color: enabled ? DexColors.accent : DexColors.textFaint),
            const SizedBox(width: 6),
            Text(
              label,
              style: DexType.caption(
                color: enabled ? DexColors.text : DexColors.textFaint,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// What actually happened, in the words the core used.
///
/// A failure here names which part broke — Telegram refusing to message first,
/// Discord needing a shared server — because those are things the owner can
/// go and change.
class _Result extends StatelessWidget {
  const _Result({required this.ok, required this.detail});

  final bool ok;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final colour = ok ? DexColors.stateApprove : DexColors.stateError;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: colour.withValues(alpha: 0.08),
        borderRadius: DexRadius.rsm,
        border: Border.all(color: colour.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(ok ? LucideIcons.circle_check : LucideIcons.circle_x,
              size: 13, color: colour),
          const SizedBox(width: 8),
          Expanded(
            child: Text(detail, style: DexType.caption(color: DexColors.textDim)),
          ),
        ],
      ),
    );
  }
}
