// Site sign-ins — the credential Dex fills, and the boundary around it.
//
// This exists so storing a portal login is not a terminal-only feature. It is
// also the place the boundary gets explained, because a screen that asks for a
// password without saying what will be done with it is asking the owner to
// trust a black box.
//
// What it says is what the code does, and both halves matter:
//
//   * The credential is bound to one host. It is never offered to a subdomain,
//     a lookalike, or a page that redirected somewhere else — the checks are in
//     agents/browser/site_credentials.py and the tests that pin them are in
//     tests/test_site_credentials.py.
//
//   * The CAPTCHA is not automated, on purpose. It is the site's control, not
//     the owner's, and Dex does the typing rather than the deciding. Because
//     the session is then kept, that is a once-a-day interaction rather than a
//     per-task one — which is the thing worth saying here, since otherwise
//     "you still do the CAPTCHA" reads as the feature not working.

import 'dart:convert';

import 'package:flutter/material.dart';

import '../../core/dex_gateway.dart';
import '../../theme/tokens.dart';
import '../secret_field.dart';

class SiteSignInCard extends StatefulWidget {
  const SiteSignInCard({super.key, required this.client});

  final DexGatewayClient client;

  @override
  State<SiteSignInCard> createState() => _SiteSignInCardState();
}

class _SiteSignInCardState extends State<SiteSignInCard> {
  final _site = TextEditingController();
  final _username = TextEditingController();
  final _password = TextEditingController();

  String? _saved;
  String? _error;

  @override
  void dispose() {
    _site.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  /// The hostname, however the owner typed the address.
  ///
  /// Mirrors `host_of` in site_credentials.py deliberately: the value stored
  /// here is compared against the page's host at sign-in time, and two
  /// different ideas of "the host" would mean a credential that silently never
  /// matches.
  String _host(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return '';
    final withScheme = text.contains('://') ? text : 'https://$text';
    try {
      return Uri.parse(withScheme).host.toLowerCase().replaceAll(RegExp(r'\.$'), '');
    } catch (_) {
      return text.toLowerCase().split('/').first;
    }
  }

  void _save() {
    final host = _host(_site.text);
    final user = _username.text.trim();
    final pass = _password.text;

    if (host.isEmpty) {
      setState(() => _error = 'Which site? For example vtop.vit.ac.in');
      return;
    }
    if (user.isEmpty && pass.isEmpty) {
      setState(() => _error = 'Add a username, a password, or both.');
      return;
    }

    widget.client.setCredential(
      'site.$host',
      jsonEncode({'username': user, 'password': pass}),
    );

    setState(() {
      _saved = host;
      _error = null;
      // The password does not stay on screen after it is stored. There is no
      // read-back for it either — nothing in the app can display it again.
      _password.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DexColors.surface.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: DexColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Sign Dex in to a site',
            style: TextStyle(
              color: DexColors.text,
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'For a portal you use often. Dex fills these on that site and '
            'nowhere else — not on a subdomain, not on a lookalike domain, and '
            'not on a page that redirected somewhere else.',
            style: TextStyle(color: DexColors.textDim, fontSize: 12, height: 1.5),
          ),
          const SizedBox(height: 14),

          _Field(label: 'Site', hint: 'vtop.vit.ac.in', controller: _site),
          const SizedBox(height: 10),
          _Field(label: 'Username', hint: 'your registration number', controller: _username),
          const SizedBox(height: 10),
          Row(
            children: [
              const SizedBox(
                width: 84,
                child: Text('Password',
                    style: TextStyle(color: DexColors.textDim, fontSize: 12)),
              ),
              Expanded(
                child: SecretField(
                  controller: _password,
                  hint: 'stored encrypted, never shown again',
                  onSubmitted: (_) => _save(),
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),
          Row(
            children: [
              _SaveButton(onTap: _save),
              const SizedBox(width: 12),
              if (_saved != null)
                Expanded(
                  child: Text(
                    'Saved for $_saved.',
                    style: const TextStyle(
                      color: DexColors.stateApprove, fontSize: 11.5,
                    ),
                  ),
                ),
              if (_error != null)
                Expanded(
                  child: Text(
                    _error!,
                    style: const TextStyle(
                      color: DexColors.stateError, fontSize: 11.5,
                    ),
                  ),
                ),
            ],
          ),

          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: DexColors.surface2.withValues(alpha: 0.35),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Text(
              'You still do the CAPTCHA. It is the site’s check against '
              'automation, not yours to waive, so Dex does the typing and hands '
              'you the last step. The session is kept afterwards — so that '
              'is once a day, not once a task.',
              style: TextStyle(
                color: DexColors.textFaint, fontSize: 11.5, height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.hint, required this.controller});

  final String label;
  final String hint;
  final TextEditingController controller;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          SizedBox(
            width: 84,
            child: Text(
              label,
              style: const TextStyle(color: DexColors.textDim, fontSize: 12),
            ),
          ),
          Expanded(
            child: SizedBox(
              height: 32,
              child: TextField(
                controller: controller,
                style: const TextStyle(color: DexColors.text, fontSize: 12.5),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: hint,
                  hintStyle: const TextStyle(
                    color: DexColors.textFaint, fontSize: 12,
                  ),
                  filled: true,
                  fillColor: DexColors.surface2.withValues(alpha: 0.4),
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: DexColors.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: DexColors.border),
                  ),
                ),
              ),
            ),
          ),
        ],
      );
}

class _SaveButton extends StatelessWidget {
  const _SaveButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: DexColors.accent.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: DexColors.accent.withValues(alpha: 0.4)),
            ),
            child: const Text(
              'Store it',
              style: TextStyle(
                color: DexColors.accent,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      );
}
