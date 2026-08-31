import 'package:flutter/material.dart';

import '../../core/gateway_client.dart';
import '../../core/settings_models.dart';
import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../../widgets/primitives/primitives.dart';
import '../../widgets/secret_field.dart';

/// The two ways to give Dex a brain, side by side.
///
/// They are mutually exclusive and shown that way: choosing one visibly stands
/// the other down. That is the honest shape of the decision — Dex plans with
/// exactly one provider, and a settings page that lets you tick both leaves you
/// guessing which one is actually being spent.
class BrainCards extends StatelessWidget {
  const BrainCards({super.key, required this.client, required this.settings});

  final GatewayClient client;
  final SettingsSnapshot settings;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final side = constraints.maxWidth < 900;
        final cards = [
          Expanded(
            flex: side ? 0 : 1,
            child: OwnKeysCard(client: client, settings: settings),
          ),
          SizedBox(
            width: side ? 0 : DexTokens.spaceLg,
            height: side ? DexTokens.spaceLg : 0,
          ),
          Expanded(
            flex: side ? 0 : 1,
            child: ClaudeCodeCard(client: client, settings: settings),
          ),
        ];

        return side
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: cards.map(_unflex).toList(),
              )
            : IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: cards,
                ),
              );
      },
    );
  }

  /// Expanded is meaningless in a Column laid out by content; unwrap it.
  static Widget _unflex(Widget w) => w is Expanded ? w.child : w;
}

/// Card one — your own API keys.
class OwnKeysCard extends StatelessWidget {
  const OwnKeysCard({super.key, required this.client, required this.settings});

  final GatewayClient client;
  final SettingsSnapshot settings;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final selected = !settings.usingClaudeCode;
    final brainKeys = settings.inGroup('brain');

    return _ChoiceCard(
      selected: selected,
      icon: Icons.vpn_key_rounded,
      title: 'Your own API keys',
      subtitle:
          'Dex calls the provider directly with a key you supply. Billed to you '
          'by them.',
      tone: t.accent,
      onChoose: selected
          ? null
          : () => client.setEnv({
                'DEX_BRAIN_PROVIDER': _preferredProvider(brainKeys),
                'DEX_BRAIN_MODEL': null,
              }),
      chooseLabel: 'Use API keys',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final credential in brainKeys) ...[
            SecretField(
              credential: credential,
              busy: client.settingsBusy,
              onSave: (value) => client.setCredential(credential.name, value),
              onClear: () => client.deleteCredential(credential.name),
            ),
            const SizedBox(height: DexTokens.spaceMd),
          ],
          if (selected) ...[
            _BrainChooser(client: client, settings: settings),
            const SizedBox(height: DexTokens.spaceMd),
            Row(
              children: [
                DexButton(
                  label: 'Test it',
                  icon: Icons.bolt_rounded,
                  dense: true,
                  enabled: client.testingProvider == null,
                  onTap: () => client.testProvider(settings.brainProvider),
                ),
                const SizedBox(width: DexTokens.spaceMd),
                Expanded(
                  child: ProviderTestRow(
                    result: client.lastProviderTest,
                    testing: client.testingProvider != null &&
                        client.testingProvider != 'claude-code',
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// Prefer a provider whose key is already stored, so switching back from
  /// Claude Code lands somewhere that works rather than on an error.
  static String _preferredProvider(List<CredentialStatus> brainKeys) {
    for (final name in ['groq_api_key', 'anthropic_api_key']) {
      final match = brainKeys.where((c) => c.name == name);
      if (match.isNotEmpty && match.first.present) {
        return name == 'groq_api_key' ? 'groq' : 'anthropic';
      }
    }
    return 'groq';
  }
}

/// Card two — the Claude Code you are already signed in to.
///
/// This is the "no API key" path: if you pay for Claude Pro or Max, Dex can
/// plan on that subscription and there is nothing extra to buy.
///
/// The card is honest about three things, because each of them is the kind of
/// limitation people discover at the worst moment:
///
///   * it needs the `claude` CLI installed *and* signed in, and it says which
///     of the two is missing;
///   * it is a text interface, so Dex asks for JSON and parses it rather than
///     receiving a native tool call — less reliable than the API-key path;
///   * a usage limit on the subscription stops Dex, and that is the
///     subscription's limit, not a Dex bug.
class ClaudeCodeCard extends StatelessWidget {
  const ClaudeCodeCard({super.key, required this.client, required this.settings});

  final GatewayClient client;
  final SettingsSnapshot settings;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final status = settings.claudeCode;
    final selected = settings.usingClaudeCode;

    return _ChoiceCard(
      selected: selected,
      icon: Icons.auto_awesome_rounded,
      title: 'Claude Code',
      subtitle:
          'Use the Claude you are already signed in to on this machine. No key '
          'to paste, and nothing extra to pay with Claude Pro or Max.',
      tone: t.attention,
      onChoose: selected || !status.usable
          ? null
          : () => client.setEnv({
                'DEX_BRAIN_PROVIDER': 'claude-code',
                'DEX_BRAIN_MODEL': 'sonnet',
              }),
      chooseLabel: 'Use Claude Code',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Requirement(
            met: status.installed,
            label: status.installed
                ? 'Claude Code CLI${status.version != null ? " ${status.version}" : ""}'
                : 'Claude Code CLI is not installed',
            fix: 'npm i -g @anthropic-ai/claude-code',
          ),
          const SizedBox(height: DexTokens.spaceSm),
          _Requirement(
            met: status.signedIn,
            label: status.signedIn ? 'Signed in' : 'Not signed in',
            fix: 'Run `claude` in a terminal once and log in',
          ),
          const SizedBox(height: DexTokens.spaceMd),
          _Caveat(
            text: 'Claude Code answers in text, so Dex asks for JSON and parses '
                'the reply. That is less reliable than the tool calls the API-key '
                'path gets. If planning starts failing to parse, switch back.',
          ),
          const SizedBox(height: DexTokens.spaceSm),
          _Caveat(
            text: 'Dex runs it with no tools and no file access. Claude Code is '
                'asked for one judgement — Dex is the agent here.',
          ),
          if (selected) ...[
            const SizedBox(height: DexTokens.spaceMd),
            Row(
              children: [
                DexButton(
                  label: 'Test it',
                  icon: Icons.bolt_rounded,
                  dense: true,
                  enabled: client.testingProvider == null,
                  onTap: () => client.testProvider('claude-code'),
                ),
                const SizedBox(width: DexTokens.spaceMd),
                Expanded(
                  child: ProviderTestRow(
                    result: client.lastProviderTest,
                    testing: client.testingProvider == 'claude-code',
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// One of two mutually exclusive choices.
class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    required this.selected,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.tone,
    required this.chooseLabel,
    required this.onChoose,
    required this.child,
  });

  final bool selected;
  final IconData icon;
  final String title;
  final String subtitle;
  final Color tone;
  final String chooseLabel;
  final VoidCallback? onChoose;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return AnimatedOpacity(
      duration: DexMotion.durationOf(context, DexMotion.medium),
      // The unselected card stays legible — you have to be able to read what
      // you are switching to — but is plainly not the live one.
      opacity: selected ? 1 : 0.72,
      child: DexPanel(
        padding: const EdgeInsets.all(DexTokens.spaceLg),
        accent: selected ? tone : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 20, color: selected ? tone : t.textMuted),
                const SizedBox(width: DexTokens.spaceMd),
                Expanded(
                  child: Text(title, style: DexType.title(color: t.text)),
                ),
                if (selected)
                  DexTag('In use', tone: tone)
                else if (onChoose != null)
                  DexButton(label: chooseLabel, dense: true, onTap: onChoose!)
                else
                  DexTag('Unavailable',
                      tone: t.textFaint, filled: false, outlined: true),
              ],
            ),
            const SizedBox(height: DexTokens.spaceSm),
            Text(subtitle, style: DexType.caption(color: t.textMuted)),
            const SizedBox(height: DexTokens.spaceLg),
            child,
          ],
        ),
      ),
    );
  }
}

class _Requirement extends StatelessWidget {
  const _Requirement({required this.met, required this.label, required this.fix});

  final bool met;
  final String label;
  final String fix;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          met ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
          size: 15,
          color: met ? t.positive : t.warn,
        ),
        const SizedBox(width: DexTokens.spaceSm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: DexType.body(color: met ? t.text : t.warn),
              ),
              if (!met) ...[
                const SizedBox(height: 2),
                Text(fix, style: DexType.code(color: t.textMuted)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _Caveat extends StatelessWidget {
  const _Caveat({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Container(
            width: 3,
            height: 3,
            decoration: BoxDecoration(color: t.textFaint, shape: BoxShape.circle),
          ),
        ),
        const SizedBox(width: DexTokens.spaceSm),
        Expanded(child: Text(text, style: DexType.caption(color: t.textFaint))),
      ],
    );
  }
}

/// Which provider, and which model.
class _BrainChooser extends StatelessWidget {
  const _BrainChooser({required this.client, required this.settings});

  final GatewayClient client;
  final SettingsSnapshot settings;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final options =
        settings.brainProviders.where((p) => p.id != 'claude-code').toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Which one plans', style: DexType.label(color: t.textMuted)),
        const SizedBox(height: DexTokens.spaceSm),
        Wrap(
          spacing: DexTokens.spaceSm,
          runSpacing: DexTokens.spaceSm,
          children: [
            for (final option in options)
              DexButton(
                label: option.label,
                dense: true,
                variant: settings.brainProvider == option.id
                    ? DexButtonVariant.primary
                    : DexButtonVariant.secondary,
                onTap: () => client.setEnv({
                  'DEX_BRAIN_PROVIDER': option.id,
                  // Clear rather than carry over: a Groq model name handed to
                  // Anthropic is a 404 that reads like a broken key.
                  'DEX_BRAIN_MODEL': null,
                }),
              ),
          ],
        ),
        const SizedBox(height: DexTokens.spaceSm),
        Text(
          options
              .where((o) => o.id == settings.brainProvider)
              .map((o) => o.blurb)
              .firstOrNull ??
              'Pick one, and store its key above.',
          style: DexType.caption(color: t.textFaint),
        ),
      ],
    );
  }
}
