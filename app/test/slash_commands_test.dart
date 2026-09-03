// The command palette, and the two things that made it worth redoing.
//
// It matched by prefix only, so `/rem` found `/remind` and `/rmd` found
// nothing — which helped exactly the person who already knew the name, and
// that is the one person who does not need a palette. And two of its commands
// existed only to open a dialog saying they were not built, which takes a
// name, sits in the list, and teaches the owner that the list cannot be
// trusted.

import 'package:flutter_test/flutter_test.dart';

import 'package:dex/widgets/composer/slash_commands.dart';

void main() {
  group('finding a command', () {
    List<String> namesFor(String token) =>
        [for (final c in SlashCommands.matching(token)) c.name];

    test('an exact name comes first', () {
      expect(namesFor('help').first, 'help');
      expect(namesFor('new').first, 'new');
    });

    test('a prefix finds what you were part-way through typing', () {
      expect(namesFor('rem'), contains('remind'));
      expect(namesFor('work'), contains('workflow'));
    });

    test('letters in order find it too, which prefix matching could not', () {
      // The actual complaint: a half-remembered name found nothing at all.
      expect(namesFor('wkf'), contains('workflow'));
      expect(namesFor('hsty'), contains('history'));
    });

    test('an alias answers as well as the name', () {
      expect(namesFor('search'), contains('find'));
    });

    test('a shorter command is not buried under a longer one', () {
      // Both contain the letters of "ne"; `new` is the one that was meant.
      expect(namesFor('new').first, 'new');
    });

    test('nonsense matches nothing rather than everything', () {
      expect(SlashCommands.matching('zzqx'), isEmpty);
    });

    test('an empty token lists everything, for browsing', () {
      expect(SlashCommands.matching('').length, SlashCommands.all.length);
    });
  });

  group('what is in the palette', () {
    test('no command exists only to say it does not work', () {
      // `/vision` and `/voice` both opened a "planned" dialog. One is gone;
      // the other opens the screen that was already there.
      final names = [for (final c in SlashCommands.all) c.name];
      expect(names, isNot(contains('vision')));
      expect(names, contains('voice'));
    });

    test('the ones the owner asked for are there', () {
      final names = [for (final c in SlashCommands.all) c.name];
      for (final wanted in ['find', 'remind', 'workflow', 'history', 'new']) {
        expect(names, contains(wanted), reason: '/$wanted is missing');
      }
    });

    test('every command says what it does', () {
      for (final c in SlashCommands.all) {
        expect(c.description.trim(), isNotEmpty, reason: '/${c.name}');
      }
    });

    test('no two commands answer to the same word', () {
      final seen = <String>{};
      for (final c in SlashCommands.all) {
        for (final key in c.keys) {
          expect(seen.add(key), isTrue,
              reason: '"$key" is claimed by more than one command');
        }
      }
    });
  });

  group('reading a reminder the way a person writes one', () {
    test('a duration from now', () {
      final parsed = SlashCommands.parseReminder('20m stand up');
      expect(parsed, isNotNull);
      expect(parsed!.text, 'stand up');
      final minutes = parsed.at.difference(DateTime.now()).inMinutes;
      expect(minutes, inInclusiveRange(18, 20));
    });

    test('hours and days too', () {
      expect(
        SlashCommands.parseReminder('2h call back')!.at
            .difference(DateTime.now())
            .inMinutes,
        inInclusiveRange(118, 120),
      );
      expect(
        SlashCommands.parseReminder('1d renew the pass')!.at
            .difference(DateTime.now())
            .inHours,
        inInclusiveRange(23, 24),
      );
    });

    test('a clock time', () {
      final parsed = SlashCommands.parseReminder('17:30 leave');
      expect(parsed, isNotNull);
      expect(parsed!.at.hour, 17);
      expect(parsed.at.minute, 30);
      expect(parsed.text, 'leave');
    });

    test('am and pm', () {
      expect(SlashCommands.parseReminder('5pm gym')!.at.hour, 17);
      expect(SlashCommands.parseReminder('12am sleep')!.at.hour, 0);
    });

    test('a time already gone means tomorrow', () {
      // "Remind me at 9" said at ten in the morning is not a reminder for an
      // hour ago.
      final parsed = SlashCommands.parseReminder('00:01 the very start')!;
      expect(parsed.at.isAfter(DateTime.now()), isTrue);
    });

    test('what it cannot read, it refuses', () {
      // Refusing is the point: guessing a time sets a reminder for the wrong
      // moment, which is useless in a way that no reminder is not.
      expect(SlashCommands.parseReminder(''), isNull);
      expect(SlashCommands.parseReminder('sometime soon-ish do the thing'), isNull);
      expect(SlashCommands.parseReminder('25:00 impossible'), isNull);
      expect(SlashCommands.parseReminder('20m'), isNull, reason: 'no text');
      expect(SlashCommands.parseReminder('99z nonsense unit'), isNull);
    });
  });
}
