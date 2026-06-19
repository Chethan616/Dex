// Account tab. Secrets (API keys + model selection wired to every
// consumer via DexSetup) + device presence.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/account.dart';
import '../../../core/dex_setup.dart';
import '../../../core/onboarding_request.dart';
import '../../../core/models/device.dart';
import '../../../theme/tokens.dart';
import '../../device_chip.dart';
import '../../dex_toast.dart';
import '../../glossy_dropdown.dart';
import '../../secret_field.dart';
import '../settings_row.dart';

class AccountTab extends StatefulWidget {
  const AccountTab({super.key});
  @override
  State<AccountTab> createState() => _AccountTabState();
}

class _AccountTabState extends State<AccountTab> {
  static const _device = Device(
    id: 'local',
    name: 'This PC',
    state: DeviceConnection.online,
    capabilities: <String>['desktop', 'files', 'web'],
  );

  late DexSetupState _setup;
  final TextEditingController _keyCtrl = TextEditingController();
  final TextEditingController _groqCtrl = TextEditingController();
  bool _applying = false;
  bool _applyingGroq = false;
  String? _note;
  String _accountName = 'Dex user';
  String? _accountEmail;

  @override
  void initState() {
    super.initState();
    _setup = DexSetup.read();
    DexAccount.load().then((a) {
      if (!mounted) return;
      setState(() {
        _accountName = a.name?.isNotEmpty == true ? a.name! : 'Dex user';
        _accountEmail = a.email;
      });
    });
  }

  @override
  void dispose() {
    _keyCtrl.dispose();
    _groqCtrl.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    setState(() {
      _applying = true;
      _note = null;
    });
    try {
      final key = _keyCtrl.text.trim();
      if (key.isNotEmpty) {
        await DexSetup.applyGeminiKey(key);
        _keyCtrl.clear();
      }
      _setup = DexSetup.read();
      _note = 'Applied. Restart the gateway to pick up key changes.';
    } catch (e) {
      _note = 'Apply failed: $e';
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  Future<void> _applyGroq() async {
    final key = _groqCtrl.text.trim();
    if (key.isEmpty) return;
    setState(() {
      _applyingGroq = true;
      _note = null;
    });
    try {
      await DexSetup.applyGroqKey(key);
      _groqCtrl.clear();
      _setup = DexSetup.read();
      _note = 'Groq key saved. Now pick a Groq model in the Brain/Hands '
          'dropdowns above, then restart the gateway (Diagnostics).';
    } catch (e) {
      _note = 'Groq apply failed: $e';
    } finally {
      if (mounted) setState(() => _applyingGroq = false);
    }
  }

  Future<void> _setBrainModel(String model) async {
    try {
      await DexSetup.applyBrainModel(model);
      setState(() {
        _setup = DexSetup.read();
        _note = 'Brain model set. Takes effect on the next turn.';
      });
    } catch (e) {
      setState(() => _note = 'Model change failed: $e');
    }
  }

  Future<void> _confirmDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DexColors.surface2,
        title: Text('Delete local profile?',
            style: DexType.label(color: DexColors.text)),
        content: Text(
          'This clears your name, email, and sign-in on this machine. Your '
          'API keys, models, and paired apps stay. You can sign in again '
          'after restarting Dex.',
          style: DexType.body(color: DexColors.textDim),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: DexColors.stateError,
              foregroundColor: DexColors.bg,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await DexAccount.deleteLocal();
    if (!mounted) return;
    // Route back to login by re-running onboarding/login gate.
    dexOnboardingRequested.value = false;
    Navigator.of(context).maybePop();
    dexToast(context, 'Local profile deleted. Restart Dex to sign in again.');
  }

  Future<void> _setHandsModel(String model) async {
    try {
      await DexSetup.applyHandsModel(model);
      setState(() {
        _setup = DexSetup.read();
        _note = 'Hands model set. Applies to the next desktop task.';
      });
    } catch (e) {
      setState(() => _note = 'Model change failed: $e');
    }
  }

  Widget _secrets() {
    final brainModel = kBrainModels.contains(_setup.brainModel)
        ? _setup.brainModel!
        : kBrainModels.first;
    final handsModel = kHandsModels.contains(_setup.handsModel)
        ? _setup.handsModel!
        : kHandsModels.first;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Secrets', style: DexType.label(color: DexColors.text)),
        const SizedBox(height: DexSpace.xs),
        Text(
          'One Gemini key powers the brain, web search, browsing, and '
          'desktop automation. Stored locally, never leaves this machine.',
          style: DexType.caption(color: DexColors.textFaint),
        ),
        const SizedBox(height: DexSpace.md),
        SecretField(
          controller: _keyCtrl,
          hint: _setup.hasBrainKey
              ? 'Key set (…${_setup.geminiKeyTail}) — paste to replace'
              : 'Paste your Gemini API key',
        ),
        const SizedBox(height: DexSpace.xs),
        MouseRegion(
          cursor: SystemMouseCursors.click,
          child: GestureDetector(
            onTap: () =>
                launchUrl(Uri.parse('https://aistudio.google.com/app/apikey')),
            child: Text(
              'Get a free Gemini key →',
              style: DexType.caption(color: DexColors.accent),
            ),
          ),
        ),
        const SizedBox(height: DexSpace.md),
        SettingsRow(
          label: 'Brain model',
          description: 'Reasoning, planning, chat. Groq resets per-minute '
              '(no daily wall) — pick Llama 4 Scout if Gemini keeps running out.',
          control: GlossyDropdown(
            value: brainModel,
            options: kBrainModels,
            onChanged: _setBrainModel,
            labelFor: brainModelLabel,
            width: 320,
          ),
        ),
        SettingsRow(
          label: 'Hands model',
          description: 'Drives UFO² desktop automation + browser-use. Pick '
              'any provider — its key is used automatically.',
          control: GlossyDropdown(
            value: handsModel,
            options: kHandsModels,
            onChanged: _setHandsModel,
            labelFor: brainModelLabel,
            width: 320,
          ),
        ),
        const SizedBox(height: DexSpace.sm),
        Row(
          children: [
            _StatusDot(label: 'Brain key', ok: _setup.hasBrainKey),
            _StatusDot(label: 'Web search', ok: _setup.webSearchKeySet),
            _StatusDot(label: 'Browser', ok: _setup.browserEnvKeySet),
            _StatusDot(label: 'Desktop', ok: _setup.handsKeySet),
            const Spacer(),
            ElevatedButton(
              onPressed: _applying ? null : _apply,
              child: Text(_applying ? 'Applying…' : 'Apply'),
            ),
          ],
        ),
        const Divider(),
        Row(
          children: [
            Expanded(
              child: Text('Groq API key (no daily limit)',
                  style: DexType.label(color: DexColors.text)),
            ),
            if (_setup.handsOnGroq)
              _StatusDot(label: 'On Groq', ok: true),
          ],
        ),
        const SizedBox(height: DexSpace.xs),
        Text(
          'Gemini\'s free tier resets DAILY and runs out fast; Groq resets '
          'every MINUTE. Paste a free Groq key here, then pick a Groq model '
          '(e.g. Llama 4 Scout) in the Brain and/or Hands dropdowns above — '
          'the key powers whichever Groq model you select. '
          'Get a key → console.groq.com/keys',
          style: DexType.caption(color: DexColors.textFaint),
        ),
        const SizedBox(height: DexSpace.sm),
        SecretField(
          controller: _groqCtrl,
          hint: _setup.groqKeyTail != null
              ? 'Groq key set (…${_setup.groqKeyTail}) — paste to replace'
              : 'Paste a Groq API key (optional)',
        ),
        const SizedBox(height: DexSpace.xs),
        MouseRegion(
          cursor: SystemMouseCursors.click,
          child: GestureDetector(
            onTap: () => launchUrl(Uri.parse('https://console.groq.com/keys')),
            child: Text(
              'Get a free Groq key →',
              style: DexType.caption(color: DexColors.accent),
            ),
          ),
        ),
        const SizedBox(height: DexSpace.sm),
        Align(
          alignment: Alignment.centerRight,
          child: ElevatedButton(
            onPressed: _applyingGroq ? null : _applyGroq,
            child: Text(_applyingGroq ? 'Applying…' : 'Use Groq for hands'),
          ),
        ),
        if (_note != null) ...[
          const SizedBox(height: DexSpace.sm),
          Text(_note!, style: DexType.caption(color: DexColors.textDim)),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Account',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsRow(
              label: 'Name',
              description: _accountEmail,
              control: Text(_accountName,
                  style: DexType.label(color: DexColors.text)),
            ),
            const Divider(),
            _secrets(),
            const Divider(),
            const SizedBox(height: DexSpace.sm),
            Text('This device',
                style: DexType.caption(color: DexColors.textFaint)),
            const SizedBox(height: DexSpace.sm),
            const DeviceChip(device: _device),
            const Divider(),
            SettingsLinkRow(
              label: 'Connect a phone',
              description:
                  'Pairing from the Dex mobile app arrives in a later release.',
              trailingIcon: LucideIcons.smartphone,
              // No onTap: shown as an honest "coming soon" row, not a
              // toggle that does nothing.
            ),
            const Divider(),
            Text('Delete account',
                style: DexType.label(color: DexColors.text)),
            const SizedBox(height: DexSpace.xs),
            Text(
              'Clears your local Dex profile (name, email, sign-in). Your API '
              'keys, models, and paired apps are NOT affected.',
              style: DexType.caption(color: DexColors.textFaint),
            ),
            const SizedBox(height: DexSpace.md),
            ElevatedButton(
              onPressed: _confirmDelete,
              style: ElevatedButton.styleFrom(
                backgroundColor: DexColors.stateError,
                foregroundColor: DexColors.bg,
              ),
              child: const Text('Delete account'),
            ),
            const Divider(),
            SettingsLinkRow(
              label: 'Run setup again',
              onTap: () {
                // Close Settings, then the app root swaps to the
                // onboarding tour (keys, model, app pairing).
                dexOnboardingRequested.value = true;
                Navigator.of(context).maybePop();
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Tiny per-consumer key-status indicator (green = configured).
class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.label, required this.ok});
  final String label;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    final color = ok ? DexColors.stateApprove : DexColors.textFaint;
    return Padding(
      padding: const EdgeInsets.only(right: DexSpace.md),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(label, style: DexType.caption(color: color)),
        ],
      ),
    );
  }
}
