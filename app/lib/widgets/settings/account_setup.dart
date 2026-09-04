// Connecting a Google or Microsoft account, and proving it connected.
//
// The row above this used to report "available" because a client id was
// *stored*. Storing a credential proves somebody typed something into a box —
// not that the id is right, the secret matches, consent was granted, or that
// the server's runner is installed. Each of those fails at the first real
// request, long after the screen said connected.
//
// So there are two things here: somewhere to put the credentials, and a button
// that actually starts the server and asks what it can do. The second is the
// one that means anything.
//
// Nothing is ever echoed back. The fields say whether a secret is stored, not
// what it is — the owner has no reason to read their own client secret out of
// Dex, and a screen that could show it is a screen that had it in memory on
// the way there.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/dex_gateway.dart';
import '../../theme/tokens.dart';

class AccountSetup extends StatefulWidget {
  const AccountSetup({super.key, this.account = 'google'});

  /// 'google' or 'ms365'.
  final String account;

  @override
  State<AccountSetup> createState() => _AccountSetupState();
}

class _AccountSetupState extends State<AccountSetup> {
  final _clientId = TextEditingController();
  final _clientSecret = TextEditingController();
  final _email = TextEditingController();

  bool _open = false;
  bool _asking = false;

  DexGatewayClient? get _client => DexGatewayClient.current;

  Map<String, dynamic>? get _state {
    for (final row in _client?.accounts ?? const <Map<String, dynamic>>[]) {
      if (row['id'] == widget.account) return row;
    }
    return null;
  }

  Map<String, dynamic>? get _test => _client?.connectorTests[widget.account];

  @override
  void initState() {
    super.initState();
    _client?.addListener(_onChange);
    _client?.listAccounts();
  }

  void _onChange() {
    if (mounted) setState(() => _asking = false);
  }

  @override
  void dispose() {
    _client?.removeListener(_onChange);
    _clientId.dispose();
    _clientSecret.dispose();
    _email.dispose();
    super.dispose();
  }

  void _save() {
    _client?.setAccount(
      widget.account,
      // An untouched box leaves what is stored alone. Sending an empty string
      // would clear it, which is not what "I only changed my email" means.
      clientId: _clientId.text.trim().isEmpty ? null : _clientId.text.trim(),
      clientSecret:
          _clientSecret.text.trim().isEmpty ? null : _clientSecret.text.trim(),
      email: _email.text.trim().isEmpty ? null : _email.text.trim(),
    );
    _clientId.clear();
    _clientSecret.clear();
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    final ready = state?['hasClientId'] == true && state?['hasClientSecret'] == true;
    final result = _test;
    final tools = (result?['tools'] as List?) ?? const [];

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
                    result?['ok'] == true
                        ? LucideIcons.circle_check
                        : ready
                            ? LucideIcons.circle_dashed
                            : LucideIcons.circle,
                    size: 14,
                    color: result?['ok'] == true
                        ? DexColors.stateApprove
                        : ready
                            ? DexColors.stateAwaiting
                            : DexColors.textFaint,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    (state?['name'] as String?) ?? 'Google Workspace',
                    style: DexType.label(color: DexColors.text),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      result?['ok'] == true
                          ? (result?['detail'] as String? ?? 'connected')
                          : ready
                              ? 'credentials saved — not tested yet'
                              : 'not set up',
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
                  Text(
                    'From console.cloud.google.com → APIs & Services → '
                    'Credentials → OAuth client ID (Desktop app).',
                    style: DexType.caption(color: DexColors.textFaint),
                  ),
                  const SizedBox(height: 10),
                  _Field(
                    controller: _clientId,
                    label: 'Client ID',
                    hint: state?['hasClientId'] == true
                        ? 'Saved — type a new one to replace it'
                        : 'xxxxx.apps.googleusercontent.com',
                  ),
                  const SizedBox(height: 10),
                  _Field(
                    controller: _clientSecret,
                    label: 'Client secret',
                    hint: state?['hasClientSecret'] == true
                        ? 'Saved — type a new one to replace it'
                        : 'The secret from the same page',
                    obscure: true,
                  ),
                  const SizedBox(height: 10),
                  _Field(
                    controller: _email,
                    label: 'Which account',
                    hint: state?['hasEmail'] == true
                        ? 'Saved — type a new one to replace it'
                        : 'you@gmail.com',
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _Button(
                        label: 'Save',
                        icon: LucideIcons.save,
                        onTap: _save,
                      ),
                      const SizedBox(width: 8),
                      _Button(
                        // The one that means something. It starts the server
                        // and lists its tools — the cheapest call that
                        // exercises spawn, handshake and credentials.
                        label: _asking ? 'Connecting…' : 'Test the connection',
                        icon: LucideIcons.plug,
                        onTap: !ready || _asking
                            ? null
                            : () {
                                setState(() => _asking = true);
                                _client?.testAccount(widget.account);
                              },
                      ),
                    ],
                  ),
                  if (!ready) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Save a client ID and secret before testing.',
                      style: DexType.caption(color: DexColors.textFaint),
                    ),
                  ],
                  if (result != null) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: (result['ok'] == true
                                ? DexColors.stateApprove
                                : DexColors.stateError)
                            .withValues(alpha: 0.08),
                        borderRadius: DexRadius.rsm,
                        border: Border.all(
                          color: (result['ok'] == true
                                  ? DexColors.stateApprove
                                  : DexColors.stateError)
                              .withValues(alpha: 0.4),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            (result['detail'] as String?) ?? '',
                            style: DexType.caption(color: DexColors.textDim),
                          ),
                          if (tools.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              // The list is the answer. "Connected" is not.
                              tools.take(10).join(', ') +
                                  (tools.length > 10 ? ' …' : ''),
                              style: DexType.caption(color: DexColors.textFaint),
                            ),
                          ],
                        ],
                      ),
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
