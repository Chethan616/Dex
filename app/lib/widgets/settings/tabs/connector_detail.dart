// Detail view for a single connector entry: About + Details + Connect.

import 'package:flutter/material.dart';

import '../../../theme/tokens.dart';
import 'connectors_tab.dart';

class ConnectorDetail extends StatelessWidget {
  const ConnectorDetail({super.key, required this.entry, required this.onBack});
  final ConnectorEntry entry;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back_rounded, size: 18),
                color: DexColors.textDim,
                onPressed: onBack,
              ),
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
              ElevatedButton(
                onPressed: () {},
                child: const Text('Connect'),
              ),
            ],
          ),
          const SizedBox(height: DexSpace.xl),
          Text('About', style: DexType.label(color: DexColors.text)),
          const SizedBox(height: DexSpace.xs),
          Text(entry.description,
              style: DexType.body(color: DexColors.textDim)),
          const SizedBox(height: DexSpace.xl),
          Text('Details', style: DexType.label(color: DexColors.text)),
          const SizedBox(height: DexSpace.sm),
          _DetailRow(label: 'Developer', value: entry.developer),
          _DetailRow(label: 'Category', value: entry.category),
          _DetailRow(label: 'More info', value: 'docs.dex'),
          _DetailRow(label: 'Privacy policy', value: 'docs.dex/privacy'),
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
        children: [
          Expanded(
            child: Text(label,
                style: DexType.label(color: DexColors.textDim)),
          ),
          Text(value, style: DexType.label(color: DexColors.text)),
        ],
      ),
    );
  }
}
