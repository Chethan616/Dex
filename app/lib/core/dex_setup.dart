// DexSetup — the one place that knows where every key and model in the
// stack lives, verified against the real on-disk state 2026-06-12:
//
//   Brain (dexagent) API key   ~/.dex/agents/main/agent/auth-profiles.json
//                              profiles["google:default"] =
//                                {type:"api_key", provider:"google", key}
//   Brain model + fallbacks    ~/.dex/dex.json
//                              agents.defaults.model.{primary,fallbacks}
//   web_search (gemini)        ~/.dex/dex.json models.providers.google.apiKey
//                              (resolution order per
//                              gemini-web-search-provider.runtime.ts:296)
//   browser-use driver         ~/.dex/dex.json
//                              mcp.servers.browser-control.env.GEMINI_API_KEY
//   UFO² (4 agents)            <repo>/vendor/UFO/config/ufo/agents.yaml
//                              API_KEY / API_MODEL lines (repo root derived
//                              from the registered MCP server path so the
//                              app works regardless of where it's launched)
//
// The onboarding screen and Settings → Account → Secrets both write
// through this class so the single-key UX ("paste one Gemini key")
// fans out to every consumer atomically.

import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';

/// Curated model choices. Brain ids are gateway-form (`provider/model`);
/// hands ids are raw Gemini model names for agents.yaml.
const List<String> kBrainModels = <String>[
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash',
  'google/gemini-flash-latest',
];

const List<String> kHandsModels = <String>[
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

/// OpenAI-compatible endpoints UFO² (agents.yaml) points at per provider.
const String _kGeminiApiBase =
    'https://generativelanguage.googleapis.com/v1beta/openai/';
const String _kGroqApiBase = 'https://api.groq.com/openai/v1/chat/completions';

/// Groq's free text model the hands use when offloaded off Gemini. Matches
/// the browser-control server default (DEX_BROWSER_MODEL → qwen/qwen3-32b).
const String _kGroqHandsModel = 'qwen/qwen3-32b';

class DexSetupState {
  const DexSetupState({
    required this.hasConfig,
    required this.hasGatewayToken,
    required this.geminiKeyTail,
    required this.brainModel,
    required this.brainFallbacks,
    required this.handsModel,
    required this.handsKeySet,
    required this.browserEnvKeySet,
    required this.webSearchKeySet,
    required this.handsOnGroq,
    required this.groqKeyTail,
  });

  final bool hasConfig;
  final bool hasGatewayToken;

  /// Last 4 chars of the stored brain key, or null when unset.
  final String? geminiKeyTail;
  final String? brainModel;
  final List<String> brainFallbacks;
  final String? handsModel;
  final bool handsKeySet;
  final bool browserEnvKeySet;
  final bool webSearchKeySet;

  /// True when the hands (UFO² + browser-use) are offloaded to Groq,
  /// keeping their quota separate from the brain's Gemini quota.
  final bool handsOnGroq;

  /// Last 4 chars of the stored Groq key, or null when unset.
  final String? groqKeyTail;

  bool get hasBrainKey => geminiKeyTail != null;

  /// The app routes to onboarding when the engine is missing or no
  /// brain key has been configured yet.
  bool get needsOnboarding => !hasConfig || !hasGatewayToken || !hasBrainKey;
}

/// Health of one built-in automation engine, resolved from the live
/// dex.json mcp.servers entry by checking its python + driver on disk.
class EngineStatus {
  const EngineStatus({
    required this.label,
    required this.ready,
    required this.detail,
  });
  final String label;
  final bool ready;

  /// Resolved python path when ready, else a one-line reason.
  final String detail;
}

class DexSetup {
  DexSetup._();

  static String get _home =>
      Platform.environment['USERPROFILE'] ?? Platform.environment['HOME'] ?? '';

  static String get _sep => Platform.pathSeparator;

  static File get dexJsonFile => File('$_home$_sep.dex${_sep}dex.json');

  static File get authProfilesFile => File(
      '$_home$_sep.dex${_sep}agents${_sep}main${_sep}agent${_sep}auth-profiles.json');

  static Map<String, dynamic> _readJson(File f) {
    try {
      if (!f.existsSync()) return <String, dynamic>{};
      final parsed = jsonDecode(f.readAsStringSync());
      return parsed is Map ? parsed.cast<String, dynamic>() : <String, dynamic>{};
    } catch (e) {
      debugPrint('[dex] read ${f.path} failed: $e');
      return <String, dynamic>{};
    }
  }

  static void _writeJson(File f, Map<String, dynamic> data) {
    f.parent.createSync(recursive: true);
    f.writeAsStringSync(const JsonEncoder.withIndent('  ').convert(data));
  }

  /// agents.yaml lives next to the UFO² runtime. Derive its base from
  /// the registered windows-desktop-control MCP server path so the app
  /// finds it no matter where dex.exe runs from. Drivers now live inside
  /// the package (dex/core/drivers), so layouts are:
  ///   dev:    `<repo>\dex\core\drivers\wdc\server.py` -> `<repo>\vendor\UFO`
  ///           (drivers dir is 3 hops below the repo root)
  ///   bundle: `<install>\runtime\dexagent\drivers\wdc\server.py`
  ///           -> `<install>\runtime\vendor\UFO` (2 hops up)
  static File? agentsYamlFile() {
    final cfg = _readJson(dexJsonFile);
    final servers = (cfg['mcp'] as Map?)?['servers'] as Map?;
    final wdc = servers?['windows-desktop-control'] as Map?;
    final args = wdc?['args'];
    final serverPy = (args is List && args.isNotEmpty) ? args.first : null;
    if (serverPy is! String || serverPy.isEmpty) return null;
    var dir = File(serverPy).parent.parent; // = drivers\
    for (final hops in <int>[1, 2, 3]) {
      var base = dir;
      for (var i = 0; i < hops; i++) {
        base = base.parent;
      }
      final yaml = File(
          '${base.path}${_sep}vendor${_sep}UFO${_sep}config${_sep}ufo${_sep}agents.yaml');
      if (yaml.existsSync()) return yaml;
    }
    return null;
  }

  /// Live health of the built-in engines, checked against disk. Reads
  /// each engine's mcp.servers entry (written by the installer /
  /// `dex engines setup` / install-skills) and verifies its python venv
  /// + driver server.py exist, so the app can SHOW "ready / unavailable"
  /// instead of the user guessing why a task did nothing.
  static List<EngineStatus> engineStatus() {
    final servers = (_readJson(dexJsonFile)['mcp'] as Map?)?['servers'] as Map?;
    return <EngineStatus>[
      _engineStatus(servers, 'windows-desktop-control', 'Desktop · UFO²'),
      _engineStatus(servers, 'browser-control', 'Browser · browser-use'),
    ];
  }

  static EngineStatus _engineStatus(Map? servers, String id, String label) {
    final s = servers?[id] as Map?;
    if (s == null) {
      return EngineStatus(
          label: label, ready: false, detail: 'not configured — run `dex engines setup`');
    }
    if (s['enabled'] == false) {
      return EngineStatus(label: label, ready: false, detail: 'disabled in config');
    }
    final cmd = (s['command'] as String?)?.trim();
    final args = s['args'];
    final serverPy = (args is List && args.isNotEmpty) ? args.first as String? : null;
    if (cmd == null || cmd.isEmpty || !File(cmd).existsSync()) {
      return EngineStatus(
          label: label, ready: false, detail: 'python venv missing: ${cmd ?? '(unset)'}');
    }
    if (serverPy == null || serverPy.isEmpty || !File(serverPy).existsSync()) {
      return EngineStatus(
          label: label, ready: false, detail: 'driver missing: ${serverPy ?? '(unset)'}');
    }
    return EngineStatus(label: label, ready: true, detail: cmd);
  }

  static DexSetupState read() {
    final cfg = _readJson(dexJsonFile);
    final gw = (cfg['gateway'] as Map?)?.cast<String, dynamic>();
    final token = ((gw?['auth'] as Map?)?['token'] as String?)?.trim();

    final profiles =
        ((_readJson(authProfilesFile)['profiles']) as Map?)?.cast<String, dynamic>();
    final google = (profiles?['google:default'] as Map?)?.cast<String, dynamic>();
    final key = (google?['key'] as String?)?.trim();

    final model = ((cfg['agents'] as Map?)?['defaults'] as Map?)?['model'] as Map?;
    final fallbacks = (model?['fallbacks'] as List?)
            ?.whereType<String>()
            .toList(growable: false) ??
        const <String>[];

    final browserEnv = ((((cfg['mcp'] as Map?)?['servers'] as Map?)?['browser-control']
            as Map?)?['env'] as Map?)
        ?.cast<String, dynamic>();
    final webSearchKey =
        (((cfg['models'] as Map?)?['providers'] as Map?)?['google'] as Map?)?['apiKey'];

    final handsOnGroq =
        (browserEnv?['DEX_BROWSER_PROVIDER'] as String?)?.toLowerCase() == 'groq';
    final groqKey = (browserEnv?['GROQ_API_KEY'] as String?)?.trim();

    String? handsModel;
    var handsKeySet = false;
    final yaml = agentsYamlFile();
    if (yaml != null) {
      final text = yaml.readAsStringSync();
      final m = RegExp(r'^\s*API_MODEL:\s*"([^"]+)"', multiLine: true)
          .firstMatch(text);
      handsModel = m?.group(1);
      final k = RegExp(r'^\s*API_KEY:\s*"([^"]*)"', multiLine: true)
          .firstMatch(text)
          ?.group(1);
      handsKeySet = k != null && k.length > 10 && !k.startsWith('<');
    }

    return DexSetupState(
      hasConfig: dexJsonFile.existsSync(),
      hasGatewayToken: token != null && token.isNotEmpty,
      geminiKeyTail: (key != null && key.isNotEmpty)
          ? key.substring(key.length >= 4 ? key.length - 4 : 0)
          : null,
      brainModel: model?['primary'] as String?,
      brainFallbacks: fallbacks,
      handsModel: handsModel,
      handsKeySet: handsKeySet,
      browserEnvKeySet:
          ((browserEnv?['GEMINI_API_KEY']) as String?)?.isNotEmpty == true,
      webSearchKeySet: webSearchKey is String && webSearchKey.isNotEmpty,
      handsOnGroq: handsOnGroq,
      groqKeyTail: (groqKey != null && groqKey.isNotEmpty)
          ? groqKey.substring(groqKey.length >= 4 ? groqKey.length - 4 : 0)
          : null,
    );
  }

  /// One key, every consumer: brain auth profile, web_search provider
  /// key, browser-control env, and all four UFO² agents.
  static Future<void> applyGeminiKey(String key) async {
    final k = key.trim();
    if (k.isEmpty) throw ArgumentError('empty key');

    // 1. Brain auth profile.
    final auth = _readJson(authProfilesFile);
    auth['version'] ??= 1;
    final profiles =
        (auth['profiles'] as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};
    profiles['google:default'] = <String, dynamic>{
      'type': 'api_key',
      'provider': 'google',
      'key': k,
    };
    auth['profiles'] = profiles;
    _writeJson(authProfilesFile, auth);

    // 2. dex.json: web_search provider key + browser-control env.
    final cfg = _readJson(dexJsonFile);
    final models = (cfg['models'] as Map?)?.cast<String, dynamic>() ?? {};
    final providers =
        (models['providers'] as Map?)?.cast<String, dynamic>() ?? {};
    final googleProvider =
        (providers['google'] as Map?)?.cast<String, dynamic>() ?? {};
    googleProvider['apiKey'] = k;
    providers['google'] = googleProvider;
    models['providers'] = providers;
    cfg['models'] = models;

    final mcp = (cfg['mcp'] as Map?)?.cast<String, dynamic>() ?? {};
    final servers = (mcp['servers'] as Map?)?.cast<String, dynamic>() ?? {};
    final bc = (servers['browser-control'] as Map?)?.cast<String, dynamic>();
    if (bc != null) {
      final env = (bc['env'] as Map?)?.cast<String, dynamic>() ?? {};
      // Reset the browser hands fully to Gemini: provider + key, and drop
      // any prior Groq override so re-applying the Gemini key is a clean
      // baseline (the Groq path below is the explicit opt-in override).
      env['DEX_BROWSER_PROVIDER'] = 'google';
      env['GEMINI_API_KEY'] = k;
      env.remove('GROQ_API_KEY');
      env.remove('DEX_BROWSER_MODEL');
      bc['env'] = env;
      servers['browser-control'] = bc;
      mcp['servers'] = servers;
      cfg['mcp'] = mcp;
    }
    _writeJson(dexJsonFile, cfg);

    // 3. UFO² agents.yaml: key + Gemini endpoint on every active block, so
    // re-applying Gemini also restores the base if it was on Groq.
    final yaml = agentsYamlFile();
    if (yaml != null) {
      var text = yaml.readAsStringSync();
      text = _rewriteYamlField(text, 'API_KEY', k);
      text = _rewriteYamlField(text, 'API_BASE', _kGeminiApiBase);
      yaml.writeAsStringSync(text);
    }
  }

  /// Rewrite every ACTIVE `FIELD: "..."` line (commented examples start
  /// with `#`, so `^\s*FIELD` skips them).
  static String _rewriteYamlField(String text, String field, String value) {
    return text.replaceAllMapped(
      RegExp('^(\\s*$field:\\s*")[^"]*(")', multiLine: true),
      (m) => '${m.group(1)}$value${m.group(2)}',
    );
  }

  /// Move the HANDS (UFO² + browser-use) onto a free Groq key, keeping
  /// their quota separate from the brain's Gemini quota. The brain +
  /// web_search stay on Gemini. Re-apply the Gemini key to undo.
  static Future<void> applyGroqKey(String key) async {
    final k = key.trim();
    if (k.isEmpty) throw ArgumentError('empty key');

    // browser-use → Groq via env (server defaults model to qwen/qwen3-32b
    // when DEX_BROWSER_MODEL is unset).
    final cfg = _readJson(dexJsonFile);
    final mcp = (cfg['mcp'] as Map?)?.cast<String, dynamic>() ?? {};
    final servers = (mcp['servers'] as Map?)?.cast<String, dynamic>() ?? {};
    final bc = (servers['browser-control'] as Map?)?.cast<String, dynamic>();
    if (bc != null) {
      final env = (bc['env'] as Map?)?.cast<String, dynamic>() ?? {};
      env['DEX_BROWSER_PROVIDER'] = 'groq';
      env['GROQ_API_KEY'] = k;
      env.remove('DEX_BROWSER_MODEL');
      bc['env'] = env;
      servers['browser-control'] = bc;
      mcp['servers'] = servers;
      cfg['mcp'] = mcp;
      _writeJson(dexJsonFile, cfg);
    }

    // UFO² → Groq: key + Groq endpoint + Groq model on every active block.
    final yaml = agentsYamlFile();
    if (yaml != null) {
      var text = yaml.readAsStringSync();
      text = _rewriteYamlField(text, 'API_KEY', k);
      text = _rewriteYamlField(text, 'API_BASE', _kGroqApiBase);
      text = _rewriteYamlField(text, 'API_MODEL', _kGroqHandsModel);
      yaml.writeAsStringSync(text);
    }
  }

  static Future<void> applyBrainModel(String primary,
      {List<String>? fallbacks}) async {
    final cfg = _readJson(dexJsonFile);
    final agents = (cfg['agents'] as Map?)?.cast<String, dynamic>() ?? {};
    final defaults = (agents['defaults'] as Map?)?.cast<String, dynamic>() ?? {};
    final model = (defaults['model'] as Map?)?.cast<String, dynamic>() ?? {};
    model['primary'] = primary;
    if (fallbacks != null) model['fallbacks'] = fallbacks;
    defaults['model'] = model;
    agents['defaults'] = defaults;
    cfg['agents'] = agents;
    _writeJson(dexJsonFile, cfg);
  }

  // ---- installer / first-boot plumbing ---------------------------------

  /// Bundled runtime root (`<exeDir>\runtime`) when running from the
  /// MSI install; null on dev machines.
  static Directory? bundledRuntimeDir() {
    final exeDir = File(Platform.resolvedExecutable).parent.path;
    final dir = Directory('$exeDir${_sep}runtime');
    return dir.existsSync() ? dir : null;
  }

  /// Create a minimal `~/.dex/dex.json` when none exists (fresh MSI
  /// install): random gateway token + local control-ui auth + sane
  /// model default. The gateway and this app then share the token.
  static Future<void> ensureBaseConfig() async {
    if (dexJsonFile.existsSync()) return;
    final rng = Random.secure();
    final token = List<int>.generate(32, (_) => rng.nextInt(256))
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
    _writeJson(dexJsonFile, <String, dynamic>{
      'gateway': <String, dynamic>{
        'auth': <String, dynamic>{'token': token},
        'controlUi': <String, dynamic>{'allowInsecureAuth': true},
      },
      'agents': <String, dynamic>{
        'defaults': <String, dynamic>{
          'model': <String, dynamic>{
            'primary': kBrainModels.first,
            'fallbacks': kBrainModels.sublist(1, 3),
          },
        },
      },
    });
  }

  /// Register the BUNDLED engines (MSI layout) as MCP servers in
  /// dex.json. Drivers now ship INSIDE the dexagent package, so they land
  /// at `<install>\runtime\dexagent\drivers\`; the prebuilt venvs sit at
  /// `<install>\runtime\vendor\`. No-op on dev machines (no bundled
  /// runtime). The driver honors DEX_UFO_ROOT so UFO resolves correctly.
  static Future<void> registerBundledEngines() async {
    final runtime = bundledRuntimeDir();
    if (runtime == null) return;
    final r = runtime.path;
    final ufoPy =
        '$r${_sep}vendor${_sep}UFO$_sep.venv${_sep}Scripts${_sep}python.exe';
    final bcPy =
        '$r${_sep}vendor${_sep}browser-use$_sep.venv${_sep}Scripts${_sep}python.exe';
    final wdcDir =
        '$r${_sep}dexagent${_sep}drivers${_sep}windows-desktop-control';
    final bcDir = '$r${_sep}dexagent${_sep}drivers${_sep}browser-control';

    final cfg = _readJson(dexJsonFile);
    final mcp = (cfg['mcp'] as Map?)?.cast<String, dynamic>() ?? {};
    final servers = (mcp['servers'] as Map?)?.cast<String, dynamic>() ?? {};
    // Preserve any env the user already has (the Gemini key write
    // updates it separately).
    final prevEnv = ((servers['browser-control'] as Map?)?['env'] as Map?)
            ?.cast<String, dynamic>() ??
        <String, dynamic>{
          'DEX_BROWSER_PROVIDER': 'google',
          'DEX_BROWSER_MODEL': 'gemini-2.5-flash-lite',
        };
    servers['windows-desktop-control'] = <String, dynamic>{
      'command': ufoPy,
      'args': <String>['$wdcDir${_sep}server.py'],
      'cwd': wdcDir,
      'requestTimeoutMs': 330000,
    };
    servers['browser-control'] = <String, dynamic>{
      'command': bcPy,
      'args': <String>['$bcDir${_sep}server.py'],
      'cwd': bcDir,
      'requestTimeoutMs': 210000,
      'env': prevEnv,
    };
    mcp['servers'] = servers;
    cfg['mcp'] = mcp;
    _writeJson(dexJsonFile, cfg);
  }

  static Future<void> applyHandsModel(String model) async {
    final yaml = agentsYamlFile();
    if (yaml == null) {
      throw StateError('agents.yaml not found (is the desktop driver registered?)');
    }
    final text = yaml.readAsStringSync();
    final updated = text.replaceAllMapped(
      RegExp(r'^(\s*API_MODEL:\s*")[^"]*(")', multiLine: true),
      (m) => '${m.group(1)}$model${m.group(2)}',
    );
    yaml.writeAsStringSync(updated);
  }
}
