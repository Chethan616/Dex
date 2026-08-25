/// Guards consequential controls against input the owner never produced.
///
/// Raising a window on Windows is not input-free. `window_manager`'s show/focus
/// path injects a synthetic mouse event through `SendInput` to get past the
/// foreground-activation lock, and Windows delivers it to whatever sits under
/// the pointer — including a button on the window it just raised. Measured on
/// this app: a task that only resizes the bar produces no pointer events, while
/// a task that summons it produces a left-button down/up at the cursor.
///
/// A timeout alone cannot gate that click: its delivery latency was observed
/// anywhere from a few milliseconds to over a second, so any threshold either
/// leaks or makes real approvals feel dead. The reliable signal is *movement* —
/// the injected click arrives at a cursor that has not moved since before the
/// window appeared, whereas a person must move onto a button to press it.
///
/// So a control is safe to arm only once both hold:
///   * a short settle delay has elapsed since the window was raised or moved,
///   * and the pointer has actually moved since then.
class WindowActivity {
  WindowActivity._();

  /// Floor delay after activation. Mutable only so tests can shrink it.
  static Duration settleDelay = const Duration(milliseconds: 400);

  static int _lastActivationMs = 0;
  static bool _pointerMoved = false;

  /// Call whenever the window is shown, focused, moved or resized.
  static void mark() {
    _lastActivationMs = DateTime.now().millisecondsSinceEpoch;
    _pointerMoved = false;
  }

  /// Marks now and again after [after], for operations whose injected input
  /// arrives once the window has finished appearing or animating.
  static void markThrough(Duration after) {
    mark();
    Future<void>.delayed(after, mark);
  }

  /// Call from a top-level pointer listener on hover/move.
  static void notePointerMoved() {
    _pointerMoved = true;
  }

  static bool get pointerMovedSinceActivation => _pointerMoved;

  static Duration get sinceActivation => Duration(
        milliseconds: DateTime.now().millisecondsSinceEpoch - _lastActivationMs,
      );

  static bool get settled => sinceActivation >= settleDelay;

  /// The full condition a confirmation button must satisfy.
  static bool get safeToAccept => settled && _pointerMoved;

  /// Test seam: pretend the owner moved the mouse.
  static void debugNotePointerMoved() => notePointerMoved();
}
