@TestOn('windows')
library;

import 'dart:ffi';
import 'dart:io';

import 'package:dex_bar/core/supervisor/win32_spawn.dart';
import 'package:ffi/ffi.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:win32/win32.dart';

/// The spawner carries two promises, and both are the kind that quietly stop
/// being true. These tests check them against the operating system rather than
/// against our own bookkeeping.
///
///   1. No console window. The owner's requirement, stated plainly: opening Dex
///      must not put a black rectangle on the desktop. Node and Python are
///      console-subsystem binaries, so this is not free.
///   2. Children die with the parent. Dex has had seven daemons alive at once
///      on the same named pipe. A Job Object moves that guarantee into the
///      kernel, where it survives our crashing.
///
/// The window test enumerates every top-level window on the desktop and asks
/// which process owns it. That is what "a window appeared" actually means, and
/// it is the only check that would have caught the original bug — the daemon
/// ran perfectly and simply had a console nobody wanted.

/// Every *visible* top-level window belonging to [pid].
///
/// Visibility matters: CREATE_NO_WINDOW gives a console process a console that
/// is never shown, so a hidden window is a pass and a shown one is the failure.
List<int> visibleWindowsOf(int pid) {
  final found = <int>[];

  late final NativeCallable<WNDENUMPROC> callback;
  callback = NativeCallable<WNDENUMPROC>.isolateLocal((
    Pointer hwnd,
    int lparam,
  ) {
    using((arena) {
      final owner = arena<Uint32>();
      GetWindowThreadProcessId(HWND(hwnd), owner);
      if (owner.value == pid && IsWindowVisible(HWND(hwnd))) {
        found.add(hwnd.address);
      }
    });
    return TRUE;
  }, exceptionalReturn: 0);

  EnumWindows(callback.nativeFunction, const LPARAM(0));
  callback.close();
  return found;
}

void main() {
  final comspec =
      Platform.environment['COMSPEC'] ?? r'C:\Windows\System32\cmd.exe';

  group('command line quoting', () {
    // Windows hands the child one string and every runtime parses it again, so
    // these are CommandLineToArgvW's rules, which are not the obvious ones.
    test('leaves ordinary arguments alone', () {
      expect(quoteArgument('--headless'), '--headless');
      expect(quoteArgument(r'C:\dex\main.py'), r'C:\dex\main.py');
    });

    test('quotes anything containing a space', () {
      expect(
        quoteArgument(r'C:\Program Files\node.exe'),
        r'"C:\Program Files\node.exe"',
      );
    });

    test('doubles a trailing backslash run inside quotes', () {
      // The failure this prevents: the final backslash escapes the closing
      // quote, the argument runs on, and the next one is swallowed. Every path
      // on this machine is full of backslashes and OneDrive folders have
      // spaces, so both halves fire at once.
      expect(quoteArgument(r'C:\Some Path\'), r'"C:\Some Path\\"');
    });

    test('escapes embedded quotes and the run before them', () {
      expect(quoteArgument(r'a\"b'), r'"a\\\"b"');
    });

    test('quotes the empty argument, which would otherwise vanish', () {
      expect(quoteArgument(''), '""');
    });

    test('argv[0] leads the command line', () {
      expect(
        buildCommandLine(r'C:\Program Files\node.exe', ['-v']),
        r'"C:\Program Files\node.exe" -v',
      );
    });
  });

  group('environment block', () {
    test('overrides replace inherited names case-insensitively', () {
      // A child that inherits both "Path" and "PATH" finds nothing.
      final merged = mergeEnvironment(
        {'Path': r'C:\one', 'HOME': 'x'},
        {'PATH': r'C:\two'},
      );
      expect(merged.length, 2);
      expect(merged['Path'], r'C:\two');
      expect(merged.containsKey('PATH'), isFalse);
    });

    test('is NUL separated and double-NUL terminated, sorted', () {
      final block = environmentBlockString({'B': '2', 'a': '1'});
      expect(block, 'a=1\x00B=2\x00\x00');
    });

    test('drops empty names rather than emitting an invalid entry', () {
      expect(mergeEnvironment({'': 'x', 'A': '1'}, const {}).keys, ['A']);
    });
  });

  group('spawning', () {
    test('starts a console program with no visible window', () async {
      // cmd.exe is console-subsystem and would normally show a window
      // immediately. It sits there for two seconds so there is a real window to
      // find if CREATE_NO_WINDOW were not doing its job.
      final child = ProcessJob.instance.spawn(
        executable: comspec,
        arguments: ['/c', 'ping -n 3 127.0.0.1'],
        label: 'window probe',
      );
      addTearDown(child.terminate);

      expect(child.pid, greaterThan(0));
      expect(child.isAlive, isTrue);

      // Give it longer than any window would need to appear, and check
      // repeatedly rather than once — a window that flashes and closes is still
      // a window the owner saw.
      for (var i = 0; i < 12; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
        expect(
          visibleWindowsOf(child.pid),
          isEmpty,
          reason: 'a console window appeared for pid ${child.pid} — this is '
              'the one thing the spawner exists to prevent',
        );
      }
    });

    test('reports the exit code and stops being alive', () async {
      final child = ProcessJob.instance.spawn(
        executable: comspec,
        arguments: ['/c', 'exit 7'],
        label: 'exit code',
      );

      for (var i = 0; i < 50 && child.isAlive; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }

      expect(child.isAlive, isFalse);
      expect(child.exitCode, 7);
    });

    test('terminate actually kills it', () async {
      final child = ProcessJob.instance.spawn(
        executable: comspec,
        arguments: ['/c', 'ping -n 60 127.0.0.1'],
        label: 'terminate',
      );

      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(child.isAlive, isTrue);

      child.terminate();
      expect(child.isAlive, isFalse);
    });

    test('the environment reaches the child', () async {
      // Proved by observable effect rather than by reading a variable back:
      // the child writes a file whose path it can only know from the
      // environment we handed it.
      final marker = File(
        '${Directory.systemTemp.path}\\dex_env_${DateTime.now().microsecondsSinceEpoch}.txt',
      );
      addTearDown(() {
        if (marker.existsSync()) marker.deleteSync();
      });

      // One argument per element, never a single pre-joined string. cmd.exe
      // applies its own quoting rules to everything after /c, and handing it a
      // quoted blob makes it see the escapes literally. Discovered here, fixed
      // in Supervisor._npmInstall, which had the same shape.
      final child = ProcessJob.instance.spawn(
        executable: comspec,
        arguments: ['/c', 'echo', '%DEX_TEST_MARKER%', '>', marker.path],
        environment: {'DEX_TEST_MARKER': 'reached'},
        label: 'environment',
      );
      addTearDown(child.terminate);

      for (var i = 0; i < 50 && !marker.existsSync(); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }

      expect(marker.existsSync(), isTrue,
          reason: 'the child never ran');
      expect(marker.readAsStringSync().trim(), 'reached');
    });

    test('children are owned by a kill-on-close job', () {
      // The guarantee itself cannot be tested from inside the process that
      // holds the job — proving it requires this process to die. What is
      // checkable here is that the job was created and configured; if
      // SetInformationJobObject had failed, spawn() would have thrown the job
      // away rather than keep one that does not kill on close.
      ProcessJob.instance
          .spawn(executable: comspec, arguments: ['/c', 'exit 0'])
          .detach();

      expect(
        ProcessJob.instance.jobActive,
        isTrue,
        reason: 'without the job, closing Dex leaves the daemon and agents '
            'running — the orphan problem this was built to end',
      );
    });

    test('a missing executable fails with something a person can read', () {
      expect(
        () => ProcessJob.instance.spawn(
          executable: r'C:\definitely\not\here.exe',
        ),
        throwsA(
          isA<SpawnFailure>().having(
            (e) => e.message,
            'message',
            contains('not found'),
          ),
        ),
      );
    });
  });
}
