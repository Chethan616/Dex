// Shared glossy popup menu. Used by the composer's mode picker + add
// menu, the user-profile dropdown, the voice-mode language picker,
// and the Settings tab dropdowns.
//
// Layout: a [CustomSingleChildLayout] measures the menu's intrinsic
// height after layout, then picks a drop direction (above the trigger
// or below it) based on which side has room. If neither has room for
// the full menu, the card constrains its height and scrolls internally
// so the menu never escapes the viewport. This is what fixes the
// "mode picker / + menu goes off-screen in the chat view" complaint.

import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';

import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'refractive_edge.dart';

/// Which side of the trigger button the menu should land on by default.
/// The layout delegate can still flip the choice when the preferred
/// side doesn't have room, so this is a hint not a hard rule.
enum MenuDropDirection { up, down }

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

  /// Show a glossy popup positioned relative to [trigger] (the screen
  /// rect of the button that opened it). The menu lands on the [prefer]
  /// side of the trigger if there's room, otherwise flips. If neither
  /// side fits the full content, the card clamps to the viewport and
  /// scrolls inside.
  ///
  /// Returns the value of the tapped [GlossyMenuItem], or null if the
  /// barrier was dismissed.
  static Future<T?> show<T>({
    required BuildContext context,
    required Rect trigger,
    required List<GlossyMenuEntry<T>> entries,
    double width = 260,
    MenuDropDirection prefer = MenuDropDirection.up,
  }) {
    return showGeneralDialog<T>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Dismiss menu',
      barrierColor: Colors.transparent,
      transitionDuration: DexMotion.hover,
      pageBuilder: (ctx, _, _) {
        return _GlossyMenuLayer<T>(
          trigger: trigger,
          width: width,
          prefer: prefer,
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
    required this.trigger,
    required this.width,
    required this.prefer,
    required this.entries,
  });
  final Rect trigger;
  final double width;
  final MenuDropDirection prefer;
  final List<GlossyMenuEntry<T>> entries;

  @override
  Widget build(BuildContext context) {
    return CustomSingleChildLayout(
      delegate: _MenuPositionDelegate(
        trigger: trigger,
        width: width,
        prefer: prefer,
      ),
      child: _GlossyMenuCard<T>(entries: entries),
    );
  }
}

/// Picks the menu's final on-screen rect after the card has measured
/// itself. Tries the preferred side first; if the card is taller than
/// that side has room for, flips to the other side; if neither side
/// fits, the card already had its maxHeight clamped via
/// [getConstraintsForChild] so it will scroll internally.
class _MenuPositionDelegate extends SingleChildLayoutDelegate {
  _MenuPositionDelegate({
    required this.trigger,
    required this.width,
    required this.prefer,
  });

  final Rect trigger;
  final double width;
  final MenuDropDirection prefer;

  static const double _margin = 16.0;
  static const double _gap = 6.0;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    // Pin the width; the height gets the larger of the two sides minus
    // the trigger gap, so the card can scroll inside if its intrinsic
    // height blows past that.
    final aboveRoom = math.max(0.0, trigger.top - _margin - _gap);
    final belowRoom =
        math.max(0.0, constraints.maxHeight - trigger.bottom - _margin - _gap);
    final maxHeight = math.max(aboveRoom, belowRoom);
    return BoxConstraints(
      minWidth: width,
      maxWidth: width,
      minHeight: 0,
      maxHeight: math.max(120, maxHeight),
    );
  }

  @override
  Offset getPositionForChild(Size parentSize, Size childSize) {
    // X: align under the trigger's left edge, clamp to viewport.
    final maxLeft = math.max(_margin, parentSize.width - childSize.width - _margin);
    final left = trigger.left.clamp(_margin, maxLeft);

    // Y: pick a direction. Default to caller's preference, flip when
    // the preferred side can't fit the measured child.
    final aboveRoom = trigger.top - _margin - _gap;
    final belowRoom = parentSize.height - trigger.bottom - _margin - _gap;

    final bool dropUp;
    if (prefer == MenuDropDirection.up) {
      dropUp = childSize.height <= aboveRoom || aboveRoom >= belowRoom;
    } else {
      dropUp = childSize.height > belowRoom && aboveRoom > belowRoom;
    }

    final double top;
    if (dropUp) {
      top = trigger.top - childSize.height - _gap;
    } else {
      top = trigger.bottom + _gap;
    }
    final maxTop = math.max(_margin, parentSize.height - childSize.height - _margin);
    return Offset(left.toDouble(), top.clamp(_margin, maxTop));
  }

  @override
  bool shouldRelayout(_MenuPositionDelegate oldDelegate) {
    return trigger != oldDelegate.trigger ||
        width != oldDelegate.width ||
        prefer != oldDelegate.prefer;
  }
}

class _GlossyMenuCard<T> extends StatelessWidget {
  const _GlossyMenuCard({required this.entries});
  final List<GlossyMenuEntry<T>> entries;

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: DecoratedBox(
        // Shadow on outer box so it isn't clipped by the rounded mask.
        decoration: const BoxDecoration(
          borderRadius: DexRadius.rmd,
          boxShadow: DexSurface.glossyShadow,
        ),
        child: RefractiveEdge(
          radius: DexRadius.rmd,
          child: BackdropFilter(
            filter: ImageFilter.blur(
              sigmaX: DexSurface.blurSigma,
              sigmaY: DexSurface.blurSigma,
            ),
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: DexSurface.glossyGradient(),
              ),
              // The parent CustomSingleChildLayout already pinned width
              // and capped maxHeight; SingleChildScrollView lets the
              // column scroll internally when entries exceed that cap
              // (e.g. on very small windows).
              child: SingleChildScrollView(
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
