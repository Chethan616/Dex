// Detail view for a single connector entry: About + How to connect +
// Details, with the live status chip carried over from the list.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../../core/connectors.dart';
import '../../../theme/tokens.dart';
import '../connector_guide_sheet.dart';
import '../../dex_toast.dart';
import '../../glass_back_button.dart';
import '../whatsapp_pair_dialog.dart';
import 'connectors_tab.dart';

class ConnectorDetail extends StatelessWidget {
  const ConnectorDetail({
    super.key,
    required this.entry,
    required this.status,
    required this.onBack,
  });
  final ConnectorEntry entry;
  final ConnectorStatus status;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final hint = entry.connectHint;
    // WhatsApp pairs fully in-app (gateway web.login QR flow); other
    // connectors fall back to the copyable CLI command for now.
    final canPairInApp = entry.id == 'whatsapp';
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              GlassBackButton(onTap: onBack),
            ],
          ),
          const SizedBox(height: DexSpace.sm),
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: DexColors.surface,
                  borderRadius: DexRadius.rsm,
                  border: Border.all(color: DexColors.border),
                ),
                child: Icon(entry.icon, size: 18, color: DexColors.textDim),
              ),
              const SizedBox(width: DexSpace.md),
              Expanded(
                child: Text(entry.name,
                    style: DexType.heading(color: DexColors.text)),
              ),
              if (canPairInApp && status != ConnectorStatus.connected) ...[
                ElevatedButton(
                  onPressed: () => WhatsAppPairDialog.show(context),
                  child: const Text('Pair now'),
                ),
                const SizedBox(width: DexSpace.sm),
              ],
              ConnectorStatusChip(status: status),
            ],
          ),
          const SizedBox(height: DexSpace.xl),
          Text('About', style: DexType.label(color: DexColors.text)),
          const SizedBox(height: DexSpace.xs),
          Text(entry.description,
              style: DexType.body(color: DexColors.textDim)),
          if (status != ConnectorStatus.connected &&
              ConnectorGuideSheet.hasGuide(entry.id)) ...[
            const SizedBox(height: DexSpace.xl),
            Text('How to connect',
                style: DexType.label(color: DexColors.text)),
            const SizedBox(height: DexSpace.xs),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: () => ConnectorGuideSheet.show(context,
                    connectorId: entry.id, title: entry.name),
                icon: const Icon(LucideIcons.book_open, size: 14),
                label: const Text('Step-by-step guide'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: DexColors.text,
                  side: const BorderSide(color: DexColors.border),
                ),
              ),
            ),
            if (hint != null) ...[
              const SizedBox(height: DexSpace.sm),
              _HintBox(hint: hint),
            ],
          ] else if (hint != null && status != ConnectorStatus.connected) ...[
            const SizedBox(height: DexSpace.xl),
            Text('How to connect',
                style: DexType.label(color: DexColors.text)),
            const SizedBox(height: DexSpace.xs),
            _HintBox(hint: hint),
          ],
          const SizedBox(height: DexSpace.xl),
          Text('Details', style: DexType.label(color: DexColors.text)),
          const SizedBox(height: DexSpace.sm),
          _DetailRow(label: 'Developer', value: entry.developer),
          _DetailRow(label: 'Category', value: entry.category.label),
          _DetailRow(
            label: 'Status',
            value: switch (status) {
              ConnectorStatus.connected => 'Connected',
              ConnectorStatus.builtin => 'Built into Dex',
              ConnectorStatus.available => 'Not connected',
            },
          ),
        ],
      ),
    );
  }
}

/// Mono command box with a copy affordance — the connect hint is
/// usually a `dex` CLI one-liner.
class _HintBox extends StatelessWidget {
  const _HintBox({required this.hint});
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DexSpace.sm),
      decoration: BoxDecoration(
        color: DexColors.surface,
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(hint, style: DexType.mono(color: DexColors.textDim)),
          ),
          InkWell(
            borderRadius: DexRadius.rsm,
            onTap: () {
              Clipboard.setData(ClipboardData(text: hint));
              dexToast(context, 'Copied');
            },
            child: const Padding(
              padding: EdgeInsets.all(4),
              child: Icon(LucideIcons.copy,
                  size: 14, color: DexColors.textFaint),
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label,
                style: DexType.label(color: DexColors.textDim)),
          ),
          Expanded(
            child: Text(value,
                style: DexType.label(color: DexColors.text),
                textAlign: TextAlign.right),
          ),
        ],
      ),
    );
  }
}
