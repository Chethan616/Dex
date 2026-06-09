// The empty-state home surface. Centered greeting, big composer, suggestion
// chips, and a two-card row of recent files + recent chats below.
//
// Each section fades in + slides up from below on first mount, staggered
// by ~70ms so the whole page reads as alive instead of plopping in. The
// reduced-motion code path skips the animation entirely.

import 'package:flutter/material.dart';

import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../composer/add_menu.dart';
import '../composer/dex_composer.dart';
import 'recent_chats_card.dart';
import 'recent_files_card.dart';
import 'suggestion_chip.dart';

class EmptyHome extends StatelessWidget {
  const EmptyHome({
    super.key,
    required this.greetingName,
    required this.suggestions,
    required this.recentFiles,
    required this.recentChats,
    required this.onSubmit,
    this.isBusy = false,
    this.onStop,
    this.onVision,
    this.onVoice,
    this.onAddAction,
    this.onSelectFile,
    this.onSelectChat,
  });

  final String greetingName;
  final List<String> suggestions;
  final List<RecentFileItem> recentFiles;
  final List<RecentChatItem> recentChats;
  final ValueChanged<String> onSubmit;
  final bool isBusy;
  final VoidCallback? onStop;
  final VoidCallback? onVision;
  final VoidCallback? onVoice;
  final ValueChanged<ComposerAddAction>? onAddAction;
  final ValueChanged<RecentFileItem>? onSelectFile;
  final ValueChanged<RecentChatItem>? onSelectChat;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 900;
        return SingleChildScrollView(
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.xxl, vertical: DexSpace.xxl,
          ),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 880),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _FadeInUp(
                      index: 0,
                      child: Text(
                        'Hi $greetingName, what should we dive into today?',
                        textAlign: TextAlign.center,
                        style: DexType.title(color: DexColors.text),
                      ),
                    ),
                    const SizedBox(height: DexSpace.xl),
                    _FadeInUp(
                      index: 1,
                      child: DexComposer(
                        onSubmit: onSubmit,
                        isBusy: isBusy,
                        onStop: onStop,
                        onVision: onVision,
                        onVoice: onVoice,
                        onAddAction: onAddAction,
                      ),
                    ),
                    const SizedBox(height: DexSpace.lg),
                    _FadeInUp(
                      index: 2,
                      child: Wrap(
                        alignment: WrapAlignment.center,
                        spacing: DexSpace.sm,
                        runSpacing: DexSpace.sm,
                        children: suggestions
                            .map((s) => SuggestionChip(
                                  label: s,
                                  onTap: () => onSubmit(s),
                                ))
                            .toList(growable: false),
                      ),
                    ),
                    const SizedBox(height: DexSpace.xxl),
                    _FadeInUp(
                      index: 3,
                      child: _Cards(
                        wide: wide,
                        files: recentFiles,
                        chats: recentChats,
                        onSelectFile: onSelectFile,
                        onSelectChat: onSelectChat,
                      ),
                    ),
                    _FadeInUp(
                      index: 4,
                      child: Padding(
                        padding: const EdgeInsets.only(top: DexSpace.lg),
                        child: Text(
                          'Dex is an agent and may make mistakes. Every action shows a preview first.',
                          textAlign: TextAlign.center,
                          style: DexType.caption(color: DexColors.textFaint),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Fade-in + slide-up entry animation used to stagger the empty-home
/// sections so the page feels alive when you land on it. Each child is
/// driven by its own short AnimationController; the [index] picks a
/// delay (index * DexMotion.entryStagger) so the column ripples in from
/// top to bottom. Reduced-motion users get the child immediately.
class _FadeInUp extends StatefulWidget {
  const _FadeInUp({required this.child, required this.index});
  final Widget child;
  final int index;

  @override
  State<_FadeInUp> createState() => _FadeInUpState();
}

class _FadeInUpState extends State<_FadeInUp>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: DexMotion.entry);
    final delay = DexMotion.entryStagger * widget.index;
    if (delay == Duration.zero) {
      _ctrl.forward();
    } else {
      Future<void>.delayed(delay, () {
        if (mounted) _ctrl.forward();
      });
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduce) return widget.child;
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (context, child) {
        final t = DexMotion.expressiveEntry.transform(_ctrl.value);
        return Opacity(
          opacity: t,
          child: Transform.translate(
            offset: Offset(0, (1 - t) * 18),
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}

class _Cards extends StatelessWidget {
  const _Cards({
    required this.wide,
    required this.files,
    required this.chats,
    required this.onSelectFile,
    required this.onSelectChat,
  });

  final bool wide;
  final List<RecentFileItem> files;
  final List<RecentChatItem> chats;
  final ValueChanged<RecentFileItem>? onSelectFile;
  final ValueChanged<RecentChatItem>? onSelectChat;

  @override
  Widget build(BuildContext context) {
    final filesCard = RecentFilesCard(files: files, onSelect: onSelectFile);
    final chatsCard = RecentChatsCard(chats: chats, onSelect: onSelectChat);
    if (!wide) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          filesCard,
          const SizedBox(height: DexSpace.md),
          chatsCard,
        ],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: filesCard),
        const SizedBox(width: DexSpace.md),
        Expanded(child: chatsCard),
      ],
    );
  }
}
