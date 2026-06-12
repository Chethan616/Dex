// First-run onboarding — everything `dex onboard` does, in the app.
//
// Four steps on the living background, one glossy card, no terminal:
//   1. Welcome      what Dex is + what it will be allowed to do
//   2. Brain        Gemini API key (get-key link) + model dropdown
//   3. Apps         WhatsApp pairing (in-app QR) — skippable
//   4. Done         summary → enter the cockpit
//
// Writes fan out through DexSetup: brain auth profile, web_search
// provider key, browser-control env, UFO² agents.yaml — one key, every
// consumer. Routed from main.dart when DexSetupState.needsOnboarding.

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/dex_setup.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/glossy_dropdown.dart';
import '../widgets/living_background.dart';
import '../widgets/refractive_edge.dart';
import '../widgets/secret_field.dart';
import '../widgets/settings/whatsapp_pair_dialog.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.onFinished});
  final VoidCallback onFinished;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _pages = PageController();
  int _step = 0;

  final TextEditingController _keyCtrl = TextEditingController();
  String _brainModel = kBrainModels.first;
  bool _applying = false;
  String? _applyError;
  bool _whatsappLinked = false;
  late DexSetupState _state;

  @override
  void initState() {
    super.initState();
    _state = DexSetup.read();
    _brainModel = _state.brainModel ?? kBrainModels.first;
  }

  @override
  void dispose() {
    _pages.dispose();
    _keyCtrl.dispose();
    super.dispose();
  }

  void _go(int step) {
    setState(() => _step = step);
    _pages.animateToPage(
      step,
      duration: DexMotion.respecting(context, DexMotion.dialog),
      curve: DexMotion.dampened,
    );
  }

  Future<void> _applyBrain() async {
    final key = _keyCtrl.text.trim();
    if (key.isEmpty && !_state.hasBrainKey) {
      setState(() => _applyError = 'Paste your Gemini API key to continue.');
      return;
    }
    setState(() {
      _applying = true;
      _applyError = null;
    });
    try {
      if (key.isNotEmpty) await DexSetup.applyGeminiKey(key);
      await DexSetup.applyBrainModel(
        _brainModel,
        fallbacks: kBrainModels
            .where((m) => m != _brainModel && m != 'google/gemini-flash-latest')
            .toList(growable: false),
      );
      _state = DexSetup.read();
      _go(2);
    } catch (e) {
      setState(() => _applyError = '$e');
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: LivingBackground(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560, maxHeight: 620),
            child: DecoratedBox(
              decoration: const BoxDecoration(
                borderRadius: DexRadius.rlg,
                boxShadow: DexSurface.glossyShadow,
              ),
              child: RefractiveEdge(
                radius: DexRadius.rlg,
                child: BackdropFilter(
                  filter: ImageFilter.blur(
                    sigmaX: DexSurface.blurSigma,
                    sigmaY: DexSurface.blurSigma,
                  ),
                  child: Container(
                    decoration:
                        BoxDecoration(gradient: DexSurface.glossyGradient()),
                    padding: const EdgeInsets.all(DexSpace.xl),
                    child: Column(
                      children: [
                        Expanded(
                          child: PageView(
                            controller: _pages,
                            physics: const NeverScrollableScrollPhysics(),
                            children: [
                              _welcome(),
                              _brain(),
                              _apps(),
                              _done(),
                            ],
                          ),
                        ),
                        const SizedBox(height: DexSpace.md),
                        _StepDots(current: _step, count: 4),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---- step 1: welcome --------------------------------------------------

  Widget _welcome() {
    return _StepShell(
      icon: LucideIcons.sparkles,
      title: 'Welcome to Dex',
      subtitle: 'A calm cockpit for commanding agents you can trust.',
      children: [
        const _FeatureRow(
          icon: LucideIcons.app_window,
          text: 'Drives your real apps — Notepad, Excel, Settings — by their UI.',
        ),
        const _FeatureRow(
          icon: LucideIcons.globe,
          text: 'Browses with YOUR browser — Vivaldi, Brave, Edge, Chrome.',
        ),
        const _FeatureRow(
          icon: LucideIcons.message_circle,
          text: 'Sends messages and files through your paired WhatsApp.',
        ),
        const _FeatureRow(
          icon: LucideIcons.shield_check,
          text: 'Everything runs locally. Keys never leave this machine.',
        ),
        const Spacer(),
        _PrimaryButton(label: 'Get started', onTap: () => _go(1)),
      ],
    );
  }

  // ---- step 2: brain ----------------------------------------------------

  Widget _brain() {
    return _StepShell(
      icon: LucideIcons.key_round,
      title: 'Connect the brain',
      subtitle: _state.hasBrainKey
          ? 'A Gemini key ending in …${_state.geminiKeyTail} is already set. '
              'Paste a new one to replace it, or continue.'
          : 'Dex thinks with Google Gemini. One free key powers everything — '
              'chat, desktop automation, and browsing.',
      children: [
        SecretField(
          controller: _keyCtrl,
          hint: 'AIza…  /  AQ.…',
        ),
        const SizedBox(height: DexSpace.xs),
        _LinkRow(
          label: "Don't have one? Get a free Gemini key",
          url: 'https://aistudio.google.com/app/apikey',
        ),
        const SizedBox(height: DexSpace.lg),
        Row(
          children: [
            Text('Model', style: DexType.label(color: DexColors.textDim)),
            const Spacer(),
            GlossyDropdown(
              value: _brainModel,
              options: kBrainModels,
              onChanged: (m) => setState(() => _brainModel = m),
              width: 280,
            ),
          ],
        ),
        if (_applyError != null) ...[
          const SizedBox(height: DexSpace.sm),
          Text(_applyError!,
              style: DexType.caption(color: DexColors.stateError)),
        ],
        const Spacer(),
        Row(
          children: [
            _GhostButton(label: 'Back', onTap: () => _go(0)),
            const Spacer(),
            _PrimaryButton(
              label: _applying ? 'Applying…' : 'Continue',
              onTap: _applying ? null : _applyBrain,
            ),
          ],
        ),
      ],
    );
  }

  // ---- step 3: apps -----------------------------------------------------

  Widget _apps() {
    return _StepShell(
      icon: LucideIcons.message_circle,
      title: 'Connect your apps',
      subtitle:
          'Pair WhatsApp now and Dex can send you files and messages with a '
          'single tool call. More apps live in Settings → Connectors & Apps.',
      children: [
        _ConnectRow(
          icon: LucideIcons.message_circle,
          name: 'WhatsApp',
          status: _whatsappLinked ? 'Linked' : 'Scan a QR with your phone',
          linked: _whatsappLinked,
          onTap: () async {
            final ok = await WhatsAppPairDialog.show(context);
            if (ok && mounted) setState(() => _whatsappLinked = true);
          },
        ),
        const SizedBox(height: DexSpace.sm),
        Text(
          'Telegram, Discord, Slack and 60+ skills can be connected any time '
          'from Settings.',
          style: DexType.caption(color: DexColors.textFaint),
        ),
        const Spacer(),
        Row(
          children: [
            _GhostButton(label: 'Back', onTap: () => _go(1)),
            const Spacer(),
            _GhostButton(label: 'Skip for now', onTap: () => _go(3)),
            const SizedBox(width: DexSpace.sm),
            _PrimaryButton(label: 'Continue', onTap: () => _go(3)),
          ],
        ),
      ],
    );
  }

  // ---- step 4: done -----------------------------------------------------

  Widget _done() {
    return _StepShell(
      icon: LucideIcons.rocket,
      title: "You're set",
      subtitle: 'Dex previews actions before running them, streams every '
          'step live, and you can stop it at any time.',
      children: [
        _FeatureRow(
          icon: LucideIcons.circle_check,
          text: 'Brain: $_brainModel',
        ),
        _FeatureRow(
          icon: _whatsappLinked
              ? LucideIcons.circle_check
              : LucideIcons.circle_dashed,
          text: _whatsappLinked
              ? 'WhatsApp linked'
              : 'WhatsApp not linked (Settings → Connectors & Apps)',
        ),
        const Spacer(),
        _PrimaryButton(label: 'Open Dex', onTap: widget.onFinished),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

class _StepShell extends StatelessWidget {
  const _StepShell({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: DexSpace.sm),
        Icon(icon, size: 30, color: DexColors.accent),
        const SizedBox(height: DexSpace.md),
        Text(title,
            textAlign: TextAlign.center,
            style: DexType.heading(color: DexColors.text)),
        const SizedBox(height: DexSpace.xs),
        Text(subtitle,
            textAlign: TextAlign.center,
            style: DexType.body(color: DexColors.textDim)),
        const SizedBox(height: DexSpace.lg),
        ...children,
      ],
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.xs),
      child: Row(
        children: [
          Icon(icon, size: 16, color: DexColors.textDim),
          const SizedBox(width: DexSpace.md),
          Expanded(
            child: Text(text, style: DexType.body(color: DexColors.textDim)),
          ),
        ],
      ),
    );
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow({required this.label, required this.url});
  final String label;
  final String url;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: () => launchUrl(Uri.parse(url)),
        child: Text(
          '$label →',
          style: DexType.caption(color: DexColors.accent).copyWith(
            decoration: TextDecoration.underline,
            decorationColor: DexColors.accent.withValues(alpha: 0.4),
          ),
        ),
      ),
    );
  }
}

class _ConnectRow extends StatelessWidget {
  const _ConnectRow({
    required this.icon,
    required this.name,
    required this.status,
    required this.linked,
    required this.onTap,
  });
  final IconData icon;
  final String name;
  final String status;
  final bool linked;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DexSpace.md),
      decoration: BoxDecoration(
        color: DexColors.surface,
        borderRadius: DexRadius.rmd,
        border: Border.all(color: DexColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18,
              color: linked ? DexColors.stateApprove : DexColors.textDim),
          const SizedBox(width: DexSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: DexType.label(color: DexColors.text)),
                Text(status,
                    style: DexType.caption(color: DexColors.textFaint)),
              ],
            ),
          ),
          if (linked)
            const Icon(LucideIcons.circle_check,
                size: 18, color: DexColors.stateApprove)
          else
            OutlinedButton(
              onPressed: onTap,
              style: OutlinedButton.styleFrom(
                foregroundColor: DexColors.text,
                side: const BorderSide(color: DexColors.border),
              ),
              child: const Text('Pair'),
            ),
        ],
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({required this.label, required this.onTap});
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: onTap,
      style: ElevatedButton.styleFrom(
        backgroundColor: DexColors.accent,
        foregroundColor: DexColors.bg,
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.xl, vertical: DexSpace.md,
        ),
      ),
      child: Text(label),
    );
  }
}

class _GhostButton extends StatelessWidget {
  const _GhostButton({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(foregroundColor: DexColors.textDim),
      child: Text(label),
    );
  }
}

class _StepDots extends StatelessWidget {
  const _StepDots({required this.current, required this.count});
  final int current;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < count; i++)
          AnimatedContainer(
            duration: DexMotion.respecting(context, DexMotion.medium),
            curve: DexMotion.easeOut,
            margin: const EdgeInsets.symmetric(horizontal: 3),
            width: i == current ? 18 : 6,
            height: 6,
            decoration: BoxDecoration(
              color: i == current
                  ? DexColors.accent
                  : DexColors.border,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
      ],
    );
  }
}
