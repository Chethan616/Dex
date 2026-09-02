import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'dex_paths.dart';
import 'health.dart';
import 'win32_spawn.dart';

/// How a boot step is going.
enum BootStatus { pending, running, done, skipped, failed }

/// One line on the splash screen.
///
/// It carries its own narration because the splash should say what is
/// happening, not show a bar that means nothing. Each of these corresponds to
/// a real process starting and a real probe answering.
class BootStep {
  BootStep({
    required this.id,
    required this.title,
    required this.runningLabel,
    required this.doneLabel,
    this.optional = false,
  });

  final String id;
  final String title;
  final String runningLabel;
  final String doneLabel;

  /// Optional steps report Skipped rather than Failed when they are turned off
  /// or cannot start. The browser and vision agents are heavy and not everyone
  /// wants them; Dex is useful without either.
  final bool optional;

  BootStatus status = BootStatus.pending;

  /// Why it failed, or what it found — shown under the row.
  String? detail;

  /// Set when a warm start found it already up, so the splash can say
  /// "already running" instead of implying it did the work.
  bool wasAlreadyUp = false;

  Duration? elapsed;
  DateTime? _startedAt;

  void begin() {
    status = BootStatus.running;
    _startedAt = DateTime.now();
    detail = null;
  }

  void finish(BootStatus outcome, {String? detail}) {
    status = outcome;
    this.detail = detail;
    if (_startedAt != null) elapsed = DateTime.now().difference(_startedAt!);
  }
}

/// What the app needs running, and how to get it there.
///
/// This replaces `scripts/run-dev.ps1` as the entry point: same processes, same
/// order, same environment, but driven from inside the app so there is nothing
/// to double-click first and no console to appear. run-dev.ps1 stays for
/// developers who want the `dex>` prompt.
class Supervisor extends ChangeNotifier {
  Supervisor({this.startBrowserAgent = true, this.startDesktopAgent = true}) {
    current = this;
  }

  /// The one running in this app.
  ///
  /// A single-instance holder for the same reason DexGatewayClient has one:
  /// leaf widgets — the /restart command, the Connectors page — need to reach
  /// it without threading it through every constructor in between, and a
  /// second supervisor would be a bug rather than a configuration.
  static Supervisor? current;

  /// Turned off from Settings. Both agents are optional; the core, the daemon
  /// and the app agent are not.
  bool startBrowserAgent;
  bool startDesktopAgent;

  static const String daemonPipeName = 'dex_privileged_daemon';

  static const int desktopAgentPort = 8765;
  static const int browserAgentPort = 8766;
  static const int appAgentPort = 8767;

  final List<BootStep> steps = [
    BootStep(
      id: 'preflight',
      title: 'Checking the machine',
      runningLabel: 'Looking for Node, Python and the Dex tree',
      doneLabel: 'Everything Dex needs is here',
    ),
    BootStep(
      id: 'daemon',
      title: 'Privileged daemon',
      runningLabel: 'Waking the daemon that talks to Windows',
      doneLabel: 'Daemon listening',
    ),
    BootStep(
      id: 'app',
      title: 'App agent',
      runningLabel: 'Starting UI Automation — driving apps without screenshots',
      doneLabel: 'App agent ready',
    ),
    BootStep(
      id: 'desktop',
      title: 'Vision agent',
      runningLabel: 'Starting the screen-reading agent',
      doneLabel: 'Vision agent ready',
      optional: true,
    ),
    BootStep(
      id: 'browser',
      title: 'Browser agent',
      runningLabel: 'Starting the agent that uses the web',
      doneLabel: 'Browser agent ready',
      optional: true,
    ),
    BootStep(
      id: 'core',
      title: 'Dex core',
      runningLabel: 'Starting planning, verification and memory',
      doneLabel: 'Dex is thinking',
    ),
  ];

  final Map<String, SpawnedProcess> _children = {};

  DexPaths? paths;
  String? _node;
  String? _python;

  bool _booting = false;
  bool get booting => _booting;

  /// True once every non-optional step is done. The app opens either way — a
  /// degraded Dex that says what is broken beats a splash screen that hangs.
  bool get ready => steps
      .where((s) => !s.optional)
      .every((s) => s.status == BootStatus.done);

  /// Whether the kernel is enforcing that children die with us.
  bool get childrenAreOwned => ProcessJob.instance.jobActive;

  BootStep step(String id) => steps.firstWhere((s) => s.id == id);

  /// Run the whole sequence. Safe to call again; it re-probes rather than
  /// starting second copies.
  Future<void> boot() async {
    if (_booting) return;
    _booting = true;
    notifyListeners();

    try {
      if (!await _runPreflight()) return;
      await _runStep('daemon', _startDaemon);
      await _runStep('app', _startAppAgent);
      await _runStep('desktop', _startDesktopAgent);
      await _runStep('browser', _startBrowserAgent);
      await _runStep('core', _startCore);
    } finally {
      _booting = false;
      notifyListeners();
    }
  }

  /// Re-run one step after a failure, without restarting everything.
  Future<void> retry(String id) async {
    final target = step(id);
    target.status = BootStatus.pending;
    notifyListeners();

    if (id == 'preflight') {
      await _runPreflight();
      return;
    }
    if (paths == null && !await _runPreflight()) return;

    await _runStep(id, switch (id) {
      'daemon' => _startDaemon,
      'app' => _startAppAgent,
      'desktop' => _startDesktopAgent,
      'browser' => _startBrowserAgent,
      'core' => _startCore,
      _ => () async => HealthReport.down('unknown step'),
    });
  }

  /// Stop one agent and start it again — the restart button on the Agents page.
  Future<void> restart(String id) async {
    _children.remove(id)?.terminate();
    await retry(id);
  }

  /// Kill everything we started.
  ///
  /// The job object makes this redundant when the app exits normally, and
  /// that redundancy is the point: this is the tidy path, the job is the one
  /// that survives a crash. The elevated daemon is not ours to stop — it
  /// belongs to the scheduled task, and stopping it needs the elevation we
  /// deliberately do not have.
  void stopAll() {
    for (final child in _children.values) {
      child.terminate();
    }
    _children.clear();
    notifyListeners();
  }

  Future<void> _runStep(
    String id,
    Future<HealthReport> Function() start,
  ) async {
    final target = step(id);
    target.begin();
    notifyListeners();

    try {
      final report = await start();
      if (report.up) {
        target.finish(BootStatus.done, detail: _describe(report.detail));
      } else if (target.optional) {
        target.finish(BootStatus.skipped, detail: report.reason);
      } else {
        target.finish(BootStatus.failed, detail: report.reason);
      }
    } on SpawnFailure catch (e) {
      target.finish(
        target.optional ? BootStatus.skipped : BootStatus.failed,
        detail: e.message,
      );
    } catch (e) {
      target.finish(
        target.optional ? BootStatus.skipped : BootStatus.failed,
        detail: '$e',
      );
    }
    notifyListeners();
  }

  String? _describe(Map<String, dynamic>? detail) {
    if (detail == null || detail.isEmpty) return null;
    final model = detail['model'];
    if (model is String && model.isNotEmpty) return model;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Preflight
  // ---------------------------------------------------------------------------

  Future<bool> _runPreflight() async {
    final target = step('preflight');
    target.begin();
    notifyListeners();

    final located = DexPaths.locate();
    if (located == null) {
      target.finish(
        BootStatus.failed,
        detail: 'Could not find the Dex files. Set DEX_HOME to the folder '
            'containing daemon/DexDaemon.py.',
      );
      notifyListeners();
      return false;
    }
    paths = located;

    _node = DexPaths.nodeExecutable();
    if (_node == null) {
      target.finish(
        BootStatus.failed,
        detail: 'Node.js is not installed. Dex needs version 24 or newer — '
            'it keeps its history in node:sqlite, which older versions lack.',
      );
      notifyListeners();
      return false;
    }

    _python = DexPaths.pythonExecutable();
    if (_python == null) {
      target.finish(
        BootStatus.failed,
        detail: 'Python is not installed. Dex needs 3.11 or newer.',
      );
      notifyListeners();
      return false;
    }

    // No .env is created here.
    //
    // The Dex Bar's copy of this wrote one — copying .env.example, or an empty
    // file — because that is what RUN.bat did and the core read its config from
    // there. It does not any more: settings.json in the state directory is the
    // config store, the app writes it, and secrets live in the DPAPI credential
    // store. Creating a .env would put a second, stale source of truth beside
    // the real one, which is exactly the bug that had Settings showing Haiku
    // while the core planned on Sonnet.
    DexPaths.stateDir.createSync(recursive: true);

    if (!located.hasNodeModules) {
      target.status = BootStatus.running;
      target.detail = 'Installing dependencies — about a minute, once';
      notifyListeners();

      final installed = await _npmInstall();
      if (!installed) {
        target.finish(
          BootStatus.failed,
          detail: 'npm install failed. See ${DexPaths.logFile('npm').path}',
        );
        notifyListeners();
        return false;
      }
    }

    target.finish(BootStatus.done);
    notifyListeners();
    return true;
  }

  /// `npm install`, windowless.
  ///
  /// npm is a batch file, so this goes through cmd.exe — which is a console
  /// program, which is exactly why it is spawned the same way as everything
  /// else rather than with Process.run. Completion is detected by watching the
  /// process, not by a timer: a cold install on a slow disk takes minutes.
  Future<bool> _npmInstall() async {
    final comspec = Platform.environment['COMSPEC'] ??
        r'C:\Windows\System32\cmd.exe';

    final child = ProcessJob.instance.spawn(
      executable: comspec,
      // One argument per element. cmd.exe re-parses everything after /c with
      // its own quoting rules, so a single pre-joined string arrives quoted and
      // is taken literally.
      arguments: ['/c', 'npm', 'install'],
      workingDirectory: paths!.root.path,
      label: 'npm install',
    );

    final deadline = DateTime.now().add(const Duration(minutes: 10));
    while (child.isAlive && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    final code = child.exitCode;
    child.detach();
    return code == 0 && paths!.hasNodeModules;
  }

  // ---------------------------------------------------------------------------
  // The processes
  // ---------------------------------------------------------------------------

  /// The daemon, which may not be ours to start.
  ///
  /// If Full Access is set up, a scheduled logon task already runs it elevated
  /// in the owner's session and it is very likely up before the app even
  /// launches. Starting a second one would be actively harmful: two daemons can
  /// serve the same pipe and answer requests unpredictably, which has cost this
  /// project real debugging time. So the probe comes first, always.
  Future<HealthReport> _startDaemon() async {
    final existing = await Probe.namedPipe(daemonPipeName);
    if (existing.up) {
      step('daemon').wasAlreadyUp = true;
      return existing;
    }

    _children.remove('daemon')?.terminate();
    _children['daemon'] = ProcessJob.instance.spawn(
      executable: _python!,
      arguments: [paths!.join(['daemon', 'DexDaemon.py'])],
      workingDirectory: paths!.root.path,
      label: 'daemon',
    );

    return Probe.waitUntilUp(
      () => Probe.namedPipe(daemonPipeName),
      timeout: const Duration(seconds: 15),
      abandonIf: () => !(_children['daemon']?.isAlive ?? false),
    ).then(
      (report) => report.up
          ? report
          : HealthReport.down(
              _children['daemon']?.isAlive ?? false
                  ? 'the daemon started but never opened its pipe'
                  : _lastError('daemon') ??
                      'the daemon exited — see ${DexPaths.logFile('daemon').path}',
            ),
    );
  }

  Future<HealthReport> _startAppAgent() =>
      _startPythonAgent('app', appAgentPort, ['agents', 'app', 'server.py']);

  Future<HealthReport> _startDesktopAgent() {
    if (!startDesktopAgent) {
      return Future.value(HealthReport.down('turned off in Settings'));
    }
    return _startPythonAgent(
      'desktop',
      desktopAgentPort,
      ['agents', 'desktop', 'server.py'],
    );
  }

  Future<HealthReport> _startBrowserAgent() {
    if (!startBrowserAgent) {
      return Future.value(HealthReport.down('turned off in Settings'));
    }
    return _startPythonAgent(
      'browser',
      browserAgentPort,
      ['agents', 'browser', 'server.py'],
    );
  }

  Future<HealthReport> _startPythonAgent(
    String id,
    int port,
    List<String> script,
  ) async {
    final existing = await Probe.http(port);
    if (existing.up) {
      step(id).wasAlreadyUp = true;
      return existing;
    }

    _children.remove(id)?.terminate();
    _children[id] = ProcessJob.instance.spawn(
      executable: _python!,
      arguments: [paths!.join(script)],
      workingDirectory: paths!.root.path,
      label: id,
    );

    final report = await Probe.waitUntilUp(
      () => Probe.http(port),
      timeout: const Duration(seconds: 30),
      abandonIf: () => !(_children[id]?.isAlive ?? false),
    );
    if (report.up) return report;

    return HealthReport.down(
      _children[id]?.isAlive ?? false
          ? 'it started but never answered on port $port'
          : _lastError(id) ?? 'it exited — see ${DexPaths.logFile(id).path}',
    );
  }

  /// The last thing an agent complained about before it gave up.
  ///
  /// "See the log" is a worse answer than the log's own last line, and the
  /// difference matters most in exactly the case this exists for: an optional
  /// agent that will not start. The vision agent, for instance, refuses
  /// without an Anthropic key and says so plainly — which is a decision the
  /// owner can act on, unlike a file path.
  ///
  /// Only the tail is read, and only the last few kilobytes of it: these logs
  /// run to megabytes and this happens while the splash is on screen.
  String? _lastError(String id) {
    try {
      final file = DexPaths.logFile(id);
      if (!file.existsSync()) return null;

      final length = file.lengthSync();
      final window = length < 8192 ? length : 8192;
      final bytes = file.openSync()
        ..setPositionSync(length - window);
      final text = String.fromCharCodes(bytes.readSync(window));
      bytes.closeSync();

      for (final line in text.split('\n').reversed) {
        if (!line.contains('[ERROR]')) continue;
        // Strip the timestamp and level; the sentence after them is the part
        // worth putting on screen.
        final message = line.split(' - ').last.trim();
        if (message.isNotEmpty) return message;
      }
    } catch (_) {
      // Reporting the path is still better than reporting nothing.
    }
    return null;
  }

  /// The core, headless.
  ///
  /// DEX_HEADLESS=true makes main.ts skip startCli, which would otherwise build
  /// a readline over a stdin that is already closed and end the moment it
  /// began. The bar and this window are the interface.
  ///
  /// A stale handshake file is deleted first. It survives a killed core, and
  /// leaving it would let the readiness probe pass against a port nobody is
  /// listening on — the classic "it worked yesterday" failure.
  Future<HealthReport> _startCore() async {
    final existing = await Probe.core();
    if (existing.up) {
      step('core').wasAlreadyUp = true;
      return existing;
    }

    try {
      if (DexPaths.handshakeFile.existsSync()) {
        DexPaths.handshakeFile.deleteSync();
      }
    } catch (_) {
      // If it cannot be deleted the probe below simply waits for the content to
      // change; not fatal.
    }

    _children.remove('core')?.terminate();
    _children['core'] = ProcessJob.instance.spawn(
      executable: _node!,
      arguments: ['-r', 'ts-node/register', 'src/main.ts'],
      workingDirectory: paths!.root.path,
      environment: {'DEX_HEADLESS': 'true'},
      label: 'core',
    );

    final report = await Probe.waitUntilUp(
      Probe.core,
      timeout: const Duration(seconds: 60),
      abandonIf: () => !(_children['core']?.isAlive ?? false),
    );
    if (report.up) return report;

    return HealthReport.down(
      _children['core']?.isAlive ?? false
          ? 'the core is starting but has not opened its socket yet'
          : _lastError('core') ??
              'the core exited — see ${DexPaths.logFile('core').path}',
    );
  }

  // ---------------------------------------------------------------------------
  // Live health, for the Agents page and the status dots
  // ---------------------------------------------------------------------------

  Future<Map<String, HealthReport>> checkAll() async {
    final results = await Future.wait([
      Probe.namedPipe(daemonPipeName),
      Probe.http(appAgentPort),
      Probe.http(desktopAgentPort),
      Probe.http(browserAgentPort),
      Probe.core(),
    ]);
    return {
      'daemon': results[0],
      'app': results[1],
      'desktop': results[2],
      'browser': results[3],
      'core': results[4],
    };
  }

  int? pidOf(String id) => _children[id]?.pid;

  @override
  void dispose() {
    stopAll();
    super.dispose();
  }
}
