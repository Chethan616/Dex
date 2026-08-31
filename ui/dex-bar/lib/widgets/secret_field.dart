import 'package:flutter/material.dart';

import '../core/settings_models.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'primitives/primitives.dart';

/// One credential: what it is for, where to get one, and a way to set it.
///
/// The field is **write-only**. A stored key is shown as dots plus its last
/// four characters and nothing else, because the core never sends more than
/// that. This is not a UI nicety — the credential store exists so that
/// plaintext keys are not sitting in files or scrolling past on screen, and a
/// settings page that decrypted them to populate a text box would undo that
/// quietly, which is the worst way for a security property to be lost.
///
/// The last four are there because they answer the one question dots cannot:
/// "is this the key I think it is?"
class SecretField extends StatefulWidget {
  const SecretField({
    super.key,
    required this.credential,
    required this.onSave,
    required this.onClear,
    this.busy = false,
  });

  final CredentialStatus credential;
  final void Function(String value) onSave;
  final VoidCallback onClear;
  final bool busy;

  @override
  State<SecretField> createState() => _SecretFieldState();
}

class _SecretFieldState extends State<SecretField> {
  final _controller = TextEditingController();
  bool _editing = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _save() {
    final value = _controller.text.trim();
    if (value.isEmpty) return;
    widget.onSave(value);
    // Cleared immediately. There is no reason for a key to stay in a text
    // field's memory after it has been handed over, and leaving it there means
    // it is one screenshot away from being shared.
    _controller.clear();
    setState(() => _editing = false);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final c = widget.credential;

    return DexPanel(
      padding: const EdgeInsets.all(DexTokens.spaceLg),
      accent: c.present ? t.positive : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.label, style: DexType.body(strong: true, color: t.text)),
                    const SizedBox(height: 2),
                    Text(c.powers, style: DexType.caption(color: t.textMuted)),
                  ],
                ),
              ),
              const SizedBox(width: DexTokens.spaceMd),
              _StatusTag(credential: c),
            ],
          ),
          if (c.note != null) ...[
            const SizedBox(height: DexTokens.spaceSm),
            _Note(text: c.note!),
          ],
          const SizedBox(height: DexTokens.spaceMd),
          Row(
            children: [
              Expanded(
                child: _editing
                    ? DexField(
                        controller: _controller,
                        hint: 'Paste ${c.label} here',
                        mono: true,
                        autofocus: true,
                        onSubmitted: (_) => _save(),
                      )
                    : _StoredValue(credential: c),
              ),
              const SizedBox(width: DexTokens.spaceSm),
              if (_editing) ...[
                DexButton(
                  label: 'Save',
                  variant: DexButtonVariant.primary,
                  dense: true,
                  enabled: !widget.busy,
                  onTap: _save,
                ),
                const SizedBox(width: DexTokens.spaceXs),
                DexButton(
                  label: 'Cancel',
                  dense: true,
                  onTap: () {
                    _controller.clear();
                    setState(() => _editing = false);
                  },
                ),
              ] else ...[
                DexButton(
                  label: c.present ? 'Replace' : 'Add',
                  dense: true,
                  variant: c.present
                      ? DexButtonVariant.secondary
                      : DexButtonVariant.primary,
                  onTap: () => setState(() => _editing = true),
                ),
                if (c.stored) ...[
                  const SizedBox(width: DexTokens.spaceXs),
                  DexButton(
                    label: 'Remove',
                    dense: true,
                    tone: t.negative,
                    enabled: !widget.busy,
                    onTap: widget.onClear,
                  ),
                ],
              ],
            ],
          ),
          const SizedBox(height: DexTokens.spaceSm),
          _Source(credential: c),
        ],
      ),
    );
  }
}

class _StatusTag extends StatelessWidget {
  const _StatusTag({required this.credential});

  final CredentialStatus credential;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    if (credential.stored) {
      return DexTag('Stored', tone: t.positive);
    }
    if (credential.fromEnvironment) {
      // Works, but it is a plaintext value in a file. Named rather than shown
      // as a plain tick, because "it works" is exactly why nobody moves it.
      return Tooltip(
        message: 'Found in .env rather than the encrypted store.\n'
            'It works, but a secret in a file is a secret in a backup.\n'
            'Set it here to move it into the credential store.',
        child: DexTag('In .env', tone: t.warn),
      );
    }
    return DexTag('Not set', tone: t.textFaint, filled: false, outlined: true);
  }
}

class _StoredValue extends StatelessWidget {
  const _StoredValue({required this.credential});

  final CredentialStatus credential;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    if (!credential.present) {
      return Text('Nothing stored', style: DexType.caption(color: t.textFaint));
    }
    return Row(
      children: [
        Text('••••••••••••', style: DexType.code(color: t.textMuted)),
        if (credential.hint != null) ...[
          const SizedBox(width: DexTokens.spaceSm),
          Text(credential.hint!, style: DexType.code(color: t.text)),
        ],
      ],
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DexTokens.spaceMd,
        vertical: DexTokens.spaceSm,
      ),
      decoration: BoxDecoration(
        color: t.warn.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, size: 14, color: t.warn),
          const SizedBox(width: DexTokens.spaceSm),
          Expanded(child: Text(text, style: DexType.caption(color: t.warn))),
        ],
      ),
    );
  }
}

/// Where to get one.
///
/// The URL is shown rather than made clickable. Dex can open a browser, but
/// launching one from a settings row is a surprising amount of agency for a
/// label, and a visible address is something you can check before you trust it.
class _Source extends StatelessWidget {
  const _Source({required this.credential});

  final CredentialStatus credential;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.north_east_rounded, size: 12, color: t.textFaint),
        const SizedBox(width: DexTokens.spaceSm),
        Expanded(
          child: Text(
            credential.url != null
                ? '${credential.source}  —  ${credential.url}'
                : credential.source,
            style: DexType.caption(color: t.textFaint),
          ),
        ),
      ],
    );
  }
}

/// A row that reports what one real call to a provider did.
class ProviderTestRow extends StatelessWidget {
  const ProviderTestRow({
    super.key,
    required this.result,
    required this.testing,
  });

  final ProviderTestResult? result;
  final bool testing;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    if (testing) {
      return Row(
        children: [
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(strokeWidth: 2, color: t.accent),
          ),
          const SizedBox(width: DexTokens.spaceSm),
          Text('Asking it something…', style: DexType.caption(color: t.textMuted)),
        ],
      );
    }

    if (result == null) return const SizedBox.shrink();

    final r = result!;
    return DexEntrance(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            r.ok ? Icons.check_circle_outline_rounded : Icons.error_outline_rounded,
            size: 14,
            color: r.ok ? t.positive : t.negative,
          ),
          const SizedBox(width: DexTokens.spaceSm),
          Expanded(
            child: Text(
              r.ok
                  ? '${r.provider} answered in ${r.latencyMs}ms.'
                  : r.error ?? 'It did not answer.',
              style: DexType.caption(color: r.ok ? t.positive : t.negative),
            ),
          ),
        ],
      ),
    );
  }
}
