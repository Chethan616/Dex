// What Dex thinks with.
//
// Two tiers, and they are deliberately not presented as equals:
//
//   Claude Code   Recommended. Nothing to paste, nothing extra to pay if you
//                 already have Claude Pro or Max, and it is the account you
//                 are already signed in to.
//   API keys      For anyone without a Claude subscription, or who would
//                 rather Dex ran on their own key.
//
// Everything here round-trips through the core. The app never holds a key: a
// secret goes one way into the DPAPI credential store, and what comes back is
// its last four characters. A settings screen that decrypted keys to populate
// its own text fields would quietly undo the reason that store exists.

import 'package:flutter/material.dart';

import '../../../core/dex_gateway.dart';
import '../../../core/models/brain_settings.dart';
import '../../../theme/tokens.dart';
import '../../glass_text_field.dart';
import '../full_access_card.dart';
import '../site_signin_card.dart';

class IntelligenceTab extends StatefulWidget {
  const IntelligenceTab({super.key, required this.client});

  final DexGatewayClient client;

  @override
  State<IntelligenceTab> createState() => _IntelligenceTabState();
}

class _IntelligenceTabState extends State<IntelligenceTab> {
  @override
  void initState() {
    super.initState();
    widget.client.addListener(_onChange);
    widget.client.refreshSettings();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.client.removeListener(_onChange);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = widget.client.settings;

    if (settings == null) {
      return const Center(
        child: SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(strokeWidth: 2, color: DexColors.accent),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(28, 24, 28, 40),
      children: [
        const _SectionTitle('Brain'),
        const _SectionBlurb(
          'Which model decides what Dex should do. Everything else — pressing '
          'buttons, reading the screen, changing settings — is direct Windows '
          'API calls and uses no model at all.',
        ),
        const SizedBox(height: 18),

        _ClaudeCard(client: widget.client, settings: settings),
        const SizedBox(height: 14),
        _KeysCard(client: widget.client, settings: settings),

        if (widget.client.lastError != null) ...[
          const SizedBox(height: 14),
          _Banner(
            tone: DexColors.stateError,
            icon: Icons.error_outline_rounded,
            text: widget.client.lastError!,
          ),
        ],

        const SizedBox(height: 32),
        const _SectionTitle('Permissions'),
        const _SectionBlurb(
          'Whether Dex asks before each privileged step, or gets on with it.',
        ),
        const SizedBox(height: 14),
        FullAccessCard(client: widget.client),

        const SizedBox(height: 32),
        const _SectionTitle('Site sign-ins'),
        const _SectionBlurb(
          'A login Dex can fill for you, on one site and nowhere else.',
        ),
        const SizedBox(height: 14),
        SiteSignInCard(client: widget.client),

        const SizedBox(height: 32),
        const _SectionTitle('Where things are kept'),
        const SizedBox(height: 10),
        const _PathRow('Settings', r'%LOCALAPPDATA%\DEX\settings.json'),
        const _PathRow('API keys', r'%LOCALAPPDATA%\DEX\credentials  (encrypted)'),
        const _PathRow('Logs', r'%LOCALAPPDATA%\DEX\*.log'),
        const SizedBox(height: 8),
        const Text(
          'Keys are encrypted by Windows against this account, so they are '
          'unreadable on any other machine — and they are never in the project '
          'folder or in a settings file.',
          style: TextStyle(color: DexColors.textFaint, fontSize: 12, height: 1.5),
        ),
      ],
    );
  }
}

// ── the recommended tier ──────────────────────────────────────────────────────

class _ClaudeCard extends StatelessWidget {
  const _ClaudeCard({required this.client, required this.settings});

  final DexGatewayClient client;
  final BrainSettings settings;

  @override
  Widget build(BuildContext context) {
    final selected = settings.usingClaudeCode;
    final claude = settings.claude;

    return _Card(
      selected: selected,
      tone: DexColors.stateThinking,
      icon: Icons.auto_awesome_rounded,
      title: 'Claude Code',
      badge: 'RECOMMENDED',
      subtitle:
          'Uses the Claude you are already signed in to on this machine. No API '
          'key, and nothing extra to pay if you have Claude Pro or Max.',
      action: selected
          ? const _InUse()
          : _Choose(
              enabled: claude.usable,
              onTap: () => client.setBrain('claude-code', model: 'haiku'),
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Requirement(
            met: claude.installed,
            label: claude.installed
                ? 'Claude Code CLI${claude.version != null ? " ${claude.version}" : ""}'
                : 'Claude Code CLI is not installed',
            fix: 'npm i -g @anthropic-ai/claude-code',
          ),
          const SizedBox(height: 10),
          _Requirement(
            met: claude.signedIn,
            label: claude.signedIn ? 'Signed in' : 'Not signed in',
            fix: 'Sign in below — it opens your browser.',
            action: claude.installed && !claude.signedIn
                ? _SmallButton(
                    label: 'Sign in',
                    onTap: client.signInToClaude,
                  )
                : null,
          ),
          if (client.claudeSignInStarted) ...[
            const SizedBox(height: 10),
            const _Banner(
              tone: DexColors.stateActing,
              icon: Icons.open_in_new_rounded,
              text: 'A window has opened to finish signing in. Come back here '
                  'when it is done and this will turn green.',
            ),
          ],
          if (client.claudeSignInError != null) ...[
            const SizedBox(height: 10),
            _Banner(
              tone: DexColors.stateError,
              icon: Icons.error_outline_rounded,
              text: client.claudeSignInError!,
            ),
          ],
          if (selected) ...[
            const SizedBox(height: 18),
            _ModelPicker(client: client, settings: settings),
            const SizedBox(height: 16),
            _TestRow(client: client, provider: 'claude-code'),
          ],
        ],
      ),
    );
  }
}

/// Haiku, Sonnet, Opus — with the honest note that none of them are fast here.
class _ModelPicker extends StatelessWidget {
  const _ModelPicker({required this.client, required this.settings});

  final DexGatewayClient client;
  final BrainSettings settings;

  @override
  Widget build(BuildContext context) {
    final current = settings.model.isEmpty ? 'haiku' : settings.model;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'MODEL',
          style: TextStyle(
            color: DexColors.textFaint,
            fontSize: 10,
            letterSpacing: 1.2,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            for (final model in settings.claudeModels) ...[
              Expanded(
                child: _ModelChip(
                  model: model,
                  selected: model.id == current,
                  onTap: () => client.setBrain('claude-code', model: model.id),
                ),
              ),
              if (model != settings.claudeModels.last) const SizedBox(width: 8),
            ],
          ],
        ),
        const SizedBox(height: 10),
        Text(
          settings.claudeModels
                  .where((m) => m.id == current)
                  .map((m) => m.blurb)
                  .firstOrNull ??
              '',
          style: const TextStyle(
            color: DexColors.textDim,
            fontSize: 12,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 8),
        // Said once, plainly, because it is the thing people assume wrongly.
        const Text(
          'All three take about 20–30 seconds to plan. That is the cost of '
          'starting a Claude Code session, not of the model — a smaller one is '
          'not faster here. Groq answers in about two seconds if you need speed '
          'more than judgement.',
          style: TextStyle(color: DexColors.textFaint, fontSize: 11, height: 1.5),
        ),
      ],
    );
  }
}

class _ModelChip extends StatelessWidget {
  const _ModelChip({
    required this.model,
    required this.selected,
    required this.onTap,
  });

  final ClaudeModel model;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 12),
        decoration: BoxDecoration(
          color: selected
              ? DexColors.stateThinking.withValues(alpha: 0.16)
              : DexColors.surface2.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected
                ? DexColors.stateThinking.withValues(alpha: 0.6)
                : DexColors.border,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  model.label,
                  style: TextStyle(
                    color: selected ? DexColors.text : DexColors.textDim,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (model.recommended) ...[
                  const SizedBox(width: 6),
                  const Icon(Icons.star_rounded,
                      size: 12, color: DexColors.stateAwaiting),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── the API-key tier ──────────────────────────────────────────────────────────

class _KeysCard extends StatelessWidget {
  const _KeysCard({required this.client, required this.settings});

  final DexGatewayClient client;
  final BrainSettings settings;

  @override
  Widget build(BuildContext context) {
    final selected = !settings.usingClaudeCode;
    final options =
        settings.providers.where((p) => p.id != 'claude-code').toList();

    return _Card(
      selected: selected,
      tone: DexColors.accent,
      icon: Icons.vpn_key_rounded,
      title: 'Your own API key',
      subtitle:
          'Dex calls the provider directly with a key you supply. Billed to you '
          'by them. Faster than Claude Code, and the only option without a '
          'Claude subscription.',
      action: selected ? const _InUse() : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final provider in options) ...[
            _ProviderRow(
              client: client,
              provider: provider,
              credential: provider.credential == null
                  ? null
                  : settings.credential(provider.credential!),
              selected: selected && settings.provider == provider.id,
            ),
            const SizedBox(height: 10),
          ],
          if (selected) ...[
            const SizedBox(height: 6),
            _TestRow(client: client, provider: settings.provider),
          ],
        ],
      ),
    );
  }
}

class _ProviderRow extends StatefulWidget {
  const _ProviderRow({
    required this.client,
    required this.provider,
    required this.credential,
    required this.selected,
  });

  final DexGatewayClient client;
  final BrainProvider provider;
  final CredentialStatus? credential;
  final bool selected;

  @override
  State<_ProviderRow> createState() => _ProviderRowState();
}

class _ProviderRowState extends State<_ProviderRow> {
  final _controller = TextEditingController();
  bool _editing = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _save() {
    final value = _controller.text.trim();
    if (value.isEmpty || widget.provider.credential == null) return;
    widget.client.setCredential(widget.provider.credential!, value);
    // Cleared at once. A key has no business staying in a text field after it
    // has been handed over — that is one screenshot away from being shared.
    _controller.clear();
    setState(() => _editing = false);
  }

  @override
  Widget build(BuildContext context) {
    final credential = widget.credential;
    final stored = credential?.stored ?? false;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: widget.selected
            ? DexColors.accentQuiet.withValues(alpha: 0.5)
            : DexColors.surface2.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: widget.selected ? DexColors.accent.withValues(alpha: 0.5) : DexColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.provider.label,
                  style: const TextStyle(
                    color: DexColors.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (stored)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: DexColors.stateApprove.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    credential?.hint != null ? '••••${credential!.hint}' : 'stored',
                    style: const TextStyle(
                      color: DexColors.stateApprove,
                      fontSize: 10,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
              if (stored && !widget.selected) ...[
                const SizedBox(width: 8),
                _SmallButton(
                  label: 'Use this',
                  onTap: () => widget.client.setBrain(widget.provider.id),
                ),
              ],
            ],
          ),
          const SizedBox(height: 4),
          Text(
            widget.provider.blurb,
            style: const TextStyle(
              color: DexColors.textDim,
              fontSize: 11.5,
              height: 1.45,
            ),
          ),
          if (credential?.note != null) ...[
            const SizedBox(height: 8),
            _Banner(
              tone: DexColors.stateAwaiting,
              icon: Icons.info_outline_rounded,
              text: credential!.note!,
            ),
          ],
          const SizedBox(height: 10),
          if (_editing)
            Row(
              children: [
                Expanded(
                  child: DexGlassField(
                    controller: _controller,
                    hint: 'Paste your ${widget.provider.label} key',
                    onSubmitted: (_) => _save(),
                  ),
                ),
                const SizedBox(width: 8),
                _SmallButton(label: 'Save', onTap: _save, primary: true),
                const SizedBox(width: 6),
                _SmallButton(
                  label: 'Cancel',
                  onTap: () {
                    _controller.clear();
                    setState(() => _editing = false);
                  },
                ),
              ],
            )
          else
            Row(
              children: [
                _SmallButton(
                  label: stored ? 'Replace key' : 'Add key',
                  primary: !stored,
                  onTap: () => setState(() => _editing = true),
                ),
                if (stored) ...[
                  const SizedBox(width: 6),
                  _SmallButton(
                    label: 'Remove',
                    danger: true,
                    onTap: () => widget.client
                        .deleteCredential(widget.provider.credential!),
                  ),
                ],
                const Spacer(),
                if (credential != null)
                  Expanded(
                    child: Text(
                      credential.source,
                      textAlign: TextAlign.right,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: DexColors.textFaint,
                        fontSize: 10.5,
                      ),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

// ── shared pieces ─────────────────────────────────────────────────────────────

class _Card extends StatelessWidget {
  const _Card({
    required this.selected,
    required this.tone,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.child,
    this.badge,
    this.action,
  });

  final bool selected;
  final Color tone;
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget child;
  final String? badge;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: selected
            ? tone.withValues(alpha: 0.07)
            : DexColors.surface.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: selected ? tone.withValues(alpha: 0.55) : DexColors.border,
          width: selected ? 1.4 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 19, color: selected ? tone : DexColors.textDim),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            color: DexColors.text,
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (badge != null) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: tone.withValues(alpha: 0.18),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              badge!,
                              style: TextStyle(
                                color: tone,
                                fontSize: 9,
                                letterSpacing: 0.8,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: DexColors.textDim,
                        fontSize: 12,
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
              if (action != null) ...[const SizedBox(width: 12), action!],
            ],
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}

class _InUse extends StatelessWidget {
  const _InUse();

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: DexColors.stateApprove.withValues(alpha: 0.16),
          borderRadius: BorderRadius.circular(999),
        ),
        child: const Text(
          'IN USE',
          style: TextStyle(
            color: DexColors.stateApprove,
            fontSize: 9.5,
            letterSpacing: 0.9,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
}

class _Choose extends StatelessWidget {
  const _Choose({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    if (!enabled) {
      return const Text(
        'unavailable',
        style: TextStyle(color: DexColors.textFaint, fontSize: 11),
      );
    }
    return _SmallButton(label: 'Use this', onTap: onTap, primary: true);
  }
}

class _Requirement extends StatelessWidget {
  const _Requirement({
    required this.met,
    required this.label,
    required this.fix,
    this.action,
  });

  final bool met;
  final String label;
  final String fix;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          met ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
          size: 15,
          color: met ? DexColors.stateApprove : DexColors.stateAwaiting,
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: met ? DexColors.text : DexColors.stateAwaiting,
                  fontSize: 12.5,
                ),
              ),
              if (!met) ...[
                const SizedBox(height: 3),
                Text(
                  fix,
                  style: const TextStyle(
                    color: DexColors.textFaint,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  ),
                ),
              ],
            ],
          ),
        ),
        if (action != null) action!,
      ],
    );
  }
}

/// One real call, and what came back.
class _TestRow extends StatelessWidget {
  const _TestRow({required this.client, required this.provider});

  final DexGatewayClient client;
  final String provider;

  @override
  Widget build(BuildContext context) {
    final result = client.lastTest;
    final testing = client.testing == provider;

    return Row(
      children: [
        _SmallButton(
          label: 'Test it',
          onTap: () => client.testProvider(provider),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: testing
              ? const Row(
                  children: [
                    SizedBox(
                      width: 11,
                      height: 11,
                      child: CircularProgressIndicator(
                          strokeWidth: 1.8, color: DexColors.accent),
                    ),
                    SizedBox(width: 8),
                    Text('Asking it something…',
                        style: TextStyle(
                            color: DexColors.textDim, fontSize: 11.5)),
                  ],
                )
              : result == null
                  ? const SizedBox.shrink()
                  : Text(
                      result['ok'] == true
                          ? '${result['provider']} answered in ${result['latencyMs']}ms.'
                          : (result['error'] as String? ?? 'It did not answer.'),
                      style: TextStyle(
                        color: result['ok'] == true
                            ? DexColors.stateApprove
                            : DexColors.stateError,
                        fontSize: 11.5,
                        height: 1.4,
                      ),
                    ),
        ),
      ],
    );
  }
}

class _SmallButton extends StatelessWidget {
  const _SmallButton({
    required this.label,
    required this.onTap,
    this.primary = false,
    this.danger = false,
  });

  final String label;
  final VoidCallback onTap;
  final bool primary;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final tone = danger
        ? DexColors.stateError
        : primary
            ? DexColors.accent
            : DexColors.textDim;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: primary
              ? DexColors.accent.withValues(alpha: 0.18)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: tone.withValues(alpha: 0.45)),
        ),
        child: Text(
          label,
          style: TextStyle(color: tone, fontSize: 11.5, fontWeight: FontWeight.w500),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.tone, required this.icon, required this.text});

  final Color tone;
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: tone.withValues(alpha: 0.3)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 13, color: tone),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                text,
                style: TextStyle(color: tone, fontSize: 11.5, height: 1.45),
              ),
            ),
          ],
        ),
      );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(
          color: DexColors.text,
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      );
}

class _SectionBlurb extends StatelessWidget {
  const _SectionBlurb(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 5),
        child: Text(
          text,
          style: const TextStyle(
            color: DexColors.textDim,
            fontSize: 12.5,
            height: 1.55,
          ),
        ),
      );
}

class _PathRow extends StatelessWidget {
  const _PathRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 90,
              child: Text(label,
                  style: const TextStyle(
                      color: DexColors.textDim, fontSize: 11.5)),
            ),
            Expanded(
              child: Text(
                value,
                style: const TextStyle(
                  color: DexColors.textFaint,
                  fontSize: 11,
                  fontFamily: 'monospace',
                ),
              ),
            ),
          ],
        ),
      );
}
