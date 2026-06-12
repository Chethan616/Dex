// Reminders -- a real screen for the user's scheduled prompts.
//
// Three regions, top to bottom:
//   1. Briefing tile (dismissable once) -- one short paragraph about
//      what Dex is and why Reminders matter, so a first-time visitor
//      isn't confused by the empty list.
//   2. "Add new" row -- input + pill buttons for "in 1h" / "tomorrow"
//      / pick-a-time. Drops a row into the store immediately.
//   3. Upcoming list -- glossy rows with title, relative time, cancel.
//
// All state lives on ConversationStore.reminders; this screen is a
// pure view that mutates via addReminder / cancelReminder.

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/models/reminder.dart';
import '../core/state/conversation_store.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/refractive_edge.dart';

const String _prefsKeyBriefingDismissed = 'dex.reminders.briefing.dismissed';

class RemindersScreen extends StatefulWidget {
  const RemindersScreen({super.key, required this.store});

  final ConversationStore store;

  static Future<void> show(BuildContext context, ConversationStore store) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Dismiss reminders',
      barrierColor: Colors.black.withValues(alpha: 0.4),
      transitionDuration: DexMotion.dialog,
      pageBuilder: (_, _, _) => RemindersScreen(store: store),
      transitionBuilder: (ctx, anim, _, child) {
        final reduce = MediaQuery.of(ctx).disableAnimations;
        if (reduce) return child;
        final eased = CurvedAnimation(parent: anim, curve: DexMotion.dampened);
        return FadeTransition(
          opacity: eased,
          child: AnimatedBuilder(
            animation: eased,
            builder: (_, c) => Transform.translate(
              offset: Offset(0, (1 - eased.value) * 20),
              child: Transform.scale(
                scale: 0.97 + 0.03 * eased.value,
                child: c,
              ),
            ),
            child: child,
          ),
        );
      },
    );
  }

  @override
  State<RemindersScreen> createState() => _RemindersScreenState();
}

class _RemindersScreenState extends State<RemindersScreen> {
  bool _briefingDismissed = false;
  bool _briefingLoaded = false;
  final TextEditingController _ctrl = TextEditingController();
  final FocusNode _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _loadBriefingState();
  }

  Future<void> _loadBriefingState() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _briefingDismissed =
          prefs.getBool(_prefsKeyBriefingDismissed) ?? false;
      _briefingLoaded = true;
    });
  }

  Future<void> _dismissBriefing() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefsKeyBriefingDismissed, true);
    if (!mounted) return;
    setState(() => _briefingDismissed = true);
  }

  void _add(DateTime due) {
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    widget.store.addReminder(text: text, due: due);
    _ctrl.clear();
    _focus.requestFocus();
  }

  Future<void> _pickAndAdd() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(hours: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(now.add(const Duration(hours: 1))),
    );
    if (time == null || !mounted) return;
    _add(DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 600, minHeight: 480, maxHeight: 640,
          ),
          child: DecoratedBox(
            decoration: const BoxDecoration(
              borderRadius: DexRadius.rlg,
              boxShadow: DexSurface.glossyShadow,
            ),
            child: RefractiveEdge(
              radius: DexRadius.rlg,
              child: BackdropFilter(
                filter: ImageFilter.blur(
                  sigmaX: DexSurface.blurSigma,
                  sigmaY: DexSurface.blurSigma,
                ),
                child: Container(
                  decoration: BoxDecoration(
                    gradient: DexSurface.glossyGradient(),
                  ),
                  child: AnimatedBuilder(
                    animation: widget.store,
                    builder: (context, _) {
                      final reminders = widget.store.reminders;
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _Header(onClose: () => Navigator.of(context).maybePop()),
                          const Divider(height: 1, color: DexColors.border),
                          Expanded(
                            child: SingleChildScrollView(
                              padding: const EdgeInsets.all(DexSpace.lg),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  if (_briefingLoaded && !_briefingDismissed)
                                    _BriefingTile(onDismiss: _dismissBriefing),
                                  if (_briefingLoaded && !_briefingDismissed)
                                    const SizedBox(height: DexSpace.lg),
                                  _AddRow(
                                    controller: _ctrl,
                                    focusNode: _focus,
                                    onIn1h: () => _add(DateTime.now()
                                        .add(const Duration(hours: 1))),
                                    onTomorrow: () => _add(DateTime.now()
                                        .add(const Duration(days: 1))),
                                    onPickTime: _pickAndAdd,
                                  ),
                                  const SizedBox(height: DexSpace.xl),
                                  Text(
                                    'Upcoming',
                                    style: DexType.caption(color: DexColors.textDim)
                                        .copyWith(
                                      letterSpacing: 0.5,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: DexSpace.sm),
                                  if (reminders.isEmpty)
                                    _EmptyHint()
                                  else
                                    ...reminders.map((r) => _ReminderRow(
                                          reminder: r,
                                          onCancel: () =>
                                              widget.store.cancelReminder(r.id),
                                        )),
                                ],
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.onClose});
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.lg, vertical: DexSpace.md,
      ),
      child: Row(
        children: [
          const Icon(LucideIcons.alarm_clock, size: 18, color: DexColors.textDim),
          const SizedBox(width: DexSpace.sm),
          Expanded(
            child: Text('Reminders',
                style: DexType.heading(color: DexColors.text)),
          ),
          IconButton(
            icon: const Icon(LucideIcons.x, size: 18),
            color: DexColors.textDim,
            onPressed: onClose,
            tooltip: 'Close',
          ),
        ],
      ),
    );
  }
}

class _BriefingTile extends StatelessWidget {
  const _BriefingTile({required this.onDismiss});
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DexSpace.lg),
      decoration: BoxDecoration(
        color: DexColors.accentQuiet.withValues(alpha: 0.4),
        borderRadius: DexRadius.rmd,
        border: Border.all(
          color: DexColors.accent.withValues(alpha: 0.30),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(LucideIcons.sparkles, size: 14, color: DexColors.accent),
              const SizedBox(width: DexSpace.sm),
              Expanded(
                child: Text(
                  'About Dex',
                  style: DexType.label(color: DexColors.accent),
                ),
              ),
              MouseRegion(
                cursor: SystemMouseCursors.click,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: onDismiss,
                  child: const Padding(
                    padding: EdgeInsets.all(DexSpace.xs),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(LucideIcons.x,
                            size: 12, color: DexColors.accent),
                        SizedBox(width: 4),
                        Text('Got it',
                            style: TextStyle(
                              fontSize: 11,
                              color: DexColors.accent,
                              fontWeight: FontWeight.w500,
                            )),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DexSpace.sm),
          Text(
            'Dex is a Windows-first personal AI assistant. It drives '
            'your real apps with one-tap approval, sees what is on your '
            'screen when you ask, and helps you find files across your '
            'connected devices. Reminders let you tell Dex what to do '
            'later -- "remind me to open vtop.vit.ac.in at 4pm" -- and '
            'Dex surfaces them here so nothing slips. Tap the bell '
            'beside any row to cancel.',
            style: DexType.body(color: DexColors.textDim),
          ),
        ],
      ),
    );
  }
}

class _AddRow extends StatelessWidget {
  const _AddRow({
    required this.controller,
    required this.focusNode,
    required this.onIn1h,
    required this.onTomorrow,
    required this.onPickTime,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onIn1h;
  final VoidCallback onTomorrow;
  final VoidCallback onPickTime;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.md, vertical: DexSpace.sm,
      ),
      decoration: BoxDecoration(
        color: DexColors.surface.withValues(alpha: 0.4),
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Row(
        children: [
          const Icon(LucideIcons.plus,
              size: 16, color: DexColors.textDim),
          const SizedBox(width: DexSpace.sm),
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              style: DexType.body(color: DexColors.text),
              decoration: InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                filled: false,
                hintText: 'Remind me to ...',
                hintStyle: DexType.body(color: DexColors.textFaint),
              ),
              onSubmitted: (_) => onIn1h(),
            ),
          ),
          _TimePill(label: 'in 1h', onTap: onIn1h),
          const SizedBox(width: DexSpace.xs),
          _TimePill(label: 'tomorrow', onTap: onTomorrow),
          const SizedBox(width: DexSpace.xs),
          _TimePill(label: 'pick', onTap: onPickTime, icon: LucideIcons.clock),
        ],
      ),
    );
  }
}

class _TimePill extends StatelessWidget {
  const _TimePill({required this.label, required this.onTap, this.icon});
  final String label;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: InkWell(
        onTap: onTap,
        borderRadius: DexRadius.rpill,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.sm, vertical: 4,
          ),
          decoration: BoxDecoration(
            color: DexColors.accentQuiet,
            borderRadius: DexRadius.rpill,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 11, color: DexColors.accent),
                const SizedBox(width: 4),
              ],
              Text(label,
                  style: DexType.caption(color: DexColors.accent)),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyHint extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DexSpace.lg),
      alignment: Alignment.center,
      child: Text(
        'No reminders yet. Type one above and pick a time.',
        style: DexType.caption(color: DexColors.textFaint),
      ),
    );
  }
}

class _ReminderRow extends StatelessWidget {
  const _ReminderRow({required this.reminder, required this.onCancel});
  final Reminder reminder;
  final VoidCallback onCancel;

  String _relativeTime(DateTime due) {
    final now = DateTime.now();
    final delta = due.difference(now);
    if (delta.isNegative) return 'overdue';
    if (delta.inMinutes < 60) return 'in ${delta.inMinutes}m';
    if (delta.inHours < 24) return 'in ${delta.inHours}h';
    if (delta.inDays < 7) {
      return 'in ${delta.inDays}d at ${DateFormat.jm().format(due)}';
    }
    return DateFormat.MMMd().add_jm().format(due);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.md, vertical: DexSpace.sm,
        ),
        decoration: BoxDecoration(
          color: DexColors.surface.withValues(alpha: 0.4),
          borderRadius: DexRadius.rsm,
          border: Border.all(color: DexColors.border),
        ),
        child: Row(
          children: [
            const Icon(LucideIcons.alarm_clock,
                size: 14, color: DexColors.textDim),
            const SizedBox(width: DexSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    reminder.text,
                    style: DexType.label(color: DexColors.text),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _relativeTime(reminder.due),
                    style: DexType.caption(color: DexColors.textFaint),
                  ),
                ],
              ),
            ),
            MouseRegion(
              cursor: SystemMouseCursors.click,
              child: IconButton(
                icon: const Icon(LucideIcons.x, size: 14),
                color: DexColors.textFaint,
                onPressed: onCancel,
                tooltip: 'Cancel reminder',
                visualDensity: VisualDensity.compact,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
