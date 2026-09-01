// GlassSwitch with the hand cursor. The package's GlassSwitch (like its
// other glass widgets) doesn't set a mouse cursor, so on desktop it shows
// the default arrow on hover; this wrapper makes toggles read as clickable.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';

class DexSwitch extends StatelessWidget {
  const DexSwitch({super.key, required this.value, required this.onChanged});
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GlassSwitch(
        value: value,
        onChanged: onChanged,
        activeColor: DexColors.accent,
      ),
    );
  }
}
