// dexToast — the app's standard transient notification, now a liquid-glass
// toast (GlassToast) instead of a Material SnackBar. Floats over content,
// frosted, with the package's spring entrance. Use for "Copied", "Saved",
// "Restarting…" style feedback.

import 'package:flutter/widgets.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

void dexToast(
  BuildContext context,
  String message, {
  GlassToastType type = GlassToastType.neutral,
  Duration duration = const Duration(seconds: 2),
}) {
  GlassToast.show(
    context,
    message: message,
    type: type,
    duration: duration,
  );
}
