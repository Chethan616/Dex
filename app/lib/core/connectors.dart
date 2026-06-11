// Connectors & Apps catalog — the real surface Dex ships with.
//
// Dex is a downstream of OpenClaw, so the connector surface is wide:
// automation engines (UFO², browser-use, OmniParser) registered as MCP
// servers, built-in agent tools (shell, files, reminders, memory),
// messaging channels (WhatsApp, Telegram, Discord, ...), AI providers
// (Anthropic, Gemini, Groq, ...), and web/search/speech tool plugins.
//
// Status is wired live: ConnectorsStore fetches the gateway's
// `config.get` snapshot and probes each entry's config paths --
// an MCP server under `mcp.servers.<id>` or a channel under
// `channels.<id>` reads as Connected. Built-ins are always on.
// When the gateway is unreachable the catalog still renders with
// every probe-able entry shown as Available.

import 'package:flutter/widgets.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import 'gateway_client.dart';

enum ConnectorStatus { builtin, connected, available }

enum ConnectorCategory {
  engines('Automation engines'),
  builtins('Built-in tools'),
  channels('Paired messengers'),
  providers('AI providers'),
  web('Web & search'),
  speech('Speech & voice');

  const ConnectorCategory(this.label);
  final String label;
}

class ConnectorEntry {
  const ConnectorEntry({
    required this.id,
    required this.name,
    required this.icon,
    required this.description,
    required this.developer,
    required this.category,
    this.builtin = false,
    this.probePaths = const <String>[],
    this.connectHint,
  });

  final String id;
  final String name;
  final IconData icon;
  final String description;
  final String developer;
  final ConnectorCategory category;

  /// Always-on parts of Dex itself; no setup needed.
  final bool builtin;

  /// Dot-paths into the gateway config snapshot. The entry reads as
  /// Connected when any path resolves to a non-null, non-disabled value
  /// (a map carrying `enabled: false` does NOT count).
  final List<String> probePaths;

  /// One-liner shown in the detail view telling the user how to hook
  /// this up (usually a `dex` CLI command).
  final String? connectHint;

  ConnectorStatus statusIn(Map<String, dynamic>? config) {
    if (builtin) return ConnectorStatus.builtin;
    if (config == null) return ConnectorStatus.available;
    for (final path in probePaths) {
      final v = _resolvePath(config, path);
      if (v == null) continue;
      if (v is Map && v['enabled'] == false) continue;
      if (v is bool && !v) continue;
      return ConnectorStatus.connected;
    }
    return ConnectorStatus.available;
  }

  static Object? _resolvePath(Map<String, dynamic> root, String path) {
    Object? node = root;
    for (final seg in path.split('.')) {
      if (node is! Map) return null;
      node = node[seg];
    }
    return node;
  }
}

/// The catalog. Curated to what this Dex build actually supports —
/// every channel/provider id matches a dex-core extension plugin, and
/// the engine ids match the MCP server names install-skills.ps1
/// registers.
const List<ConnectorEntry> kConnectorCatalog = <ConnectorEntry>[
  // ----- Automation engines (the hands) -----
  ConnectorEntry(
    id: 'windows-desktop-control',
    name: 'Windows apps (UFO²)',
    icon: LucideIcons.app_window,
    description:
        'Drives native Windows apps through their UI — Excel, Word, Settings, '
        'WhatsApp Desktop — using the UIA accessibility tree.',
    developer: 'Microsoft UFO² · Dex driver',
    category: ConnectorCategory.engines,
    probePaths: <String>['mcp.servers.windows-desktop-control'],
    connectHint: 'scripts\\install-skills.ps1 registers this MCP server, '
        'or: dex mcp add windows-desktop-control',
  ),
  ConnectorEntry(
    id: 'browser-control',
    name: 'Browser (browser-use)',
    icon: LucideIcons.globe,
    description:
        'Drives a real browser for anything inside a web page — forms, '
        'navigation, scraping, multi-page flows.',
    developer: 'browser-use · Dex driver',
    category: ConnectorCategory.engines,
    probePaths: <String>['mcp.servers.browser-control'],
    connectHint: 'scripts\\install-skills.ps1 registers this MCP server, '
        'or: dex mcp add browser-control',
  ),
  ConnectorEntry(
    id: 'omniparser',
    name: 'Vision (OmniParser)',
    icon: LucideIcons.scan_eye,
    description:
        'Screen parser for pixel-only surfaces — games, custom-drawn apps, '
        'canvases — when no accessibility tree or DOM exists.',
    developer: 'Microsoft OmniParser · Dex driver',
    category: ConnectorCategory.engines,
    probePaths: <String>['mcp.servers.omniparser'],
    connectHint: 'dex mcp add omniparser (downloads the vision model on '
        'first use, ~2 GB)',
  ),

  // ----- Built-in tools (always on) -----
  ConnectorEntry(
    id: 'shell',
    name: 'Shell & scripts',
    icon: LucideIcons.terminal,
    description:
        'Runs PowerShell / CLI commands directly — the fastest path for '
        'file ops, git, npm, system settings.',
    developer: 'Dex core',
    category: ConnectorCategory.builtins,
    builtin: true,
  ),
  ConnectorEntry(
    id: 'files',
    name: 'Files',
    icon: LucideIcons.folder,
    description: 'Reads, writes, and edits files in the agent workspace.',
    developer: 'Dex core',
    category: ConnectorCategory.builtins,
    builtin: true,
  ),
  ConnectorEntry(
    id: 'reminders',
    name: 'Reminders & schedules',
    icon: LucideIcons.alarm_clock,
    description:
        'Cron-backed reminders and scheduled actions ("open vtop at 4pm").',
    developer: 'Dex core',
    category: ConnectorCategory.builtins,
    builtin: true,
  ),
  ConnectorEntry(
    id: 'memory',
    name: 'Memory',
    icon: LucideIcons.brain,
    description:
        'Long-term memory the agent reads and writes across sessions.',
    developer: 'Dex core',
    category: ConnectorCategory.builtins,
    builtin: true,
  ),
  ConnectorEntry(
    id: 'web-fetch',
    name: 'Web fetch',
    icon: LucideIcons.download,
    description: 'Fetches and reads web pages and APIs without a browser.',
    developer: 'Dex core',
    category: ConnectorCategory.builtins,
    builtin: true,
  ),

  // ----- Messaging & channels -----
  ConnectorEntry(
    id: 'dex-client',
    name: 'Dex desktop',
    icon: LucideIcons.monitor,
    description: 'This app — the canonical Dex client.',
    developer: 'Dex',
    category: ConnectorCategory.channels,
    builtin: true,
  ),
  ConnectorEntry(
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: LucideIcons.message_circle,
    description:
        'Chat with Dex from WhatsApp; Dex can send messages and files to '
        'you or your contacts.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.whatsapp', 'plugins.entries.whatsapp'],
    connectHint: 'dex channels add whatsapp  (scan the QR with your phone)',
  ),
  ConnectorEntry(
    id: 'telegram',
    name: 'Telegram',
    icon: LucideIcons.send,
    description: 'Talk to Dex through a Telegram bot.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.telegram', 'plugins.entries.telegram'],
    connectHint: 'dex channels add telegram  (needs a @BotFather bot token)',
  ),
  ConnectorEntry(
    id: 'discord',
    name: 'Discord',
    icon: LucideIcons.gamepad_2,
    description: 'Dex as a Discord bot in your server or DMs.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.discord', 'plugins.entries.discord'],
    connectHint: 'dex channels add discord',
  ),
  ConnectorEntry(
    id: 'slack',
    name: 'Slack',
    icon: LucideIcons.hash,
    description: 'Dex inside your Slack workspace.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.slack', 'plugins.entries.slack'],
    connectHint: 'dex channels add slack',
  ),
  ConnectorEntry(
    id: 'signal',
    name: 'Signal',
    icon: LucideIcons.radio,
    description: 'Private messaging with Dex over Signal.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.signal', 'plugins.entries.signal'],
    connectHint: 'dex channels add signal',
  ),
  ConnectorEntry(
    id: 'imessage',
    name: 'iMessage',
    icon: LucideIcons.message_square,
    description: 'Dex over iMessage (requires a paired Mac).',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.imessage', 'plugins.entries.imessage'],
    connectHint: 'dex channels add imessage',
  ),
  ConnectorEntry(
    id: 'matrix',
    name: 'Matrix',
    icon: LucideIcons.grid_3x3,
    description: 'Dex on any Matrix homeserver.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.matrix', 'plugins.entries.matrix'],
    connectHint: 'dex channels add matrix',
  ),
  ConnectorEntry(
    id: 'msteams',
    name: 'Microsoft Teams',
    icon: LucideIcons.users,
    description: 'Dex in Teams chats and channels.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.msteams', 'plugins.entries.msteams'],
    connectHint: 'dex channels add msteams',
  ),
  ConnectorEntry(
    id: 'googlechat',
    name: 'Google Chat',
    icon: LucideIcons.message_square_text,
    description: 'Dex in Google Chat spaces.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.googlechat', 'plugins.entries.googlechat'],
    connectHint: 'dex channels add googlechat',
  ),
  ConnectorEntry(
    id: 'voice-call',
    name: 'Voice calls',
    icon: LucideIcons.phone,
    description: 'Call Dex and talk to it over the phone.',
    developer: 'Dex channel plugin',
    category: ConnectorCategory.channels,
    probePaths: <String>['channels.voice-call', 'plugins.entries.voice-call'],
    connectHint: 'dex channels add voice-call',
  ),

  // ----- AI providers (the brain) -----
  ConnectorEntry(
    id: 'anthropic',
    name: 'Anthropic Claude',
    icon: LucideIcons.sparkles,
    description: 'Claude models for reasoning, planning, and vision.',
    developer: 'Anthropic',
    category: ConnectorCategory.providers,
    probePaths: <String>[
      'models.providers.anthropic',
      'auth.profiles.anthropic:default',
      'plugins.entries.anthropic',
    ],
    connectHint: 'dex onboard — paste an Anthropic API key, or sign in '
        'with Claude Code (console.anthropic.com/account/keys)',
  ),
  ConnectorEntry(
    id: 'google',
    name: 'Google Gemini',
    icon: LucideIcons.diamond,
    description:
        'Gemini models — fast, multimodal, with a generous free tier.',
    developer: 'Google',
    category: ConnectorCategory.providers,
    probePaths: <String>[
      'models.providers.google',
      'auth.profiles.google:default',
      'plugins.entries.google',
    ],
    connectHint: 'dex onboard — paste a Gemini API key '
        '(aistudio.google.com/app/apikey)',
  ),
  ConnectorEntry(
    id: 'groq',
    name: 'Groq',
    icon: LucideIcons.zap,
    description:
        'Ultra-fast inference for the automation engines (UFO², browser-use).',
    developer: 'Groq',
    category: ConnectorCategory.providers,
    probePaths: <String>[
      'models.providers.groq',
      'auth.profiles.groq:default',
      'plugins.entries.groq',
    ],
    connectHint: 'Paste a Groq key in Settings (console.groq.com/keys)',
  ),
  ConnectorEntry(
    id: 'openai',
    name: 'OpenAI',
    icon: LucideIcons.bot,
    description: 'GPT models as an alternative brain.',
    developer: 'OpenAI',
    category: ConnectorCategory.providers,
    probePaths: <String>[
      'models.providers.openai',
      'auth.profiles.openai:default',
      'plugins.entries.openai',
    ],
    connectHint: 'dex onboard (platform.openai.com/api-keys)',
  ),
  ConnectorEntry(
    id: 'openrouter',
    name: 'OpenRouter',
    icon: LucideIcons.route,
    description: 'One key, many models — routes to every major provider.',
    developer: 'OpenRouter',
    category: ConnectorCategory.providers,
    probePaths: <String>[
      'models.providers.openrouter',
      'plugins.entries.openrouter',
    ],
    connectHint: 'dex onboard (openrouter.ai/keys)',
  ),
  ConnectorEntry(
    id: 'ollama',
    name: 'Ollama (local)',
    icon: LucideIcons.cpu,
    description: 'Run open models fully offline on your own GPU.',
    developer: 'Ollama',
    category: ConnectorCategory.providers,
    probePaths: <String>[
      'models.providers.ollama',
      'plugins.entries.ollama',
    ],
    connectHint: 'Install Ollama, then: dex onboard',
  ),
  ConnectorEntry(
    id: 'mistral',
    name: 'Mistral',
    icon: LucideIcons.wind,
    description: 'Mistral models (console.mistral.ai).',
    developer: 'Mistral AI',
    category: ConnectorCategory.providers,
    probePaths: <String>[
      'models.providers.mistral',
      'plugins.entries.mistral',
    ],
    connectHint: 'dex onboard (console.mistral.ai/api-keys)',
  ),
  ConnectorEntry(
    id: 'xai',
    name: 'xAI Grok',
    icon: LucideIcons.x,
    description: 'Grok models from xAI.',
    developer: 'xAI',
    category: ConnectorCategory.providers,
    probePaths: <String>['models.providers.xai', 'plugins.entries.xai'],
    connectHint: 'dex onboard',
  ),

  // ----- Web & search -----
  ConnectorEntry(
    id: 'brave',
    name: 'Brave Search',
    icon: LucideIcons.search,
    description: 'Web search results for the agent.',
    developer: 'Brave',
    category: ConnectorCategory.web,
    probePaths: <String>['plugins.entries.brave', 'tools.web.search.brave'],
    connectHint: 'dex plugins enable brave (brave.com/search/api)',
  ),
  ConnectorEntry(
    id: 'tavily',
    name: 'Tavily',
    icon: LucideIcons.compass,
    description: 'Search API tuned for AI agents.',
    developer: 'Tavily',
    category: ConnectorCategory.web,
    probePaths: <String>['plugins.entries.tavily'],
    connectHint: 'dex plugins enable tavily (app.tavily.com)',
  ),
  ConnectorEntry(
    id: 'firecrawl',
    name: 'Firecrawl',
    icon: LucideIcons.flame,
    description: 'Turns whole websites into clean agent-readable text.',
    developer: 'Firecrawl',
    category: ConnectorCategory.web,
    probePaths: <String>['plugins.entries.firecrawl'],
    connectHint: 'dex plugins enable firecrawl (firecrawl.dev)',
  ),
  ConnectorEntry(
    id: 'exa',
    name: 'Exa',
    icon: LucideIcons.telescope,
    description: 'Semantic web search for research-grade lookups.',
    developer: 'Exa',
    category: ConnectorCategory.web,
    probePaths: <String>['plugins.entries.exa'],
    connectHint: 'dex plugins enable exa (dashboard.exa.ai)',
  ),
  ConnectorEntry(
    id: 'perplexity',
    name: 'Perplexity',
    icon: LucideIcons.circle_question_mark,
    description: 'Answer-engine queries with cited sources.',
    developer: 'Perplexity',
    category: ConnectorCategory.web,
    probePaths: <String>['plugins.entries.perplexity'],
    connectHint: 'dex plugins enable perplexity',
  ),

  // ----- Speech & voice -----
  ConnectorEntry(
    id: 'elevenlabs',
    name: 'ElevenLabs',
    icon: LucideIcons.audio_lines,
    description: 'Natural text-to-speech voices for Dex voice mode.',
    developer: 'ElevenLabs',
    category: ConnectorCategory.speech,
    probePaths: <String>['plugins.entries.elevenlabs'],
    connectHint: 'dex plugins enable elevenlabs (elevenlabs.io)',
  ),
  ConnectorEntry(
    id: 'deepgram',
    name: 'Deepgram',
    icon: LucideIcons.mic,
    description: 'Speech-to-text for voice input.',
    developer: 'Deepgram',
    category: ConnectorCategory.speech,
    probePaths: <String>['plugins.entries.deepgram'],
    connectHint: 'dex plugins enable deepgram (console.deepgram.com)',
  ),
  ConnectorEntry(
    id: 'azure-speech',
    name: 'Azure Speech',
    icon: LucideIcons.cloud,
    description: 'Microsoft speech services (STT + TTS).',
    developer: 'Microsoft',
    category: ConnectorCategory.speech,
    probePaths: <String>['plugins.entries.azure-speech'],
    connectHint: 'dex plugins enable azure-speech',
  ),
];

/// One installed (bundled or workspace) skill from the gateway's
/// `skills.status` report (SkillStatusEntry in dex-core).
class SkillInfo {
  const SkillInfo({
    required this.name,
    required this.description,
    required this.bundled,
    required this.eligible,
    required this.disabled,
    this.emoji,
    this.homepage,
  });

  final String name;
  final String description;
  final bool bundled;
  final bool eligible;
  final bool disabled;
  final String? emoji;
  final String? homepage;

  static SkillInfo? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final name = raw['name'];
    if (name is! String || name.isEmpty) return null;
    return SkillInfo(
      name: name,
      description: (raw['description'] as String?) ?? '',
      bundled: raw['bundled'] == true,
      eligible: raw['eligible'] == true,
      disabled: raw['disabled'] == true,
      emoji: raw['emoji'] as String?,
      homepage: raw['homepage'] as String?,
    );
  }
}

/// One remote skill from the ClawHub registry (`skills.search`).
class RemoteSkill {
  const RemoteSkill({
    required this.slug,
    required this.name,
    required this.description,
  });

  final String slug;
  final String name;
  final String description;

  static RemoteSkill? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final slug = (raw['slug'] ?? raw['name'] ?? raw['id']) as Object?;
    if (slug is! String || slug.isEmpty) return null;
    return RemoteSkill(
      slug: slug,
      name: (raw['displayName'] ?? raw['title'] ?? raw['name'] ?? slug)
          .toString(),
      description:
          (raw['description'] ?? raw['summary'] ?? '').toString(),
    );
  }
}

/// Fetches the gateway config snapshot + installed-skills report and
/// exposes live connector statuses, plus ClawHub search/install.
/// Tolerant of a dead gateway: everything stays empty/Available.
class ConnectorsStore extends ChangeNotifier {
  ConnectorsStore();

  Map<String, dynamic>? _config;
  List<SkillInfo> _skills = const <SkillInfo>[];
  List<RemoteSkill> _searchResults = const <RemoteSkill>[];
  bool _loading = false;
  bool _searching = false;
  String? _error;
  String? _installNote;
  final Set<String> _installing = <String>{};

  Map<String, dynamic>? get config => _config;
  List<SkillInfo> get skills => _skills;
  List<RemoteSkill> get searchResults => _searchResults;
  bool get loading => _loading;
  bool get searching => _searching;
  String? get error => _error;
  String? get installNote => _installNote;
  bool isInstalling(String slug) => _installing.contains(slug);

  int get connectedCount =>
      kConnectorCatalog
          .where((e) => e.statusIn(_config) == ConnectorStatus.connected)
          .length +
      _skills.where((s) => s.eligible && !s.disabled).length;

  Future<void> refresh() async {
    final client = GatewayClient.current;
    if (client == null) return;
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      // config.get responds with a redacted ConfigFileSnapshot; the
      // parsed config object lives under one of these keys depending
      // on dex-core version.
      final payload = await client.request('config.get');
      final cfg = payload['config'] ?? payload['parsed'] ?? payload;
      _config = (cfg is Map) ? cfg.cast<String, dynamic>() : null;
    } catch (e) {
      _error = e.toString();
      debugPrint('[dex] connectors config.get failed: $e');
    }
    try {
      // SkillStatusReport: {workspaceDir, skills: SkillStatusEntry[]}.
      final report = await client.request('skills.status');
      final raw = report['skills'];
      _skills = raw is List
          ? raw
              .map(SkillInfo.fromJson)
              .whereType<SkillInfo>()
              .toList(growable: false)
          : const <SkillInfo>[];
    } catch (e) {
      debugPrint('[dex] connectors skills.status failed: $e');
    }
    _loading = false;
    notifyListeners();
  }

  /// ClawHub keyword search (the registry behind
  /// docs.openclaw.ai/tools/skills). Results render with Install buttons.
  Future<void> searchRemote(String query) async {
    final client = GatewayClient.current;
    final q = query.trim();
    if (client == null || q.isEmpty) return;
    _searching = true;
    notifyListeners();
    try {
      final payload = await client.request(
        'skills.search',
        params: <String, dynamic>{'query': q, 'limit': 12},
        timeout: const Duration(seconds: 20),
      );
      final raw = payload['results'];
      _searchResults = raw is List
          ? raw
              .map(RemoteSkill.fromJson)
              .whereType<RemoteSkill>()
              .toList(growable: false)
          : const <RemoteSkill>[];
    } catch (e) {
      _installNote = 'Skill search failed: $e';
      debugPrint('[dex] skills.search failed: $e');
    } finally {
      _searching = false;
      notifyListeners();
    }
  }

  void clearSearch() {
    if (_searchResults.isEmpty && !_searching) return;
    _searchResults = const <RemoteSkill>[];
    _searching = false;
    notifyListeners();
  }

  Future<void> installSkill(String slug) async {
    final client = GatewayClient.current;
    if (client == null || _installing.contains(slug)) return;
    _installing.add(slug);
    _installNote = null;
    notifyListeners();
    try {
      final res = await client.request(
        'skills.install',
        params: <String, dynamic>{'source': 'clawhub', 'slug': slug},
        timeout: const Duration(seconds: 60),
      );
      _installNote =
          (res['message'] as String?) ?? 'Installed $slug';
      await refresh();
    } catch (e) {
      _installNote = 'Install failed: $e';
      debugPrint('[dex] skills.install($slug) failed: $e');
    } finally {
      _installing.remove(slug);
      notifyListeners();
    }
  }
}
