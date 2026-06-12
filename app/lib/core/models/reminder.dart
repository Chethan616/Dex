// A single user-scheduled reminder. Persisted in-memory on the
// ConversationStore for v1; the real backend lands when the gateway
// gets a `reminders.*` namespace.

import 'package:flutter/foundation.dart';

@immutable
class Reminder {
  const Reminder({
    required this.id,
    required this.text,
    required this.due,
    required this.createdAt,
  });

  /// Stable id (uuid v4) used as the cancel key.
  final String id;

  /// What the user typed -- "open vtop at 4pm", "remind me to ...".
  final String text;

  /// When the reminder should fire. v1 just stores it; v2 actually
  /// schedules a notification through the gateway.
  final DateTime due;

  /// When the user created the reminder. Drives the "added 5 min ago"
  /// hint on rows that haven't fired yet.
  final DateTime createdAt;

  Reminder copyWith({
    String? text,
    DateTime? due,
  }) {
    return Reminder(
      id: id,
      text: text ?? this.text,
      due: due ?? this.due,
      createdAt: createdAt,
    );
  }
}
