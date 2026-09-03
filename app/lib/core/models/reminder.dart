// One reminder, as the core holds it.
//
// It used to live on a Dart object: created in the app, listed from memory,
// and gone the moment Dex closed. Nothing ever fired one — the screen let the
// owner write down a time and quietly forgot it, which is worse than not
// having the screen. Now this is a view of a row in the schedules table, and
// the ringing happens in the core whether the app is open or not.

import 'package:flutter/foundation.dart';

@immutable
class Reminder {
  const Reminder({
    required this.id,
    required this.text,
    required this.due,
    required this.createdAt,
    this.rang = false,
    this.done = false,
  });

  /// The core's name for it. The cancel, snooze and complete key.
  final String id;

  /// What the owner wants to be told.
  final String text;

  /// When it is due.
  final DateTime due;

  final DateTime createdAt;

  /// It has gone off. The row stays until the owner deals with it, because a
  /// reminder that has rung and been ignored is the one they most need to see.
  final bool rang;

  /// The owner has dealt with it.
  final bool done;

  bool get overdue => !done && due.isBefore(DateTime.now());

  static Reminder? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['name'];
    final text = raw['text'];
    final at = raw['at'];
    if (id is! String || text is! String || at is! num) return null;

    return Reminder(
      id: id,
      text: text,
      due: DateTime.fromMillisecondsSinceEpoch(at.toInt()),
      createdAt: DateTime.fromMillisecondsSinceEpoch(
        (raw['createdAt'] as num?)?.toInt() ?? at.toInt(),
      ),
      rang: raw['rang'] == true,
      done: raw['done'] == true,
    );
  }

  Reminder copyWith({String? text, DateTime? due}) => Reminder(
        id: id,
        text: text ?? this.text,
        due: due ?? this.due,
        createdAt: createdAt,
        rang: rang,
        done: done,
      );
}
