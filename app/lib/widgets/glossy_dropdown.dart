// A pill-shaped trigger button that opens a GlossyMenu listing the
// available options with a check mark next to the active one. Used by
// every Settings dropdown and the voice-mode language picker so the
// whole app speaks one popup language.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'glossy_menu.dart';

class GlossyDropdown extends StatefulWidget {
  const GlossyDropdown({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    this.width = 240,
  });

  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final double width;

  @override
  State<GlossyDropdown> createState() => _GlossyDropdownState();
}

class _GlossyDropdownState extends State<GlossyDropdown> {
  final GlobalKey _key = GlobalKey();
  bool _hovered = false;
  bool _open = false;

  Future<void> _openMenu() async {
    final ctx = _key.currentContext;
    if (ctx == null) return;
    final box = ctx.findRenderObject() as RenderBox?;
    if (box == null) return;
    final trigger = box.localToGlobal(Offset.zero) & box.size;
    setState(() => _open = true);
    final picked = await GlossyMenu.show<String>(
      context: context,
      trigger: trigger,
      // Dropdown buttons want the menu to fall under them by default.
      // GlossyMenu's positioning delegate flips upward only if the
      // measured menu would clip past the bottom edge.
      prefer: MenuDropDirection.down,
      width: widget.width,
      entries: <GlossyMenuEntry<String>>[
        for (final o in widget.options)
          GlossyMenuItem<String>(
            value: o,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    o,
                    style: DexType.label(
                      color: o == widget.value
                          ? DexColors.accent
                          : DexColors.text,
                    ),
                  ),
                ),
                if (o == widget.value)
                  const Icon(LucideIcons.check,
                      size: 14, color: DexColors.accent),
              ],
            ),
          ),
      ],
    );
    if (!mounted) return;
    setState(() => _open = false);
    if (picked != null) widget.onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    final activeBorder = _hovered || _open
        ? DexColors.accent.withValues(alpha: 0.55)
        : DexColors.border;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedContainer(
        key: _key,
        duration: DexMotion.respecting(context, DexMotion.hover),
        curve: DexMotion.respectingCurve(context, DexMotion.gentle),
        decoration: BoxDecoration(
          color: DexColors.surface.withValues(alpha: 0.6),
          borderRadius: DexRadius.rsm,
          border: Border.all(color: activeBorder),
        ),
        child: InkWell(
          borderRadius: DexRadius.rsm,
          onTap: _openMenu,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.md, vertical: DexSpace.xs,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(widget.value, style: DexType.label(color: DexColors.text)),
                const SizedBox(width: DexSpace.sm),
                AnimatedRotation(
                  turns: _open ? 0.5 : 0,
                  duration: DexMotion.respecting(context, DexMotion.hover),
                  curve: DexMotion.respectingCurve(context, DexMotion.gentle),
                  child: const Icon(LucideIcons.chevron_down,
                      size: 14, color: DexColors.textDim),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
