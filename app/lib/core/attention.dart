// Bringing Dex to the owner when it needs an answer.
//
// A confirmation card is a question that blocks a task, and the owner is
// usually looking at something else — the browser Dex is driving, most of the
// time. A card that appears in a window behind three others is a task that
// sits there until they happen to alt-tab back and find it waiting.
//
// **Raising a window on Windows is not free of input.** `window_manager`'s
// show/focus path pushes a synthetic mouse event through `SendInput` to get
// past the foreground-activation lock, and Windows delivers it to whatever is
// under the pointer — including the Approve button on the card that was just
// raised. Measured on this app: summoning the window produces a left-button
// down/up at the cursor. That is why `WindowActivity` exists, and it is why
// raising the window here is safe: a control arms only once the pointer has
// actually moved since the window appeared, and the injected click arrives at
// a cursor that has not.
//
// So this is deliberately a *raise*, not a steal. `show` + `focus` puts it in
// front; nothing here disables the guard, and the card still cannot be
// answered by anything but a real hand.

import 'package:window_manager/window_manager.dart';

import 'log.dart';
import 'window_activity.dart';

class Attention {
  Attention._();

  /// Long enough that a burst of cards raises once rather than four times.
  ///
  /// The Orchestrator can queue several approvals for one plan, and each
  /// arrives as its own frame. Without this the window would fight for the
  /// foreground once per card while the owner is trying to read the first.
  static const _quiet = Duration(seconds: 3);

  static DateTime _lastRaise = DateTime.fromMillisecondsSinceEpoch(0);

  /// Bring the window forward because something needs the owner.
  ///
  /// Never throws: this runs on the path that shows a confirmation, and a
  /// window that could not be raised must still leave the card on screen for
  /// whenever they do come back.
  static Future<void> needed({String reason = ''}) async {
    final now = DateTime.now();
    if (now.difference(_lastRaise) < _quiet) return;
    _lastRaise = now;

    try {
      if (await windowManager.isMinimized()) {
        await windowManager.restore();
      }
      await windowManager.show();
      await windowManager.focus();

      // The same mark the window listeners make. Without it the guard would
      // not know this activation happened, and the click the raise injects
      // would look like a person's.
      WindowActivity.mark();

      DexLog.i('window', 'raised: ${reason.isEmpty ? "input needed" : reason}');
    } catch (err) {
      // A window that cannot be raised is not a reason to lose the card.
      DexLog.w('window', 'could not raise: $err');
    }
  }
}
