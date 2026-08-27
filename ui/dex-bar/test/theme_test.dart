import 'package:dex_bar/theme/tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The check that was missing.
///
/// The light palette shipped for three slices with `textFaint` at **2.6:1**
/// against the background — used on 10px labels in the Library panel and the
/// plan DAG, well under the 4.5:1 floor. Nothing caught it because nothing
/// measured it; it was picked by eye, and by eye on a bright monitor it looked
/// fine.
///
/// A palette is not a matter of taste at this end of the scale, so it is
/// asserted rather than reviewed.
void main() {
  const floor = 4.5;

  group('contrast', () {
    for (final entry in {'dark': DexPalette.dark, 'light': DexPalette.light}.entries) {
      final name = entry.key;
      final palette = entry.value;

      test('$name: every foreground clears $floor:1 on every surface', () {
        final failures = <String>[];

        palette.foregrounds.forEach((token, colour) {
          for (final surface in palette.surfaces) {
            final ratio = contrastRatio(colour, surface);
            if (ratio < floor) {
              failures.add(
                '$token on ${_hex(surface)} = ${ratio.toStringAsFixed(2)}:1',
              );
            }
          }
        });

        expect(failures, isEmpty, reason: failures.join('\n'));
      });

      test('$name: state tones sit in one contrast band', () {
        // Not an aesthetic rule. The old palette spanned 7.6:1 to 10.9:1, so a
        // `selecting` step read as louder than an `executing` one when they
        // carry the same weight of meaning — the stream looked like a warning
        // wherever amber happened to land.
        final tones = [
          palette.info,
          palette.warn,
          palette.attention,
          palette.positive,
          palette.negative,
        ];
        final ratios = tones
            .map((c) => contrastRatio(c, palette.surfaceRaised))
            .toList()
          ..sort();

        expect(
          ratios.last - ratios.first,
          lessThan(1.5),
          reason: 'spread was ${(ratios.last - ratios.first).toStringAsFixed(2)} '
              'across ${ratios.map((r) => r.toStringAsFixed(1)).join(', ')}',
        );
      });
    }

    test('the documented ratios are real', () {
      // Spot-checks the two values the comments in palette.dart claim, so a
      // future edit cannot leave the annotation behind.
      expect(
        contrastRatio(DexPalette.light.textFaint, DexPalette.light.bg),
        greaterThan(floor),
      );
      expect(
        contrastRatio(DexPalette.dark.textFaint, DexPalette.dark.surfaceRaised),
        greaterThan(floor),
      );
    });
  });

  group('the ramp', () {
    test('is exactly nine roles', () {
      expect(DexType.roles.keys, hasLength(9));
      expect(
        DexType.roles.keys,
        containsAll(<String>[
          'display', 'title', 'prompt', 'body',
          'label', 'caption', 'code', 'codeSm', 'tag',
        ]),
      );
    });

    test('every role names a bundled family and a real weight axis', () {
      for (final entry in DexType.roles.entries) {
        final style = entry.value();
        expect(
          style.fontFamily,
          anyOf(DexType.sansFamily, DexType.monoFamily),
          reason: '${entry.key} must use a bundled face, not a system fallback',
        );
        expect(
          style.fontVariations,
          isNotEmpty,
          reason: '${entry.key} must instance the wght axis rather than let '
              'the renderer synthesise a bold',
        );
        expect(style.height, isNotNull, reason: '${entry.key} must set leading');
      }
    });

    test('sizes are distinct enough to read as a scale', () {
      final sizes = DexType.roles.values.map((f) => f().fontSize!).toSet();
      // Nine roles, at least seven distinct sizes: `caption` and `codeSm` share
      // 11 deliberately (same optical size, different face and job).
      expect(sizes.length, greaterThanOrEqualTo(7));
      expect(sizes.reduce((a, b) => a < b ? a : b), greaterThanOrEqualTo(10));
    });

    test('machine output uses tabular figures', () {
      // A countdown or an elapsed clock in proportional digits reflows on every
      // tick, which reads as the panel twitching rather than as time passing.
      for (final role in ['code', 'codeSm', 'tag', 'display']) {
        expect(
          DexType.roles[role]!().fontFeatures,
          isNotEmpty,
          reason: '$role carries numbers that change in place',
        );
      }
    });
  });

  group('event tones', () {
    const tokens = DexTokens.dark;

    test('ten event types resolve onto six tones', () {
      const types = [
        'thinking', 'routing', 'planning', 'executing', 'selecting',
        'retrying', 'awaiting', 'cancelled', 'done', 'failed',
      ];
      final tones = types.map(tokens.eventColor).toSet();
      expect(tones, hasLength(6));
    });

    test('done and failed are never the same colour', () {
      expect(tokens.eventColor('done'), isNot(tokens.eventColor('failed')));
    });

    test('an unknown event type still resolves', () {
      expect(tokens.eventColor('something-new'), tokens.neutral);
    });

    test('every confirmation tier has its own tone', () {
      final tiers = [1, 2, 3, 4].map(tokens.tierColor).toSet();
      expect(tiers, hasLength(4),
          reason: 'Tier 2 and Tier 3 mean different things and must not look '
              'alike — that was the original defect');
    });
  });

  test('both themes register the extension', () {
    for (final brightness in Brightness.values) {
      expect(buildDexTheme(brightness).extension<DexTokens>(), isNotNull);
    }
  });
}

String _hex(Color c) =>
    '#${((c.r * 255).round() << 16 | (c.g * 255).round() << 8 | (c.b * 255).round()).toRadixString(16).padLeft(6, '0')}';
