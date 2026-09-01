// What Dex thinks with, as the core describes it.
//
// The catalogue is not restated here. Which providers exist, which models
// Claude Code offers, what each credential powers and where to get one all
// arrive over the wire from core/settings/provider_catalog.ts — so the screen
// and the engine cannot disagree about what is available.

class BrainProvider {
  const BrainProvider({
    required this.id,
    required this.label,
    required this.credential,
    required this.defaultModel,
    required this.blurb,
  });

  final String id;
  final String label;

  /// The credential it needs, or null when it authenticates another way.
  /// Null is exactly what makes Claude Code different: nothing to paste.
  final String? credential;

  final String defaultModel;
  final String blurb;

  bool get needsKey => credential != null;

  factory BrainProvider.fromJson(Map<String, dynamic> json) => BrainProvider(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        credential: json['credential'] as String?,
        defaultModel: json['defaultModel'] as String? ?? '',
        blurb: json['blurb'] as String? ?? '',
      );
}

class ClaudeModel {
  const ClaudeModel({
    required this.id,
    required this.label,
    required this.blurb,
    this.recommended = false,
  });

  final String id;
  final String label;
  final String blurb;
  final bool recommended;

  factory ClaudeModel.fromJson(Map<String, dynamic> json) => ClaudeModel(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        blurb: json['blurb'] as String? ?? '',
        recommended: json['recommended'] as bool? ?? false,
      );
}

/// Whether Claude Code can actually be used on this machine.
///
/// Two failures with two different fixes — not installed, and installed but
/// signed out. The card shows whichever applies and offers the matching
/// action, because "unavailable" on its own tells you nothing you can act on.
class ClaudeStatus {
  const ClaudeStatus({
    required this.installed,
    required this.signedIn,
    this.version,
    this.reason,
  });

  final bool installed;
  final bool signedIn;
  final String? version;
  final String? reason;

  bool get usable => installed && signedIn;

  factory ClaudeStatus.fromJson(Map<String, dynamic> json) => ClaudeStatus(
        installed: json['installed'] as bool? ?? false,
        signedIn: json['signedIn'] as bool? ?? false,
        version: json['version'] as String?,
        reason: json['reason'] as String?,
      );

  static const unknown = ClaudeStatus(installed: false, signedIn: false);
}

class CredentialStatus {
  const CredentialStatus({
    required this.name,
    required this.label,
    required this.group,
    required this.powers,
    required this.source,
    required this.stored,
    this.url,
    this.note,
    this.hint,
  });

  final String name;
  final String label;
  final String group;

  /// What stops working without it.
  final String powers;
  final String source;
  final String? url;

  /// The part people get wrong — free-tier limits, extra steps.
  final String? note;

  final bool stored;

  /// Last four characters of a stored key, and never more. Enough to tell
  /// which key it is; not enough to use.
  final String? hint;

  factory CredentialStatus.fromJson(Map<String, dynamic> json) => CredentialStatus(
        name: json['name'] as String? ?? '',
        label: json['label'] as String? ?? '',
        group: json['group'] as String? ?? '',
        powers: json['powers'] as String? ?? '',
        source: json['source'] as String? ?? '',
        url: json['url'] as String?,
        note: json['note'] as String?,
        stored: json['stored'] as bool? ?? false,
        hint: json['hint'] as String?,
      );
}

class BrainSettings {
  const BrainSettings({
    required this.providers,
    required this.claudeModels,
    required this.credentials,
    required this.claude,
    required this.provider,
    required this.model,
  });

  final List<BrainProvider> providers;
  final List<ClaudeModel> claudeModels;
  final List<CredentialStatus> credentials;
  final ClaudeStatus claude;

  /// The provider that will actually answer — not merely the one written down.
  final String provider;
  final String model;

  bool get usingClaudeCode => provider == 'claude-code';

  List<CredentialStatus> get brainKeys =>
      credentials.where((c) => c.group == 'brain' || c.group == 'vision').toList();

  CredentialStatus? credential(String name) {
    for (final c in credentials) {
      if (c.name == name) return c;
    }
    return null;
  }

  factory BrainSettings.fromJson(Map<String, dynamic> json) {
    final brain = (json['brain'] as Map?)?.cast<String, dynamic>() ?? const {};
    return BrainSettings(
      providers: ((json['brainProviders'] as List?) ?? const [])
          .map((p) => BrainProvider.fromJson(Map<String, dynamic>.from(p as Map)))
          .toList(),
      claudeModels: ((json['claudeModels'] as List?) ?? const [])
          .map((m) => ClaudeModel.fromJson(Map<String, dynamic>.from(m as Map)))
          .toList(),
      credentials: ((json['credentials'] as List?) ?? const [])
          .map((c) => CredentialStatus.fromJson(Map<String, dynamic>.from(c as Map)))
          .toList(),
      claude: json['claudeCode'] == null
          ? ClaudeStatus.unknown
          : ClaudeStatus.fromJson(
              Map<String, dynamic>.from(json['claudeCode'] as Map)),
      provider: brain['provider'] as String? ?? '',
      model: brain['model'] as String? ?? '',
    );
  }
}
