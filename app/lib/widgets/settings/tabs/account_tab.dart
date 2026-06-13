// Account tab. Secrets (API keys + model selection wired to every
// consumer via DexSetup) + device presence.

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/account.dart';
import '../../../core/dex_setup.dart';
import '../../../core/onboarding_request.dart';
import '../../../core/models/device.dart';
import '../../../theme/tokens.dart';
import '../../device_chip.dart';
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

  bool _phoneLinked = false;

  late DexSetupState _setup;
  final TextEditingController _keyCtrl = TextEditingController();
  bool _applying = false;
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
          description: 'Reasoning, planning, chat.',
          control: GlossyDropdown(
            value: brainModel,
            options: kBrainModels,
            onChanged: _setBrainModel,
            width: 260,
          ),
        ),
        SettingsRow(
          label: 'Hands model',
          description: 'UFO² desktop automation (agents.yaml).',
          control: GlossyDropdown(
            value: handsModel,
            options: kHandsModels,
            onChanged: _setHandsModel,
            width: 260,
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
            SettingsRow(
              label: 'Phone connection',
              control: Switch(
                value: _phoneLinked,
                onChanged: (v) => setState(() => _phoneLinked = v),
              ),
              description:
                  'Send or retrieve text messages, access contacts, and more by linking your phone.',
            ),
            const Divider(),
            Text('Delete account',
                style: DexType.label(color: DexColors.text)),
            const SizedBox(height: DexSpace.xs),
            Text(
              'If you delete and later re-activate, your local data may not be restored.',
              style: DexType.caption(color: DexColors.textFaint),
            ),
            const SizedBox(height: DexSpace.md),
            ElevatedButton(
              onPressed: () {},
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
            SettingsLinkRow(label: 'Parental controls', onTap: () {}),
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
