// ModelPicker — the /model command's dialog. Lists every provider and
// its models with a key-status dot. Picking a model:
//   - key present  -> sets the brain model immediately
//   - key missing   -> asks for the provider's API key (with a get-key
//                       link), saves it, then sets the model
// All writes go through DexSetup, so this matches what onboarding +
// Settings → Account do.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/dex_setup.dart';
import '../core/models_catalog.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'refractive_edge.dart';
import 'secret_field.dart';

class ModelPicker extends StatefulWidget {
  const ModelPicker({super.key});

  static Future<void> show(BuildContext context) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Dismiss model picker',
      barrierColor: Colors.black.withValues(alpha: 0.4),
      transitionDuration: DexMotion.dialog,
      pageBuilder: (_, _, _) => const ModelPicker(),
      transitionBuilder: (ctx, anim, _, child) {
        if (MediaQuery.of(ctx).disableAnimations) return child;
        final eased = CurvedAnimation(parent: anim, curve: DexMotion.dampened);
        return FadeTransition(
          opacity: eased,
          child: Transform.scale(scale: 0.97 + 0.03 * eased.value, child: child),
        );
      },
    );
  }

  @override
  State<ModelPicker> createState() => _ModelPickerState();
}

class _ModelPickerState extends State<ModelPicker> {
  late String _current;
  String? _note;

  @override
  void initState() {
    super.initState();
    _current = DexSetup.read().brainModel ?? '';
  }

  Future<void> _pick(ProviderModels provider, ModelOption model) async {
    // Local providers + already-keyed providers switch immediately.
    if (!provider.needsKey || DexSetup.providerConfigured(provider.id)) {
      await _setModel(model);
      return;
    }
    final key = await _askKey(provider);
    if (key == null || key.trim().isEmpty) return;
    try {
      await DexSetup.applyProviderKey(provider.id, key.trim());
    } catch (e) {
      setState(() => _note = 'Key save failed: $e');
      return;
    }
    await _setModel(model);
  }

  Future<void> _setModel(ModelOption model) async {
    try {
      await DexSetup.applyBrainModel(model.id);
      setState(() {
        _current = model.id;
        _note = '${model.label} set. Restart the gateway to apply.';
      });
    } catch (e) {
      setState(() => _note = 'Could not set model: $e');
    }
  }

  Future<String?> _askKey(ProviderModels provider) {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DexColors.surface2,
        title: Text('${provider.name} API key',
            style: DexType.label(color: DexColors.text)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SecretField(controller: ctrl, hint: 'Paste your ${provider.name} key'),
            const SizedBox(height: DexSpace.xs),
            MouseRegion(
              cursor: SystemMouseCursors.click,
              child: GestureDetector(
                onTap: () => launchUrl(Uri.parse(provider.getKeyUrl),
                    mode: LaunchMode.externalApplication),
                child: Text('Get a ${provider.name} key →',
                    style: DexType.caption(color: DexColors.accent)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(ctrl.text),
            child: const Text('Save & select'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 640),
          child: DecoratedBox(
            decoration: const BoxDecoration(
              borderRadius: DexRadius.rlg,
              boxShadow: DexSurface.glossyShadow,
            ),
            child: RefractiveEdge(
              radius: DexRadius.rlg,
              child: Container(
                decoration: BoxDecoration(
                  gradient: DexSurface.glossyGradient(),
                  borderRadius: DexRadius.rlg,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                          DexSpace.lg, DexSpace.md, DexSpace.sm, DexSpace.sm),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text('Choose a model',
                                style: DexType.heading(color: DexColors.text)),
                          ),
                          IconButton(
                            icon: const Icon(LucideIcons.x, size: 18),
                            color: DexColors.textDim,
                            onPressed: () => Navigator.of(context).maybePop(),
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1, color: DexColors.border),
                    Flexible(
                      child: ListView(
                        padding: const EdgeInsets.all(DexSpace.md),
                        children: [
                          for (final provider in kModelCatalog)
                            _ProviderBlock(
                              provider: provider,
                              current: _current,
                              configured: !provider.needsKey ||
                                  DexSetup.providerConfigured(provider.id),
                              onPick: (m) => _pick(provider, m),
                            ),
                        ],
                      ),
                    ),
                    if (_note != null)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(
                            DexSpace.lg, 0, DexSpace.lg, DexSpace.md),
                        child: Text(_note!,
                            style: DexType.caption(color: DexColors.textDim)),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ProviderBlock extends StatelessWidget {
  const _ProviderBlock({
    required this.provider,
    required this.current,
    required this.configured,
    required this.onPick,
  });
  final ProviderModels provider;
  final String current;
  final bool configured;
  final ValueChanged<ModelOption> onPick;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: DexSpace.md, bottom: DexSpace.xs),
          child: Row(
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: configured
                      ? DexColors.stateApprove
                      : DexColors.textFaint,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: DexSpace.sm),
              Text(provider.name, style: DexType.label(color: DexColors.text)),
              const SizedBox(width: DexSpace.sm),
              Text(
                configured ? 'connected' : (provider.needsKey ? 'needs key' : 'local'),
                style: DexType.caption(color: DexColors.textFaint),
              ),
            ],
          ),
        ),
        for (final m in provider.models)
          _ModelRow(
            model: m,
            selected: m.id == current,
            onTap: () => onPick(m),
          ),
      ],
    );
  }
}

class _ModelRow extends StatelessWidget {
  const _ModelRow({
    required this.model,
    required this.selected,
    required this.onTap,
  });
  final ModelOption model;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: InkWell(
        onTap: onTap,
        borderRadius: DexRadius.rsm,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 1),
          padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.md, vertical: DexSpace.sm),
          decoration: BoxDecoration(
            color: selected ? DexColors.surface2 : Colors.transparent,
            borderRadius: DexRadius.rsm,
            border: Border.all(
                color: selected ? DexColors.accent : Colors.transparent),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(model.label,
                    style: DexType.body(color: DexColors.text)),
              ),
              if (selected)
                const Icon(LucideIcons.check, size: 14, color: DexColors.accent),
            ],
          ),
        ),
      ),
    );
  }
}
