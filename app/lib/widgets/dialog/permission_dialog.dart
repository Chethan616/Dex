// Generic Yes/No permission modal, used for the mic prompt before voice
// mode and for any future capability that needs an explicit OK.

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

class PermissionDialog extends StatelessWidget {
  const PermissionDialog({
    super.key,
    required this.title,
    required this.description,
  });

  final String title;
  final String description;

  static Future<bool?> show(
    BuildContext context, {
    required String title,
    required String description,
  }) {
    return showDialog<bool>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.4),
      builder: (_) =>
          PermissionDialog(title: title, description: description),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DexColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: DexRadius.rlg,
        side: const BorderSide(color: DexColors.border),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.all(DexSpace.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title,
                  textAlign: TextAlign.center,
                  style: DexType.heading(color: DexColors.text)),
              const SizedBox(height: DexSpace.sm),
              Text(description,
                  textAlign: TextAlign.center,
                  style: DexType.body(color: DexColors.textDim)),
              const SizedBox(height: DexSpace.xl),
              ElevatedButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Yes'),
              ),
              const SizedBox(height: DexSpace.sm),
              OutlinedButton(
                onPressed: () => Navigator.of(context).pop(false),
                style: OutlinedButton.styleFrom(
                  foregroundColor: DexColors.text,
                  side: const BorderSide(color: DexColors.border),
                  padding: const EdgeInsets.symmetric(vertical: DexSpace.md),
                  shape: const RoundedRectangleBorder(
                    borderRadius: DexRadius.rsm,
                  ),
                ),
                child: const Text('No'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
