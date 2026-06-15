// View memory sub-screen reached from the Memory tab. Lists the real facts
// Dex has stored in ~/.dex/workspace/MEMORY.md and lets the user add or
// delete them. Backed by DexMemory, so edits land in the same file the
// agent reads as long-term memory.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../../core/dex_memory.dart';
import '../../../theme/tokens.dart';

class MemoryView extends StatefulWidget {
  const MemoryView({super.key, required this.onBack});
  final VoidCallback onBack;
  @override
  State<MemoryView> createState() => _MemoryViewState();
}

class _MemoryViewState extends State<MemoryView> {
  late List<MemoryFact> _facts;

  @override
  void initState() {
    super.initState();
    _facts = DexMemory.read();
  }

  void _reload() => setState(() => _facts = DexMemory.read());

  Future<void> _add() async {
    final text = await _promptForFact(context);
    if (text == null || text.trim().isEmpty) return;
    DexMemory.addFact(text.trim());
    _reload();
  }

  void _delete(MemoryFact f) {
    DexMemory.deleteFact(f);
    _reload();
  }

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
                icon: const Icon(LucideIcons.arrow_left, size: 18),
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
              children: _facts
                  .map((f) => _Fact(text: f.text, onDelete: () => _delete(f)))
                  .toList(growable: false),
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
}

/// Small modal that collects one fact's text.
Future<String?> _promptForFact(BuildContext context) {
  final ctrl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: DexColors.surface2,
      title: Text('Remember a fact',
          style: DexType.label(color: DexColors.text)),
      content: TextField(
        controller: ctrl,
        autofocus: true,
        maxLines: 3,
        minLines: 1,
        style: DexType.body(color: DexColors.text),
        decoration: const InputDecoration(
          hintText: 'Example: I prefer concise, bulleted answers.',
        ),
        onSubmitted: (v) => Navigator.of(ctx).pop(v),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: () => Navigator.of(ctx).pop(ctrl.text),
          child: const Text('Save'),
        ),
      ],
    ),
  );
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
              icon: const Icon(LucideIcons.trash_2, size: 14),
              color: DexColors.textDim,
              tooltip: 'Forget this',
              onPressed: onDelete,
            ),
          ],
        ),
      ),
    );
  }
}
