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
  // Groq (needs a Groq key). Limits reset per-MINUTE, not daily — Scout's
  // 30K tok/min fits Dex's full prompt; 70b's 12K would 413 on big turns.
  'groq/meta-llama/llama-4-scout-17b-16e-instruct',
  'groq/llama-3.3-70b-versatile',
];

/// Friendly labels for the brain-model dropdown so users don't see raw
/// `provider/model` ids. Falls back to the raw id when unmapped.
const Map<String, String> kModelLabels = <String, String>{
  'google/gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite (daily quota)',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash (daily quota)',
  'google/gemini-2.0-flash': 'Gemini 2.0 Flash (daily quota)',
  'google/gemini-flash-latest': 'Gemini Flash (latest, daily quota)',
  'groq/meta-llama/llama-4-scout-17b-16e-instruct':
      'Groq · Llama 4 Scout — no daily limit (recommended)',
  'groq/llama-3.3-70b-versatile': 'Groq · Llama 3.3 70B (12K/min cap)',
};

String brainModelLabel(String id) => kModelLabels[id] ?? id;

// Hands (UFO² + browser-use) models, same provider/model format as the
// brain so one dropdown lists everything. applyHandsModel writes the
// matching endpoint + key into agents.yaml + the browser env.
const List<String> kHandsModels = <String>[
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'groq/meta-llama/llama-4-scout-17b-16e-instruct',
  'groq/llama-3.3-70b-versatile',
];

/// OpenAI-compatible endpoints UFO² (agents.yaml) points at per provider.
const String _kGeminiApiBase =
    'https://generativelanguage.googleapis.com/v1beta/openai/';
const String _kGroqApiBase = 'https://api.groq.com/openai/v1/chat/completions';

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
    final wdc = (servers?['windows-desktop-control'] as Map?)?.cast<String, dynamic>();

    // Most robust: the driver's own UFO root. When the engine lives at
    // ~/.dex/engines/UFO (post-vendor), DEX_UFO_ROOT names it directly,
    // so agents.yaml is <DEX_UFO_ROOT>/config/ufo/agents.yaml.
    final ufoRoot = ((wdc?['env'] as Map?)?['DEX_UFO_ROOT'] as String?)?.trim();
    if (ufoRoot != null && ufoRoot.isNotEmpty) {
      final yaml = File(
          '$ufoRoot${_sep}config${_sep}ufo${_sep}agents.yaml');
      if (yaml.existsSync()) return yaml;
    }

    // Fallback: walk up from the registered server.py toward a sibling
    // vendor/UFO (dev repo or MSI layout). Skipped when no mcp.servers
    // entry exists (built-in resolution is in use).
    final args = wdc?['args'];
    final serverPy = (args is List && args.isNotEmpty) ? args.first : null;
    if (serverPy is String && serverPy.isNotEmpty) {
      final dir = File(serverPy).parent.parent; // = drivers\
      for (final hops in <int>[1, 2, 3]) {
        var base = dir;
        for (var i = 0; i < hops; i++) {
          base = base.parent;
        }
        final yaml = File(
            '${base.path}${_sep}vendor${_sep}UFO${_sep}config${_sep}ufo${_sep}agents.yaml');
        if (yaml.existsSync()) return yaml;
      }
    }
    // Canonical engines home (post-vendor: `dex engines setup` /
    // migrated UFO live here, and built-in resolution uses it).
    final home = File(
        '$_home$_sep.dex${_sep}engines${_sep}UFO${_sep}config${_sep}ufo${_sep}agents.yaml');
    return home.existsSync() ? home : null;
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
    if (s != null && s['enabled'] == false) {
      return EngineStatus(label: label, ready: false, detail: 'disabled in config');
    }
    // Explicit mcp.servers registration (installer / install-skills): ready
    // only when both its python venv and driver server.py exist on disk.
    if (s != null) {
      final cmd = (s['command'] as String?)?.trim();
      final args = s['args'];
      final serverPy = (args is List && args.isNotEmpty) ? args.first as String? : null;
      final cmdOk = cmd != null && cmd.isNotEmpty && File(cmd).existsSync();
      final pyOk =
          serverPy != null && serverPy.isNotEmpty && File(serverPy).existsSync();
      if (cmdOk && pyOk) {
        return EngineStatus(label: label, ready: true, detail: cmd);
      }
    }
    // Built-in resolution (Phase K): no mcp.servers entry, or a stale one.
    // The gateway resolves + runs the engine from the canonical engines
    // home, so if its venv exists the engine is ready — no manual setup.
    final builtin = _builtinEngineVenv(id);
    if (builtin != null) {
      return EngineStatus(label: label, ready: true, detail: 'built-in · $builtin');
    }
    return EngineStatus(
        label: label, ready: false, detail: 'not installed — run `dex engines setup`');
  }

  /// Canonical built-in engine venv python under ~/.dex/engines, or null if
  /// it isn't installed there. Mirrors builtin-engines.ts resolution.
  static String? _builtinEngineVenv(String id) {
    final sub = id == 'windows-desktop-control'
        ? 'UFO'
        : id == 'browser-control'
            ? 'browser-use'
            : null;
    if (sub == null) return null;
    final py = File(
        '$_home$_sep.dex${_sep}engines$_sep$sub$_sep.venv${_sep}Scripts${_sep}python.exe');
    return py.existsSync() ? py.path : null;
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
      final raw = RegExp(r'^\s*API_MODEL:\s*"([^"]+)"', multiLine: true)
          .firstMatch(text)
          ?.group(1);
      // Map the raw agents.yaml model back to a provider/model id so it
      // matches the unified Hands dropdown. Provider comes from API_BASE.
      final base = RegExp(r'^\s*API_BASE:\s*"([^"]+)"', multiLine: true)
              .firstMatch(text)
              ?.group(1) ??
          '';
      final prov = base.contains('groq') ? 'groq' : 'google';
      handsModel = raw != null ? '$prov/$raw' : null;
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
      // Browser is configured when its key is resolvable: either an
      // explicit browser-control env key, OR the google provider key the
      // built-in browser engine injects at runtime (resolveGoogleApiKey).
      // Without the OR, a built-in-engine setup (no mcp.servers entry)
      // shows Browser grey even though it's fully keyed. See
      // engines/builtin-engines.ts (GEMINI_API_KEY from providers.google).
      browserEnvKeySet:
          ((browserEnv?['GEMINI_API_KEY']) as String?)?.isNotEmpty == true ||
              (webSearchKey is String && webSearchKey.isNotEmpty),
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

    // NOTE: keys are credentials only — the Brain/Hands dropdowns pick which
    // model runs. We deliberately do NOT set agents.defaults.model here, so
    // re-applying the Gemini key never clobbers a Groq brain the user chose.

    // Autonomy: let the operator run admin commands (DNS, service control,
    // installs) instead of handing the user manual steps. exec's elevated
    // path is gated behind tools.elevated.allowFrom.<provider>; the desktop
    // app reaches the gateway as provider 'webchat'. '*' = the owner on this
    // single-user machine — each elevated command still triggers Windows UAC.
    final tools = (cfg['tools'] as Map?)?.cast<String, dynamic>() ?? {};
    tools['elevated'] = <String, dynamic>{
      'enabled': true,
      'allowFrom': <String, dynamic>{
        'webchat': <String>['*'],
        'openclaw': <String>['*'],
      },
    };
    cfg['tools'] = tools;
    _writeJson(dexJsonFile, cfg);
  }

  /// Rewrite every ACTIVE `FIELD: "..."` line (commented examples start
  /// with `#`, so `^\s*FIELD` skips them).
  static String _rewriteYamlField(String text, String field, String value) {
    return text.replaceAllMapped(
      RegExp('^(\\s*$field:\\s*")[^"]*(")', multiLine: true),
      (m) => '${m.group(1)}$value${m.group(2)}',
    );
  }

  /// Save a Groq API key. Keys are just credentials — the Brain and Hands
  /// dropdowns pick WHICH model runs. Groq's limits reset PER MINUTE (not
  /// daily like Gemini), so once a Groq model is selected the daily wall is
  /// gone. Writes the groq auth profile + models.providers.groq (key + the
  /// tool-calling model catalog) so any groq/* model in the dropdowns can
  /// authenticate.
  static Future<void> applyGroqKey(String key) async {
    final k = key.trim();
    if (k.isEmpty) throw ArgumentError('empty key');

    final auth = _readJson(authProfilesFile);
    auth['version'] ??= 1;
    final profiles =
        (auth['profiles'] as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};
    profiles['groq:default'] = <String, dynamic>{
      'type': 'api_key',
      'provider': 'groq',
      'key': k,
    };
    auth['profiles'] = profiles;
    _writeJson(authProfilesFile, auth);

    final cfg = _readJson(dexJsonFile);
    final models = (cfg['models'] as Map?)?.cast<String, dynamic>() ?? {};
    final providers =
        (models['providers'] as Map?)?.cast<String, dynamic>() ?? {};
    providers['groq'] = <String, dynamic>{
      'api': 'openai-completions',
      'baseUrl': 'https://api.groq.com/openai/v1',
      'apiKey': k,
      'models': <Map<String, dynamic>>[
        {'id': 'meta-llama/llama-4-scout-17b-16e-instruct', 'name': 'Llama 4 Scout'},
        {'id': 'llama-3.3-70b-versatile', 'name': 'Llama 3.3 70B'},
      ],
    };
    models['providers'] = providers;
    cfg['models'] = models;
    _writeJson(dexJsonFile, cfg);
  }

  /// The saved API key for a provider (from models.providers.[id].apiKey,
  /// falling back to the auth profile), or null. Used by applyHandsModel to
  /// write the matching key into agents.yaml / browser env.
  static String? _providerKey(String provider) {
    final cfg = _readJson(dexJsonFile);
    final pk = (((cfg['models'] as Map?)?['providers'] as Map?)?[provider]
        as Map?)?['apiKey'];
    if (pk is String && pk.trim().isNotEmpty) return pk.trim();
    final prof = ((_readJson(authProfilesFile)['profiles']) as Map?)
        ?.cast<String, dynamic>()['$provider:default'] as Map?;
    final key = (prof?['key'] as String?)?.trim();
    return (key != null && key.isNotEmpty) ? key : null;
  }

  /// Clear per-session model pins (`modelOverride` / `providerOverride` etc.)
  /// the gateway persists in agents/*/sessions/sessions.json. It prefers
  /// those over agents.defaults.model, so a stale auto-pin (e.g. a dead
  /// Gemini) silently overrides whatever the user picks. We clear them on
  /// every model change so the new selection wins; takes effect on the next
  /// gateway restart (the running gateway holds sessions in memory).
  static void clearSessionModelOverrides() {
    final dir = Directory('$_home$_sep.dex${_sep}agents');
    if (!dir.existsSync()) return;
    const pinFields = <String>[
      'model',
      'modelOverride',
      'providerOverride',
      'modelOverrideSource',
      'providerOverrideSource',
      'modelProvider',
      'contextTokens',
    ];
    for (final f in dir.listSync(recursive: true)) {
      if (f is! File || !f.path.endsWith('sessions.json')) continue;
      try {
        final j = jsonDecode(f.readAsStringSync());
        if (j is! Map) continue;
        var changed = false;
        for (final v in j.values) {
          if (v is Map) {
            for (final k in pinFields) {
              if (v.remove(k) != null) changed = true;
            }
          }
        }
        if (changed) {
          f.writeAsStringSync(const JsonEncoder.withIndent('  ').convert(j));
        }
      } catch (_) {
        // A malformed/locked session store isn't worth failing the apply.
      }
    }
  }

  static Future<void> applyBrainModel(String primary,
      {List<String>? fallbacks}) async {
    clearSessionModelOverrides();
    final cfg = _readJson(dexJsonFile);
    final agents = (cfg['agents'] as Map?)?.cast<String, dynamic>() ?? {};
    final defaults = (agents['defaults'] as Map?)?.cast<String, dynamic>() ?? {};
    final model = (defaults['model'] as Map?)?.cast<String, dynamic>() ?? {};
    model['primary'] = primary;
    if (fallbacks != null) model['fallbacks'] = fallbacks;
    defaults['model'] = model;
    // `agents.defaults.models` (PLURAL) is an allowlist when present: a
    // model not listed there is rejected and the brain falls back. So if
    // the user has one, add the chosen model to it; if absent, leave it
    // (no allowlist = everything allowed).
    final allow = (defaults['models'] as Map?)?.cast<String, dynamic>();
    if (allow != null && !allow.containsKey(primary)) {
      allow[primary] = <String, dynamic>{};
      defaults['models'] = allow;
    }
    agents['defaults'] = defaults;
    cfg['agents'] = agents;
    _writeJson(dexJsonFile, cfg);
  }

  /// True when a provider has an API key configured (auth profile or the
  /// `models.providers.[id].apiKey` field). Local providers like Ollama
  /// need no key, so they read as configured.
  static bool providerConfigured(String provider) {
    if (provider == 'ollama') return true;
    final cfg = _readJson(dexJsonFile);
    final providerKey = (((cfg['models'] as Map?)?['providers'] as Map?)?[provider]
        as Map?)?['apiKey'];
    if (providerKey is String && providerKey.isNotEmpty) return true;
    final profiles =
        ((_readJson(authProfilesFile)['profiles']) as Map?)?.cast<String, dynamic>();
    final prof = (profiles?['$provider:default'] as Map?)?.cast<String, dynamic>();
    final key = (prof?['key'] as String?)?.trim();
    return key != null && key.isNotEmpty;
  }

  /// Generic "save any provider's API key", mirroring [applyGeminiKey] but
  /// for any provider id (anthropic, openai, groq, openrouter, mistral,
  /// xai, ...). Writes the auth profile + the `models.providers.[id].apiKey`
  /// so both the auth layer and provider config see it. Google/Groq keep
  /// their richer fan-out methods (they also touch the engines).
  static Future<void> applyProviderKey(String provider, String key) async {
    final k = key.trim();
    if (k.isEmpty) throw ArgumentError('empty key');
    if (provider == 'google') {
      await applyGeminiKey(k);
      return;
    }

    final auth = _readJson(authProfilesFile);
    auth['version'] ??= 1;
    final profiles =
        (auth['profiles'] as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};
    profiles['$provider:default'] = <String, dynamic>{
      'type': 'api_key',
      'provider': provider,
      'key': k,
    };
    auth['profiles'] = profiles;
    _writeJson(authProfilesFile, auth);

    final cfg = _readJson(dexJsonFile);
    final models = (cfg['models'] as Map?)?.cast<String, dynamic>() ?? {};
    final providers =
        (models['providers'] as Map?)?.cast<String, dynamic>() ?? {};
    final p = (providers[provider] as Map?)?.cast<String, dynamic>() ?? {};
    p['apiKey'] = k;
    providers[provider] = p;
    models['providers'] = providers;
    cfg['models'] = models;
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

  /// Set the hands (UFO² + browser-use) model. [id] is `provider/model`
  /// (e.g. `groq/meta-llama/llama-4-scout-17b-16e-instruct` or
  /// `google/gemini-2.5-flash-lite`). Writes the matching endpoint + key +
  /// model into agents.yaml AND the browser-control env, so the one Hands
  /// dropdown drives both engines and uses the right provider's key.
  static Future<void> applyHandsModel(String id) async {
    final slash = id.indexOf('/');
    final provider = slash > 0 ? id.substring(0, slash) : 'google';
    final rawModel = slash > 0 ? id.substring(slash + 1) : id;
    final isGroq = provider == 'groq';
    final key = _providerKey(provider);
    if (key == null) {
      throw StateError('No $provider API key saved — add it in Secrets first.');
    }

    // UFO² agents.yaml: endpoint + key + model on every active block.
    final yaml = agentsYamlFile();
    if (yaml != null) {
      var text = yaml.readAsStringSync();
      text = _rewriteYamlField(text, 'API_BASE',
          isGroq ? _kGroqApiBase : _kGeminiApiBase);
      text = _rewriteYamlField(text, 'API_KEY', key);
      text = _rewriteYamlField(text, 'API_MODEL', rawModel);
      yaml.writeAsStringSync(text);
    }

    // browser-use env: provider + key + model.
    final cfg = _readJson(dexJsonFile);
    final mcp = (cfg['mcp'] as Map?)?.cast<String, dynamic>() ?? {};
    final servers = (mcp['servers'] as Map?)?.cast<String, dynamic>() ?? {};
    final bc = (servers['browser-control'] as Map?)?.cast<String, dynamic>();
    if (bc != null) {
      final env = (bc['env'] as Map?)?.cast<String, dynamic>() ?? {};
      env['DEX_BROWSER_PROVIDER'] = isGroq ? 'groq' : 'google';
      env[isGroq ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'] = key;
      env['DEX_BROWSER_MODEL'] = rawModel;
      bc['env'] = env;
      servers['browser-control'] = bc;
      mcp['servers'] = servers;
      cfg['mcp'] = mcp;
      _writeJson(dexJsonFile, cfg);
    }
  }
}
