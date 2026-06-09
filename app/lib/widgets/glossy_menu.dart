// Shared glossy popup menu. Used by the composer's mode picker + add
// menu, the user-profile dropdown, and the voice-mode language picker.
// Replaces Flutter's stock showMenu (which can't do gradient surfaces)
// with a custom showGeneralDialog that mounts a glossy card with the
// same blur + edge-highlight + spring-in entry as the chat composer.

import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';

import '../theme/motion.dart';
import '../theme/tokens.dart';

/// Entries that a [GlossyMenu] can render. Sealed so the menu can pattern-
/// match: tappable items, non-interactive headers, simple dividers.
sealed class GlossyMenuEntry<T> {
  const GlossyMenuEntry();
}

class GlossyMenuItem<T> extends GlossyMenuEntry<T> {
  const GlossyMenuItem({
    required this.value,
    required this.child,
    this.enabled = true,
  });

  /// Returned from `GlossyMenu.show` when the user taps this entry.
  final T value;
  final Widget child;
  final bool enabled;
}

class GlossyMenuHeader<T> extends GlossyMenuEntry<T> {
  const GlossyMenuHeader({required this.child});
  final Widget child;
}

class GlossyMenuDivider<T> extends GlossyMenuEntry<T> {
  const GlossyMenuDivider();
}

class GlossyMenu {
  GlossyMenu._();

  /// Show a glossy popup anchored at [anchor] (screen-global top-left).
  /// Returns the value of the tapped [GlossyMenuItem], or null if the
  /// barrier was dismissed.
  static Future<T?> show<T>({
    required BuildContext context,
    required Offset anchor,
    required List<GlossyMenuEntry<T>> entries,
    double width = 260,
  }) {
    return showGeneralDialog<T>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Dismiss menu',
      barrierColor: Colors.transparent,
      transitionDuration: DexMotion.hover,
      pageBuilder: (ctx, _, _) {
        return _GlossyMenuLayer<T>(
          anchor: anchor,
          width: width,
          entries: entries,
        );
      },
      transitionBuilder: (ctx, anim, _, child) {
        final reduce = MediaQuery.of(ctx).disableAnimations;
        if (reduce) return child;
        // Dampened decelerate -- same curve the dialogs use, so the
        // whole popup family lands with one motion language. Fade
        // + tiny 6px slide-down from the anchor + soft scale, no
        // spring overshoot.
        final eased = CurvedAnimation(parent: anim, curve: DexMotion.dampened);
        return FadeTransition(
          opacity: eased,
          child: AnimatedBuilder(
            animation: eased,
            builder: (_, c) => Transform.translate(
              offset: Offset(0, (1 - eased.value) * -6),
              child: Transform.scale(
                scale: 0.96 + 0.04 * eased.value,
                alignment: Alignment.topLeft,
                child: c,
              ),
            ),
            child: child,
          ),
        );
      },
    );
  }
}

class _GlossyMenuLayer<T> extends StatelessWidget {
  const _GlossyMenuLayer({
    required this.anchor,
    required this.width,
    required this.entries,
  });
  final Offset anchor;
  final double width;
  final List<GlossyMenuEntry<T>> entries;

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final left = anchor.dx.clamp(DexSpace.md, screen.width - width - DexSpace.md);
    return Stack(
      children: [
        Positioned(
          left: left,
          top: anchor.dy.clamp(DexSpace.md, screen.height - DexSpace.md),
          child: _GlossyMenuCard<T>(width: width, entries: entries),
        ),
      ],
    );
  }
}

class _GlossyMenuCard<T> extends StatelessWidget {
  const _GlossyMenuCard({required this.width, required this.entries});
  final double width;
  final List<GlossyMenuEntry<T>> entries;

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: ClipRRect(
        borderRadius: DexRadius.rmd,
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: DexSurface.blurSigma,
            sigmaY: DexSurface.blurSigma,
          ),
          child: Container(
            width: width,
            decoration: BoxDecoration(
              gradient: DexSurface.glossyGradient(),
              borderRadius: DexRadius.rmd,
              border: DexSurface.glossyBorder(),
              boxShadow: DexSurface.glossyShadow,
            ),
            padding: const EdgeInsets.symmetric(vertical: DexSpace.xs),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: entries
                  .map((e) => _renderEntry(context, e))
                  .toList(growable: false),
            ),
          ),
        ),
      ),
    );
  }

  Widget _renderEntry(BuildContext context, GlossyMenuEntry<T> entry) {
    return switch (entry) {
      GlossyMenuDivider<T>() => const Padding(
          padding: EdgeInsets.symmetric(
            horizontal: DexSpace.md,
            vertical: DexSpace.xs,
          ),
          child: Divider(height: 1, color: DexColors.border, thickness: 1),
        ),
      GlossyMenuHeader<T>(child: final c) => Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.md,
            vertical: DexSpace.sm,
          ),
          child: c,
        ),
      GlossyMenuItem<T>() => _GlossyMenuTile<T>(
          value: entry.value,
          enabled: entry.enabled,
          child: entry.child,
        ),
    };
  }
}

class _GlossyMenuTile<T> extends StatefulWidget {
  const _GlossyMenuTile({
    required this.value,
    required this.enabled,
    required this.child,
  });
  final T value;
  final bool enabled;
  final Widget child;

  @override
  State<_GlossyMenuTile<T>> createState() => _GlossyMenuTileState<T>();
}

class _GlossyMenuTileState<T> extends State<_GlossyMenuTile<T>> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final bg = !widget.enabled
        ? Colors.transparent
        : _hovered
            ? DexColors.accentQuiet
            : Colors.transparent;
    return MouseRegion(
      cursor:
          widget.enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.enabled
            ? () => Navigator.of(context).pop(widget.value)
            : null,
        child: AnimatedContainer(
          duration: DexMotion.hover,
          curve: DexMotion.gentle,
          margin: const EdgeInsets.symmetric(
            horizontal: DexSpace.xs,
            vertical: 1,
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.sm,
            vertical: DexSpace.sm,
          ),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: DexRadius.rsm,
          ),
          child: Opacity(
            opacity: widget.enabled ? 1.0 : 0.5,
            child: widget.child,
          ),
        ),
      ),
    );
  }
}
