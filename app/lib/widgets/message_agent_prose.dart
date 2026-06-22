// Agent prose -- sans, full width, no bubble. Includes an optional
// trailing action row (like / share / regenerate / etc.) when the
// message is no longer streaming.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../core/models/message.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'chat/message_actions_row.dart';

class _ThinkingDots extends StatefulWidget {
  const _ThinkingDots();
  @override
  State<_ThinkingDots> createState() => _ThinkingDotsState();
}

class _ThinkingDotsState extends State<_ThinkingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: DexMotion.breathing)
      ..repeat(reverse: true);
  }
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) {
        final t = reduce ? 1.0 : 0.45 + 0.55 * _c.value;
        return Row(
          children: [
            Opacity(
              opacity: t,
              child: Text('thinking', style: DexType.body(color: DexColors.textDim)),
            ),
            const SizedBox(width: 4),
            Opacity(
              opacity: t,
              child: Text('...', style: DexType.mono(color: DexColors.textDim)),
            ),
          ],
        );
      },
    );
  }
}

class MessageAgentProse extends StatelessWidget {
  const MessageAgentProse({
    super.key,
    required this.message,
    this.showActions = true,
    this.onRegenerate,
    this.onEditInPage,
  });

  final Message message;
  final bool showActions;
  final VoidCallback? onRegenerate;
  final VoidCallback? onEditInPage;

  @override
  Widget build(BuildContext context) {
    final text = message.text ?? '';
    final streaming = message.streaming;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (text.isEmpty && streaming)
            const _ThinkingDots()
          else
            AnimatedSwitcher(
              duration: DexMotion.respecting(context, DexMotion.fast),
              child: _MarkdownRenderer(
                key: ValueKey<int>(text.length),
                text: text,
              ),
            ),
          if (showActions && !streaming && text.isNotEmpty)
            MessageActionsRow(
              onLike: () {},
              onDislike: () {},
              onShare: () {},
              onCopy: () => Clipboard.setData(ClipboardData(text: text)),
              onReadAloud: () {},
              onRegenerate: onRegenerate,
              onEditInPage: onEditInPage,
            ),
        ],
      ),
    );
  }
}

class MarkdownSegment {
  final String text;
  final bool isCodeBlock;
  final String language;

  MarkdownSegment({
    required this.text,
    required this.isCodeBlock,
    this.language = '',
  });
}

List<MarkdownSegment> parseMarkdown(String text) {
  final List<MarkdownSegment> segments = [];
  var index = 0;
  
  while (index < text.length) {
    final nextCodeBlockStart = text.indexOf('```', index);
    if (nextCodeBlockStart == -1) {
      final prose = text.substring(index);
      if (prose.isNotEmpty) {
        segments.add(MarkdownSegment(text: prose, isCodeBlock: false));
      }
      break;
    }
    
    if (nextCodeBlockStart > index) {
      final prose = text.substring(index, nextCodeBlockStart);
      segments.add(MarkdownSegment(text: prose, isCodeBlock: false));
    }
    
    final codeStart = nextCodeBlockStart + 3;
    final nextCodeBlockEnd = text.indexOf('```', codeStart);
    
    if (nextCodeBlockEnd == -1) {
      final content = text.substring(codeStart);
      final firstNewline = content.indexOf('\n');
      String lang = '';
      String code = content;
      if (firstNewline != -1) {
        final possibleLang = content.substring(0, firstNewline).trim();
        if (possibleLang.isNotEmpty && !possibleLang.contains(' ') && possibleLang.length < 15) {
          lang = possibleLang;
          code = content.substring(firstNewline + 1);
        }
      }
      segments.add(MarkdownSegment(text: code, isCodeBlock: true, language: lang));
      break;
    }
    
    final content = text.substring(codeStart, nextCodeBlockEnd);
    final firstNewline = content.indexOf('\n');
    String lang = '';
    String code = content;
    if (firstNewline != -1) {
      final possibleLang = content.substring(0, firstNewline).trim();
      if (possibleLang.isNotEmpty && !possibleLang.contains(' ') && possibleLang.length < 15) {
        lang = possibleLang;
        code = content.substring(firstNewline + 1);
      }
    }
    
    segments.add(MarkdownSegment(
      text: code.trimRight(),
      isCodeBlock: true,
      language: lang,
    ));
    
    index = nextCodeBlockEnd + 3;
  }
  
  return segments;
}

class _MarkdownRenderer extends StatelessWidget {
  const _MarkdownRenderer({
    super.key,
    required this.text,
  });

  final String text;

  @override
  Widget build(BuildContext context) {
    final segments = parseMarkdown(text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: segments.map((seg) {
        if (seg.isCodeBlock) {
          return CodeBlockWidget(
            code: seg.text,
            language: seg.language,
          );
        } else {
          return _MarkdownProse(text: seg.text);
        }
      }).toList(),
    );
  }
}

class _MarkdownProse extends StatelessWidget {
  const _MarkdownProse({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final spans = <TextSpan>[];
    final pattern = RegExp(r'\*\*(.+?)\*\*|`(.+?)`');
    var i = 0;
    for (final m in pattern.allMatches(text)) {
      if (m.start > i) {
        spans.add(TextSpan(text: text.substring(i, m.start)));
      }
      if (m.group(1) != null) {
        spans.add(TextSpan(
          text: m.group(1),
          style: const TextStyle(fontWeight: FontWeight.w600),
        ));
      } else if (m.group(2) != null) {
        spans.add(TextSpan(
          text: m.group(2),
          style: DexType.mono(color: DexColors.text).copyWith(
            fontSize: 13,
            backgroundColor: Colors.black.withValues(alpha: 0.15),
          ),
        ));
      }
      i = m.end;
    }
    if (i < text.length) {
      spans.add(TextSpan(text: text.substring(i)));
    }
    
    return RichText(
      text: TextSpan(
        style: DexType.body(color: DexColors.text),
        children: spans,
      ),
    );
  }
}

class CodeBlockWidget extends StatefulWidget {
  const CodeBlockWidget({
    super.key,
    required this.code,
    required this.language,
  });

  final String code;
  final String language;

  @override
  State<CodeBlockWidget> createState() => _CodeBlockWidgetState();
}

class _CodeBlockWidgetState extends State<CodeBlockWidget> {
  bool _copied = false;

  void _copy() {
    Clipboard.setData(ClipboardData(text: widget.code));
    setState(() {
      _copied = true;
    });
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        setState(() {
          _copied = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final displayLang = widget.language.isEmpty ? 'CODE' : widget.language.toUpperCase();
    return Container(
      margin: const EdgeInsets.symmetric(vertical: DexSpace.sm),
      decoration: BoxDecoration(
        color: DexColors.surface2,
        borderRadius: DexRadius.rmd,
        border: Border.all(color: DexColors.border),
        boxShadow: DexSurface.glossyShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header Bar
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.md,
              vertical: DexSpace.sm,
            ),
            color: Colors.black.withValues(alpha: 0.25),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  displayLang,
                  style: DexType.caption(color: DexColors.textDim).copyWith(
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                  ),
                ),
                InkWell(
                  onTap: _copy,
                  borderRadius: BorderRadius.circular(4),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _copied ? LucideIcons.check : LucideIcons.copy,
                          size: 13,
                          color: _copied ? DexColors.stateApprove : DexColors.textDim,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          _copied ? 'Copied!' : 'Copy',
                          style: DexType.caption(
                            color: _copied ? DexColors.stateApprove : DexColors.textDim,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Code Box
          Padding(
            padding: const EdgeInsets.all(DexSpace.md),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SelectableText(
                widget.code,
                style: DexType.mono(color: DexColors.text).copyWith(fontSize: 13),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
