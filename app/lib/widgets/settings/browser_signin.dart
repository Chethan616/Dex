// Sign in to your own accounts, in the browser Dex uses.
//
// Dex browses with its own profile so its session cannot touch yours. That is
// the right default and it has a cost: Dex is signed in to nothing, so every
// site behind a login goes through the hand-off — Dex stops, you type the
// password, Dex carries on. Once per site, per session. Doing that on VTOP, on
// Gmail and on a bank is three interruptions to answer one question.
//
// This opens that profile as an ordinary browser window. You sign in the way
// you would anywhere else; Dex never sees the password and nothing is
// automated. Afterwards those sites are simply open to it.
//
// It is your decision because it is a real one: an account signed in here is
// an account Dex can act as.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/dex_gateway.dart';
import '../../theme/tokens.dart';

class BrowserSignIn extends StatefulWidget {
  const BrowserSignIn({super.key});

  @override
  State<BrowserSignIn> createState() => _BrowserSignInState();
}

class _BrowserSignInState extends State<BrowserSignIn> {
  DexGatewayClient? get _client => DexGatewayClient.current;
  Map<String, dynamic>? get _result => _client?.browserProfileResult;

  @override
  void initState() {
    super.initState();
    _client?.addListener(_onChange);
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _client?.removeListener(_onChange);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final ok = result?['ok'] == true;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DexColors.surface.withValues(alpha: 0.35),
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(LucideIcons.key_round,
                  size: 14, color: DexColors.accent),
              const SizedBox(width: 8),
              Text('Sign in to your accounts',
                  style: DexType.label(color: DexColors.text)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Dex browses in its own profile, so it is signed in to nothing and '
            'asks you to type a password on every site. Sign in once here and '
            'it stops asking.',
            style: DexType.caption(color: DexColors.textFaint),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (final browser in const ['chrome', 'edge', 'brave', 'vivaldi'])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: _Chip(
                    label: browser,
                    onTap: () => _client?.openBrowserProfile(browser: browser),
                  ),
                ),
            ],
          ),
          if (result != null) ...[
            const SizedBox(height: 10),
            Text(
              ok
                  ? (result['detail'] as String? ?? 'Opened.')
                  : (result['error'] as String? ?? 'Could not open it.'),
              style: DexType.caption(
                color: ok ? DexColors.stateApprove : DexColors.stateError,
              ),
            ),
            if (ok && result['profile'] is String)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  result['profile'] as String,
                  style: DexType.caption(color: DexColors.textFaint),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: DexRadius.rsm,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: DexColors.accentQuiet,
          borderRadius: DexRadius.rsm,
          border: Border.all(color: DexColors.border),
        ),
        child: Text(label, style: DexType.caption(color: DexColors.text)),
      ),
    );
  }
}
