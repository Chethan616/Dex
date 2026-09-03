// The empty-state home surface. Centered greeting, big composer, suggestion
// chips, and a two-card row of recent files + recent chats below.
//
// Each section fades in + slides up from below on first mount, staggered
// by ~70ms so the whole page reads as alive instead of plopping in. The
// reduced-motion code path skips the animation entirely.

import 'package:flutter/material.dart';

import '../../core/dex_taglines.dart';
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
    this.onClear,
    this.onNewChat,
    this.onOpenScreen,
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
  final VoidCallback? onClear;
  final VoidCallback? onNewChat;
  final void Function(String screen)? onOpenScreen;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // No scroll view: the hero (greeting + composer + chips) is centered
        // in the flexible top region; the recent cards + disclaimer pin to the
        // bottom. Cards only render when the window is tall enough so the hero
        // never gets squeezed or pushed into a scroll.
        final showCards = constraints.maxHeight > 760 &&
            (recentFiles.isNotEmpty || recentChats.isNotEmpty);
        // Everything is one vertically-centered group (no scroll, no big
        // gap pushing the cards to the floor) so the hero, chips and recent
        // cards read as a single balanced composition.
        return Padding(
          padding: const EdgeInsets.fromLTRB(
            DexSpace.xxl, DexSpace.lg, DexSpace.xxl, DexSpace.lg,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 880),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _FadeInUp(
                    index: 0,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('Hi $greetingName',
                            textAlign: TextAlign.center,
                            style: DexType.label(color: DexColors.textDim)),
                        const SizedBox(height: DexSpace.xs),
                        // A witty tagline from the same set the CLI banner
                        // shows â€” picked once per launch.
                        _Typewriter(
                          text: dexSessionTagline,
                          style: DexType.title(color: DexColors.text),
                        ),
                      ],
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
                      onClear: onClear,
                      onNewChat: onNewChat,
                      onOpenScreen: onOpenScreen,
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
                  if (showCards) ...[
                    const SizedBox(height: DexSpace.xl),
                    _FadeInUp(
                      index: 3,
                      child: _Cards(
                        recentFiles: recentFiles,
                        recentChats: recentChats,
                        onSelectFile: onSelectFile,
                        onSelectChat: onSelectChat,
                      ),
                    ),
                  ],
                  const SizedBox(height: DexSpace.lg),
                  _FadeInUp(
                    index: 4,
                    child: Text(
                      'Dex is an agent and may make mistakes. Every action shows a preview first.',
                      textAlign: TextAlign.center,
                      style: DexType.caption(
                          color: DexColors.text.withValues(alpha: 0.7)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Streams the greeting in one character at a time over ~700ms so the
/// home screen reads as alive on first mount rather than the title
/// "plopping" in. Reserves layout for the full text from the first
/// frame to avoid the page reflowing as chars land. Reduced-motion
/// users get the full string immediately.
class _Typewriter extends StatefulWidget {
  const _Typewriter({required this.text, required this.style});
  final String text;
  final TextStyle style;

  @override
  State<_Typewriter> createState() => _TypewriterState();
}

class _TypewriterState extends State<_Typewriter>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    )..forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduce) {
      return Text(
        widget.text,
        textAlign: TextAlign.center,
        style: widget.style,
      );
    }
    // Pre-size the layout by stacking the visible-typed text on top of
    // a fully-transparent copy of the full string. That way the
    // surrounding column doesn't jump as characters land.
    return Stack(
      alignment: Alignment.center,
      children: [
        Opacity(
          opacity: 0,
          child: Text(
            widget.text,
            textAlign: TextAlign.center,
            style: widget.style,
          ),
        ),
        AnimatedBuilder(
          animation: _ctrl,
          builder: (context, _) {
            // easeOutCubic so the last few chars don't feel rushed.
            final t = Curves.easeOutCubic.transform(_ctrl.value);
            final count = (widget.text.length * t).round();
            return Text(
              widget.text.substring(0, count),
              textAlign: TextAlign.center,
              style: widget.style,
            );
          },
        ),
      ],
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

/// The two recent-activity cards (recent files + recent chats) under the
/// hero. Each renders only when its list is non-empty; with both present
/// they split the row evenly, with one it spans full width.
class _Cards extends StatelessWidget {
  const _Cards({
    required this.recentFiles,
    required this.recentChats,
    this.onSelectFile,
    this.onSelectChat,
  });

  final List<RecentFileItem> recentFiles;
  final List<RecentChatItem> recentChats;
  final ValueChanged<RecentFileItem>? onSelectFile;
  final ValueChanged<RecentChatItem>? onSelectChat;

  @override
  Widget build(BuildContext context) {
    final cards = <Widget>[
      if (recentFiles.isNotEmpty)
        Expanded(
          child: RecentFilesCard(files: recentFiles, onSelect: onSelectFile),
        ),
      if (recentChats.isNotEmpty)
        Expanded(
          child: RecentChatsCard(chats: recentChats, onSelect: onSelectChat),
        ),
    ];
    if (cards.isEmpty) return const SizedBox.shrink();
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < cards.length; i++) ...[
          if (i > 0) const SizedBox(width: DexSpace.lg),
          cards[i],
        ],
      ],
    );
  }
}
