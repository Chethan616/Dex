// Add / import memory sub-screen. Three-step import flow + facts textarea +
// links + drop-zone upload.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../../core/dex_memory.dart';
import '../../../theme/tokens.dart';

class MemoryAdd extends StatefulWidget {
  const MemoryAdd({super.key, required this.onBack});
  final VoidCallback onBack;
  @override
  State<MemoryAdd> createState() => _MemoryAddState();
}

class _MemoryAddState extends State<MemoryAdd> {
  static const _importPrompt =
      'List everything you know about me from:\n\n1) your saved memory entries,\n2) anything inferred from our full chat history.';

  final _pasteCtrl = TextEditingController();
  final _factsCtrl = TextEditingController();
  final _linksCtrl = TextEditingController();
  String? _saved;

  @override
  void dispose() {
    _pasteCtrl.dispose();
    _factsCtrl.dispose();
    _linksCtrl.dispose();
    super.dispose();
  }

  // Ingest the imported response + typed facts + links into MEMORY.md.
  // Each non-empty line becomes its own bullet; a link gets a short prefix
  // so the agent knows it's a reference it can fetch.
  void _save() {
    var added = 0;
    void add(String? raw, {String? prefix}) {
      final text = raw?.trim();
      if (text == null || text.isEmpty) return;
      for (final line in text.split('\n')) {
        final l = line.trim();
        if (l.isEmpty) continue;
        DexMemory.addFact(prefix != null ? '$prefix$l' : l);
        added++;
      }
    }

    add(_pasteCtrl.text);
    add(_factsCtrl.text);
    add(_linksCtrl.text, prefix: 'Reference link: ');
    if (added == 0) {
      setState(() => _saved = 'Nothing to save — add some facts or a link first.');
      return;
    }
    _pasteCtrl.clear();
    _factsCtrl.clear();
    _linksCtrl.clear();
    setState(() =>
        _saved = 'Saved $added ${added == 1 ? 'item' : 'items'} to memory.');
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
              Text('Add or import memory',
                  style: DexType.heading(color: DexColors.text)),
            ],
          ),
          const SizedBox(height: DexSpace.lg),
          Text('Import memory',
              style: DexType.label(color: DexColors.text)),
          const SizedBox(height: DexSpace.md),
          _Step(
            number: 1,
            label: 'Copy this prompt',
            child: _PromptBox(text: _importPrompt),
          ),
          _Step(
            number: 2,
            label: 'Paste into the AI product you want to import memory from',
          ),
          _Step(
            number: 3,
            label: 'Copy and paste the results here',
            child: TextField(
              controller: _pasteCtrl,
              maxLines: 5,
              style: DexType.body(color: DexColors.text),
              decoration: const InputDecoration(
                hintText: 'Paste the response here',
              ),
            ),
          ),
          const SizedBox(height: DexSpace.lg),
          Text('Add facts about you',
              style: DexType.label(color: DexColors.text)),
          const SizedBox(height: DexSpace.sm),
          TextField(
            controller: _factsCtrl,
            maxLines: 3,
            style: DexType.body(color: DexColors.text),
            decoration: const InputDecoration(
              hintText:
                  'Example: I prefer bullet points over paragraphs.',
            ),
          ),
          const SizedBox(height: DexSpace.lg),
          Text('Add links', style: DexType.label(color: DexColors.text)),
          const SizedBox(height: DexSpace.sm),
          TextField(
            controller: _linksCtrl,
            style: DexType.body(color: DexColors.text),
            decoration: const InputDecoration(
              hintText: 'Add a LinkedIn profile or any other website',
            ),
          ),
          const SizedBox(height: DexSpace.sm),
          TextButton.icon(
            onPressed: () {},
            icon: const Icon(LucideIcons.plus, size: 14),
            label: const Text('Add another link'),
          ),
          const SizedBox(height: DexSpace.lg),
          Text('Upload files', style: DexType.label(color: DexColors.text)),
          const SizedBox(height: DexSpace.sm),
          DottedDropZone(onTap: () {}),
          const SizedBox(height: DexSpace.lg),
          Row(
            children: [
              if (_saved != null)
                Expanded(
                  child: Text(_saved!,
                      style: DexType.caption(color: DexColors.textDim)),
                )
              else
                const Spacer(),
              ElevatedButton(
                onPressed: _save,
                child: const Text('Save to memory'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.number, required this.label, this.child});
  final int number;
  final String label;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DexSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 22,
            height: 22,
            margin: const EdgeInsets.only(top: 2),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: DexColors.surface2,
              shape: BoxShape.circle,
              border: Border.all(color: DexColors.border),
            ),
            child: Text('$number',
                style: DexType.caption(color: DexColors.text)),
          ),
          const SizedBox(width: DexSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: DexType.label(color: DexColors.text)),
                if (child != null) ...[
                  const SizedBox(height: DexSpace.sm),
                  child!,
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PromptBox extends StatelessWidget {
  const _PromptBox({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DexSpace.md),
      decoration: BoxDecoration(
        color: DexColors.surface,
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(text, style: DexType.body(color: DexColors.text)),
          ),
          const SizedBox(width: DexSpace.sm),
          OutlinedButton.icon(
            onPressed: () => Clipboard.setData(ClipboardData(text: text)),
            icon: const Icon(LucideIcons.copy, size: 14),
            label: const Text('Copy'),
            style: OutlinedButton.styleFrom(
              foregroundColor: DexColors.text,
              side: const BorderSide(color: DexColors.border),
              padding: const EdgeInsets.symmetric(
                horizontal: DexSpace.md, vertical: DexSpace.xs,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class DottedDropZone extends StatelessWidget {
  const DottedDropZone({super.key, required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: DexRadius.rmd,
      child: Container(
        height: 110,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: DexColors.surface,
          borderRadius: DexRadius.rmd,
          border: Border.all(
            color: DexColors.border,
            style: BorderStyle.solid,
            width: 1,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(LucideIcons.file_up,
                size: 18, color: DexColors.textDim),
            const SizedBox(height: DexSpace.sm),
            Text('Upload or drop documents here',
                style: DexType.caption(color: DexColors.textFaint)),
          ],
        ),
      ),
    );
  }
}
