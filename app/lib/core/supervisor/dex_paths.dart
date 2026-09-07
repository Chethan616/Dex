import 'dart:io';

/// Where everything lives.
///
/// Two very different layouts have to work from one binary:
///
///   development   …/DEXV3/app/build/windows/x64/runner/Debug/dex.exe
///                 with the repo six directories above it
///
///   installed     C:/Program Files/Dex/Dex.exe
///                 with core/, agents/, daemon/ beside it
///
/// Rather than encode either, we look upward from the executable for the file
/// that only the Dex tree has — `daemon/DexDaemon.py` — and take the directory
/// containing it. `DEX_HOME` overrides everything, which is what a developer
/// running the app from a random build directory needs.
class DexPaths {
  DexPaths._(this.root);

  final Directory root;

  static DexPaths? _resolved;

  /// Null when the tree cannot be found — a broken install, or the exe copied
  /// somewhere on its own. The splash reports that rather than starting
  /// processes with paths that do not exist.
  static DexPaths? locate({String? startFrom, Map<String, String>? env}) {
    if (_resolved != null) return _resolved;
    final found = _search(startFrom: startFrom, env: env);
    if (found != null) _resolved = DexPaths._(found);
    return _resolved;
  }

  static Directory? _search({String? startFrom, Map<String, String>? env}) {
    final environment = env ?? Platform.environment;

    final override = environment['DEX_HOME'];
    if (override != null && override.isNotEmpty) {
      final dir = Directory(override);
      if (_isDexRoot(dir)) return dir;
    }

    var dir = Directory(
      startFrom ?? File(Platform.resolvedExecutable).parent.path,
    );

    // Ten is generous for the deepest layout above (six) and still terminates
    // on a machine where the exe sits at the root of a drive.
    for (var i = 0; i < 10; i++) {
      if (_isDexRoot(dir)) return dir;
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
    return null;
  }

  static bool _isDexRoot(Directory dir) =>
      File('${dir.path}${Platform.pathSeparator}daemon'
              '${Platform.pathSeparator}DexDaemon.py')
          .existsSync();

  String join(List<String> parts) =>
      [root.path, ...parts].join(Platform.pathSeparator);

  /// `%LOCALAPPDATA%\DEX` — logs, the handshake file, the telemetry database.
  static Directory get stateDir {
    final base = Platform.environment['LOCALAPPDATA'] ??
        Platform.environment['USERPROFILE'] ??
        Directory.systemTemp.path;
    return Directory('$base${Platform.pathSeparator}DEX');
  }

  static File get handshakeFile =>
      File('${stateDir.path}${Platform.pathSeparator}ui.json');

  static File logFile(String name) =>
      File('${stateDir.path}${Platform.pathSeparator}$name.log');

  /// Resolve an executable through PATH, the way the shell would.
  ///
  /// `where.exe` is not used: it is a console program, and shelling out to one
  /// during startup is exactly the flash of black window this whole design
  /// exists to avoid.
  static String? which(String command, {Map<String, String>? env}) {
    final environment = env ?? Platform.environment;
    final candidates = _whichCandidates(command, environment);
    return candidates.isEmpty ? null : candidates.first;
  }

  static List<String> _whichCandidates(
    String command,
    Map<String, String> environment,
  ) {
    final pathValue = environment['PATH'] ?? environment['Path'] ?? '';
    final extensions = (environment['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .where((e) => e.isNotEmpty)
        .toList();
    final candidates = <String>[];

    final hasExtension = command.contains('.');

    for (final dir in pathValue.split(';')) {
      if (dir.isEmpty) continue;
      final base = '$dir${Platform.pathSeparator}$command';
      if (hasExtension && File(base).existsSync()) candidates.add(base);
      for (final ext in extensions) {
        final candidate = '$base${ext.toLowerCase()}';
        if (File(candidate).existsSync()) candidates.add(candidate);
      }
    }
    return candidates;
  }

  /// Python Manager installs launcher shims as `python.exe` and `pythonw.exe`.
  /// They are useful from an interactive shell, but CreateProcess cannot rely
  /// on them when the manager cannot resolve a runtime. Prefer a concrete
  /// Python installation instead.
  static bool _isPythonLauncherShim(String path) {
    final normalized = path.replaceAll('\\', '/').toLowerCase();
    return normalized.contains('/pymanager/') ||
        normalized.contains('/windowsapps/');
  }

  static Iterable<String> _installedPythonCandidates(
    String command,
    Map<String, String> environment,
  ) sync* {
    final localAppData = environment['LOCALAPPDATA'];
    final roots = <String?>[
      if (localAppData != null && localAppData.isNotEmpty)
        '$localAppData${Platform.pathSeparator}Programs${Platform.pathSeparator}Python',
      environment['ProgramW6432'],
      environment['ProgramFiles'],
      environment['ProgramFiles(x86)'],
    ];

    for (final root in roots) {
      if (root == null || root.isEmpty) continue;
      final directory = Directory(root);
      if (!directory.existsSync()) continue;
      try {
        for (final entry in directory.listSync(followLinks: false)) {
          if (entry is! Directory ||
              !entry.path.toLowerCase().contains('python')) {
            continue;
          }
          final candidate =
              '${entry.path}${Platform.pathSeparator}$command.exe';
          if (File(candidate).existsSync()) yield candidate;
        }
      } catch (_) {
        // A protected install directory is not a reason to hide other options.
      }
    }
  }

  /// The windowless Python.
  ///
  /// `pythonw.exe` is the GUI-subsystem build: it has no console at all, so it
  /// cannot flash one even for an instant. It sits beside `python.exe` in every
  /// standard install. Falling back to `python.exe` is acceptable because we
  /// spawn with CREATE_NO_WINDOW anyway — pythonw is belt and braces, not the
  /// only defence.
  ///
  /// Note that under pythonw `sys.stdout` and `sys.stderr` are both None, which
  /// is why every Dex Python entry point guards its logging handlers. A daemon
  /// that dies on `logging.StreamHandler(None)` with no console to print the
  /// traceback is a genuinely awful thing to diagnose.
  static String? pythonExecutable({Map<String, String>? env}) {
    final environment = env ?? Platform.environment;
    final candidates = <String>[
      ..._whichCandidates('pythonw', environment),
      ..._whichCandidates('python', environment),
      ..._installedPythonCandidates('pythonw', environment),
      ..._installedPythonCandidates('python', environment),
    ];

    final seen = <String>{};
    for (final candidate in candidates) {
      if (!seen.add(candidate.toLowerCase())) continue;
      if (!_isPythonLauncherShim(candidate)) return candidate;
    }
    return null;
  }

  static String? nodeExecutable({Map<String, String>? env}) =>
      which('node', env: env);

  bool get hasNodeModules =>
      Directory(join(['node_modules'])).existsSync();

  /// Where the app and the core both keep configuration.
  ///
  /// There is deliberately no .env accessor here. The previous UI copy of this
  /// file had three, and the supervisor used them to create a .env on first run;
  /// this app's config is settings.json and its secrets are in the Windows
  /// credential store. See the note in supervisor.dart's preflight.
  static File get settingsFile =>
      File('${stateDir.path}${Platform.pathSeparator}settings.json');
}
