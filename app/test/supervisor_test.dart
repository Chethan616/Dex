// The boot sequence, and the parts of it that are testable without spawning.
//
// This exists because the failure it guards against had no symptom until the
// app was already open: `app/` had no supervisor at all — the one that starts
// the core lived in `ui/dex-bar`, a different application — so launching Dex on
// its own started nothing and showed "core not running" with no way to fix it
// from inside. Nothing failed; nothing had been asked to happen.
//
// The spawning itself needs real processes and is covered by actually running
// the app. What is pinned here is everything around it that can silently go
// wrong and produce a process that starts and then does nothing useful: the
// command line Windows will re-parse, the environment block the core reads
// DEX_HEADLESS from, and the state machine the splash renders.

import 'package:flutter_test/flutter_test.dart';

import 'package:dex/core/supervisor/dex_paths.dart';
import 'package:dex/core/supervisor/supervisor.dart';
import 'package:dex/core/supervisor/win32_spawn.dart';

void main() {
  group('command line quoting', () {
    // Windows has no argv: the child is handed one string and parses it again.
    // Every path on this machine is full of backslashes and the repo lives
    // under "OneDrive\Desktop", so this is not a hypothetical.
    test('leaves a plain argument alone', () {
      expect(quoteArgument('src/main.ts'), 'src/main.ts');
    });

    test('quotes a path with a space', () {
      expect(
        quoteArgument(r'C:\Program Files\nodejs\node.exe'),
        r'"C:\Program Files\nodejs\node.exe"',
      );
    });

    test('doubles backslashes only before a quote', () {
      // CommandLineToArgvW's rule, run backwards. A run of backslashes is
      // literal everywhere except immediately before a quote.
      expect(quoteArgument(r'a\b"c'), r'"a\b\"c"');
    });

    test('doubles a trailing backslash, which the closing quote follows', () {
      // Needs a space, or the argument is returned unquoted and the trailing
      // backslash is nobody's problem. `C:\Program Files\` is the real case.
      expect(
        quoteArgument('C:\\Program Files\\'),
        '"C:\\Program Files\\\\"',
      );
    });

    test('an argument with no space or quote is returned untouched', () {
      expect(quoteArgument('C:\\Users\\cheth\\Desktop\\'), 'C:\\Users\\cheth\\Desktop\\');
    });

    test('argv[0] is included, because the child parses this string', () {
      expect(
        buildCommandLine(r'C:\node.exe', ['-r', 'ts-node/register', 'src/main.ts']),
        r'C:\node.exe -r ts-node/register src/main.ts',
      );
    });
  });

  group('environment block', () {
    test('an override replaces a differently-cased inherited name', () {
      // A child that inherits both "Path" and "PATH" finds neither reliably.
      final merged = mergeEnvironment(
        {'Path': r'C:\a', 'HOME': r'C:\Users\me'},
        {'PATH': r'C:\b'},
      );
      expect(merged.keys.where((k) => k.toUpperCase() == 'PATH').length, 1);
      expect(merged['Path'], r'C:\b');
    });

    test('DEX_HEADLESS survives into the block', () {
      // The core reads this to skip startCli, which would otherwise build a
      // readline over a stdin that is already closed and end at once.
      final block = environmentBlockString(
        mergeEnvironment({'A': '1'}, {'DEX_HEADLESS': 'true'}),
      );
      expect(block, contains('DEX_HEADLESS=true'));
      // NUL between entries, two at the end.
      expect(block.endsWith('\u0000\u0000'), isTrue);
    });

    test('entries are sorted case-insensitively, as documented', () {
      final block = environmentBlockString({'zebra': '1', 'Apple': '2'});
      expect(block.indexOf('Apple'), lessThan(block.indexOf('zebra')));
    });
  });

  group('paths', () {
    test('the settings file is the one the core writes', () {
      // Not a .env beside the repo. The supervisor used to create one on first
      // run, which put a second, stale source of truth next to the real one.
      expect(DexPaths.settingsFile.path, endsWith('settings.json'));
      expect(DexPaths.settingsFile.parent.path, DexPaths.stateDir.path);
    });

    test('the handshake file is the one the client reads', () {
      expect(DexPaths.handshakeFile.path, endsWith('ui.json'));
    });
  });

  group('boot state', () {
    test('starts pending and is not ready', () {
      final supervisor = Supervisor();
      expect(supervisor.steps.every((s) => s.status == BootStatus.pending), isTrue);
      expect(supervisor.ready, isFalse);
    });

    test('the core and the daemon are required; the agents are not', () {
      final supervisor = Supervisor();
      expect(supervisor.step('core').optional, isFalse);
      expect(supervisor.step('daemon').optional, isFalse);
      // Dex is useful without either of these, and they are heavy.
      expect(supervisor.step('browser').optional, isTrue);
      expect(supervisor.step('desktop').optional, isTrue);
    });

    test('a skipped optional step does not block readiness', () {
      final supervisor = Supervisor();
      for (final step in supervisor.steps) {
        step.finish(step.optional ? BootStatus.skipped : BootStatus.done);
      }
      expect(supervisor.ready, isTrue);
    });

    test('a failed required step does block it', () {
      final supervisor = Supervisor();
      for (final step in supervisor.steps) {
        step.finish(BootStatus.done);
      }
      supervisor.step('core').finish(BootStatus.failed, detail: 'it exited');
      expect(supervisor.ready, isFalse);
    });

    test('the last one constructed is the one leaf widgets reach', () {
      final supervisor = Supervisor();
      expect(Supervisor.current, same(supervisor));
    });
  });
}
