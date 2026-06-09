// Shared row primitives used across the settings tabs: section title, a
// label+control row, and an info paragraph below a row.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';

class SettingsSection extends StatelessWidget {
  const SettingsSection({super.key, required this.title, this.child});
  final String title;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DexSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: DexType.heading(color: DexColors.text)),
          const SizedBox(height: DexSpace.sm),
          const Divider(height: 1, color: DexColors.border),
          const SizedBox(height: DexSpace.sm),
          if (child != null) child!,
        ],
      ),
    );
  }
}

class SettingsRow extends StatelessWidget {
  const SettingsRow({
    super.key,
    required this.label,
    required this.control,
    this.description,
  });
  final String label;
  final Widget control;
  final String? description;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label,
                    style: DexType.label(color: DexColors.text)),
              ),
              control,
            ],
          ),
          if (description != null) ...[
            const SizedBox(height: 2),
            Text(description!,
                style: DexType.caption(color: DexColors.textFaint)),
          ],
        ],
      ),
    );
  }
}

class SettingsLinkRow extends StatelessWidget {
  const SettingsLinkRow({
    super.key,
    required this.label,
    this.description,
    this.onTap,
    this.trailingIcon = LucideIcons.chevron_right,
  });
  final String label;
  final String? description;
  final VoidCallback? onTap;
  final IconData trailingIcon;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: DexRadius.rsm,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.xs, vertical: DexSpace.sm,
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: DexType.label(color: DexColors.text)),
                  if (description != null) ...[
                    const SizedBox(height: 2),
                    Text(description!,
                        style: DexType.caption(color: DexColors.textFaint)),
                  ],
                ],
              ),
            ),
            Icon(trailingIcon, size: 16, color: DexColors.textDim),
          ],
        ),
      ),
    );
  }
}
