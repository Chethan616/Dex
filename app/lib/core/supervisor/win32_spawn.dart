/// Starting a child process with no console window, and killing it for certain.
///
/// `Process.start` is not used for any of this, for two reasons.
///
/// First, the window. Node and Python are console-subsystem binaries: run one
/// and Windows gives it a console, and a console is a black rectangle on the
/// owner's desktop. Whether Dart's `detached` mode passes CREATE_NO_WINDOW is
/// an implementation detail nobody promises, and "no terminal ever appears" is
/// not a requirement to leave to an implementation detail. CreateProcessW is
/// the documented way to ask for it, so we ask for it.
///
/// Second, the corpses. Dex has been bitten repeatedly by processes that
/// outlive the thing that started them — at one point seven daemons were
/// serving the same named pipe, answering requests unpredictably, which is a
/// genuinely horrible thing to debug. Cleanup code cannot fix that, because the
/// case it must handle is the one where our cleanup code does not run: a crash,
/// a kill, a power cut. A Job Object with KILL_ON_JOB_CLOSE moves the guarantee
/// into the kernel. When this process dies, by any means, its children die too.
///
/// The elevated daemon is deliberately outside all of this. It is started by
/// the scheduled task at a higher integrity level, we never hold its handle,
/// and we could not put it in our job even if we wanted to. It is supervised by
/// probing the pipe — see supervisor.dart.
///
/// ── on the win32 version ──────────────────────────────────────────────────
///
/// This is the Dex Bar's spawner, ported to `app/` and rewritten against
/// win32 5.x. The Bar pins win32 ^6, where every BOOL is an extension type
/// (`started.value`, `handle.value.address`); this app cannot take win32 6
/// because super_drag_and_drop pulls device_info_plus, which caps it below
/// 6.0.0. So handles are plain ints here and BOOLs are compared against zero.
/// Same calls, same order, same guarantees — just the older binding style.
library;

import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';
import 'package:win32/win32.dart';

/// Offsets into JOBOBJECT_EXTENDED_LIMIT_INFORMATION on x64.
///
/// The win32 package does not bind this struct, so it is written by hand. Only
/// one field is touched: LimitFlags, 16 bytes into the nested
/// BASIC_LIMIT_INFORMATION which starts at offset 0. Everything else stays
/// zeroed, which is what "no limit" means for every other member.
const int _jobExtendedLimitInfoSize = 144;
const int _limitFlagsOffset = 16;
const int _jobObjectLimitKillOnJobClose = 0x2000;

/// JOBOBJECTINFOCLASS.JobObjectExtendedLimitInformation. Spelled as a literal
/// because win32 5.x keeps the constant in `constants_nodoc.dart`, which the
/// package's public library does not re-export.
const int _jobObjectExtendedLimitInformation = 9;

/// `ResumeThread` is not bound by win32 5.x, so it is looked up by hand.
final int Function(int hThread) _resumeThread = DynamicLibrary.open('kernel32.dll')
    .lookupFunction<Uint32 Function(IntPtr), int Function(int)>('ResumeThread');

/// A child we started and can still account for.
class SpawnedProcess {
  SpawnedProcess._(this.pid, this._process, this.label);

  final int pid;
  final String label;
  final int _process;
  bool _closed = false;

  /// Whether the process is still running.
  ///
  /// Asks the kernel rather than trusting a flag we set earlier. The child can
  /// exit on its own at any moment, and a supervisor that believes its own
  /// bookkeeping over the OS reports health that is not there.
  bool get isAlive {
    if (_closed) return false;
    return using((arena) {
      final code = arena<Uint32>();
      if (GetExitCodeProcess(_process, code) == 0) return false;
      return code.value == STILL_ACTIVE;
    });
  }

  /// Exit code, or null while it is still running.
  int? get exitCode {
    if (_closed) return null;
    return using((arena) {
      final code = arena<Uint32>();
      if (GetExitCodeProcess(_process, code) == 0) return null;
      final value = code.value;
      return value == STILL_ACTIVE ? null : value;
    });
  }

  /// Stop it now.
  ///
  /// Blunt on purpose. These are servers with no shutdown protocol worth
  /// waiting on; their state lives in SQLite and on disk, not in memory. The
  /// job object would take them anyway when the app closes — this is for
  /// restarting one agent without restarting everything.
  void terminate() {
    if (_closed) return;
    TerminateProcess(_process, 1);
    _release();
  }

  /// Give up the handle without killing the process.
  void detach() => _release();

  void _release() {
    if (_closed) return;
    _closed = true;
    CloseHandle(_process);
  }
}

/// Thrown when CreateProcessW itself fails — the binary is missing, the path is
/// wrong, the machine is out of handles.
class SpawnFailure implements Exception {
  SpawnFailure(this.executable, this.errorCode, this.message);

  final String executable;
  final int errorCode;
  final String message;

  @override
  String toString() => 'Could not start $executable: $message ($errorCode)';
}

/// The job every child is born into.
///
/// One per app process, created lazily. If the job cannot be created — an
/// unusual sandbox, an outer job that forbids nesting — children still start,
/// unparented, and [jobActive] goes false so the UI can say so honestly rather
/// than implying a cleanup guarantee that is not there.
class ProcessJob {
  ProcessJob._();

  static final ProcessJob instance = ProcessJob._();

  int? _job;
  bool _attempted = false;
  bool _usable = false;

  /// Whether children are actually tracked by a kill-on-close job.
  bool get jobActive => _usable;

  int? _ensureJob() {
    if (_attempted) return _usable ? _job : null;
    _attempted = true;

    final created = CreateJobObject(nullptr, nullptr);
    if (created == 0) return null;

    final configured = using((arena) {
      final info = arena<Uint8>(_jobExtendedLimitInfoSize);
      (info + _limitFlagsOffset).cast<Uint32>().value =
          _jobObjectLimitKillOnJobClose;
      return SetInformationJobObject(
            created,
            _jobObjectExtendedLimitInformation,
            info,
            _jobExtendedLimitInfoSize,
          ) !=
          0;
    });

    if (!configured) {
      // A job that does not kill on close is worse than no job: it looks like a
      // guarantee and is not one.
      CloseHandle(created);
      return null;
    }

    _job = created;
    _usable = true;
    return _job;
  }

  /// Start [executable] with [arguments] and no console window.
  ///
  /// The child is created suspended, assigned to the job, and only then
  /// resumed. The order matters: assigning after resuming leaves a window in
  /// which a fast-starting child can spawn grandchildren outside the job, and
  /// those are exactly the orphans this exists to prevent.
  SpawnedProcess spawn({
    required String executable,
    List<String> arguments = const [],
    String? workingDirectory,
    Map<String, String> environment = const {},
    String? label,
  }) {
    return using((arena) {
      final startupInfo = arena<STARTUPINFO>();
      startupInfo.ref.cb = sizeOf<STARTUPINFO>();

      final processInfo = arena<PROCESS_INFORMATION>();

      final commandLine =
          buildCommandLine(executable, arguments).toNativeUtf16(allocator: arena);
      final appName = executable.toNativeUtf16(allocator: arena);
      final cwd = workingDirectory?.toNativeUtf16(allocator: arena);
      final envBlock = _environmentBlock(environment, arena);

      final started = CreateProcess(
        appName,
        commandLine,
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
        envBlock,
        cwd ?? nullptr,
        startupInfo,
        processInfo,
      );

      if (started == 0) {
        final code = GetLastError();
        throw SpawnFailure(executable, code, _describeSpawnError(code));
      }

      final job = _ensureJob();
      if (job != null) {
        AssignProcessToJobObject(job, processInfo.ref.hProcess);
      }

      _resumeThread(processInfo.ref.hThread);
      CloseHandle(processInfo.ref.hThread);

      return SpawnedProcess._(
        processInfo.ref.dwProcessId,
        processInfo.ref.hProcess,
        label ?? executable,
      );
    });
  }
}

/// Windows has no argv. It hands the child one string and every program parses
/// it again, so quoting is the caller's problem.
///
/// These are CommandLineToArgvW's rules run backwards: a run of backslashes is
/// only special immediately before a quote, where it is doubled; everywhere
/// else it is literal. Every path on this machine is full of backslashes and
/// some end in one, so the trailing case is not hypothetical.
String quoteArgument(String argument) {
  const backslash = 0x5C;
  const quote = 0x22;
  const space = 0x20;
  const tab = 0x09;

  if (argument.isNotEmpty &&
      !argument.codeUnits.any(
        (u) => u == space || u == tab || u == quote,
      )) {
    return argument;
  }

  final out = StringBuffer('"');
  var pending = 0;

  for (final unit in argument.codeUnits) {
    if (unit == backslash) {
      pending += 1;
      continue;
    }
    if (unit == quote) {
      // Every backslash immediately before a quote is doubled, then the quote
      // itself is escaped.
      out.write(r'\' * (pending * 2 + 1));
      out.writeCharCode(quote);
      pending = 0;
      continue;
    }
    out.write(r'\' * pending);
    pending = 0;
    out.writeCharCode(unit);
  }

  // Trailing backslashes are followed by the closing quote, so they double too.
  out.write(r'\' * (pending * 2));
  out.write('"');
  return out.toString();
}

/// The full command line, argv[0] included — the child parses this string, not
/// the lpApplicationName we also pass.
String buildCommandLine(String executable, List<String> arguments) =>
    [executable, ...arguments].map(quoteArgument).join(' ');

/// Merge [overrides] over [base] the way Windows would: names are compared
/// case-insensitively, so setting "path" must replace an inherited "Path"
/// rather than sitting beside it. A child that inherits both finds nothing.
Map<String, String> mergeEnvironment(
  Map<String, String> base,
  Map<String, String> overrides,
) {
  final merged = <String, String>{};
  final canonical = <String, String>{};

  for (final entry in base.entries) {
    if (entry.key.isEmpty) continue;
    canonical[entry.key.toUpperCase()] = entry.key;
    merged[entry.key] = entry.value;
  }

  for (final entry in overrides.entries) {
    if (entry.key.isEmpty) continue;
    final existing = canonical[entry.key.toUpperCase()];
    merged[existing ?? entry.key] = entry.value;
  }

  return merged;
}

/// The environment as CreateProcessW wants it: `KEY=VALUE`, one NUL between
/// entries, two NULs at the end, sorted case-insensitively.
///
/// Built rather than inherited because Dart cannot set a variable in its own
/// process, and the core has to be told `DEX_HEADLESS=true`. Sorting is
/// documented as expected; Windows tolerates an unsorted block today, but
/// matching the contract costs one line.
String environmentBlockString(Map<String, String> environment) {
  final names = environment.keys.toList()
    ..sort((a, b) => a.toUpperCase().compareTo(b.toUpperCase()));

  final buffer = StringBuffer();
  for (final name in names) {
    // Names beginning with '=' are the per-drive cwd pseudo-variables Windows
    // keeps in every environment. They are inherited normally; an empty name
    // is what would be invalid, and mergeEnvironment already dropped those.
    buffer
      ..write(name)
      ..write('=')
      ..write(environment[name])
      ..writeCharCode(0);
  }
  buffer.writeCharCode(0);
  return buffer.toString();
}

Pointer<Utf16> _environmentBlock(Map<String, String> overrides, Arena arena) {
  final merged = mergeEnvironment(Platform.environment, overrides);
  final block = environmentBlockString(merged);

  // toNativeUtf16 stops at nothing and appends its own NUL, but it measures
  // with String.length, so embedded NULs survive the copy. The extra
  // terminator it adds lands after ours, which is harmless.
  final buffer = arena<Uint16>(block.length + 1);
  final units = buffer.asTypedList(block.length + 1);
  units.setAll(0, block.codeUnits);
  units[block.length] = 0;
  return buffer.cast<Utf16>();
}

String _describeSpawnError(int code) => switch (code) {
      2 => 'the file was not found',
      3 => 'the path was not found',
      5 => 'access was denied',
      8 => 'not enough memory to start it',
      193 => 'not a valid application for this architecture',
      // Some Windows/Wine combinations do not preserve the thread-local
      // error while the win32 FFI result is being materialised. Keep the
      // fallback useful to a person instead of surfacing an opaque "(0)".
      _ => 'the file was not found or CreateProcessW failed',
    };
