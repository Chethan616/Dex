// View memory sub-screen reached from the Memory tab. Lists the facts Dex
// has remembered and lets the user delete or add new ones.

import 'package:flutter/material.dart';

import '../../../theme/tokens.dart';
import '../settings_row.dart';

class MemoryView extends StatefulWidget {
  const MemoryView({super.key, required this.onBack});
  final VoidCallback onBack;
  @override
  State<MemoryView> createState() => _MemoryViewState();
}

class _MemoryViewState extends State<MemoryView> {
  final List<String> _facts = <String>[];

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
                onPressed: widget.onBack,
              ),
              const SizedBox(width: DexSpace.sm),
              Text('View memory',
                  style: DexType.heading(color: DexColors.text)),
            ],
          ),
          const SizedBox(height: DexSpace.lg),
          if (_facts.isEmpty)
            _Empty(onAdd: _add)
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: _facts.map((f) => _Fact(text: f, onDelete: () {
                    setState(() => _facts.remove(f));
                  })).toList(growable: false),
            ),
          const SizedBox(height: DexSpace.md),
          if (_facts.isNotEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                onPressed: _add,
                style: OutlinedButton.styleFrom(
                  foregroundColor: DexColors.text,
                  side: const BorderSide(color: DexColors.border),
                ),
                child: const Text('Add a fact'),
              ),
            ),
        ],
      ),
    );
  }

  void _add() => setState(() => _facts.add('New fact ${_facts.length + 1}'));
}

class _Empty extends StatelessWidget {
  const _Empty({required this.onAdd});
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DexSpace.xl),
      decoration: BoxDecoration(
        color: DexColors.surface2,
        borderRadius: DexRadius.rmd,
        border: Border.all(color: DexColors.border),
      ),
      child: Column(
        children: [
          Text('Manage what Dex remembers about you',
              style: DexType.label(color: DexColors.text),
              textAlign: TextAlign.center),
          const SizedBox(height: DexSpace.sm),
          Text(
            'Tell Dex to remember details across conversations. You can edit or remove them anytime.',
            textAlign: TextAlign.center,
            style: DexType.caption(color: DexColors.textFaint),
          ),
          const SizedBox(height: DexSpace.lg),
          ElevatedButton(onPressed: onAdd, child: const Text('Add a fact')),
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.text, required this.onDelete});
  final String text;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.xs),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.md, vertical: DexSpace.sm,
        ),
        decoration: BoxDecoration(
          color: DexColors.surface,
          borderRadius: DexRadius.rsm,
          border: Border.all(color: DexColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(text, style: DexType.label(color: DexColors.text)),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded, size: 14),
              color: DexColors.textDim,
              onPressed: onDelete,
            ),
          ],
        ),
      ),
    );
  }
}
