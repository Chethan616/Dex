/// Mirrors of `core/settings/provider_catalog.ts` and `settings_service.ts`.
///
/// The catalogue itself is deliberately *not* duplicated here. Which
/// credentials exist, what each one powers and where to get one all come down
/// the wire, so Settings renders whatever the core says and the two can never
/// disagree about it. Only the shapes live in Dart.
library;

class CredentialStatus {
  const CredentialStatus({
    required this.name,
    required this.label,
    required this.group,
    required this.powers,
    required this.source,
    required this.stored,
    required this.fromEnvironment,
    required this.secret,
    this.url,
    this.note,
    this.hint,
  });

  final String name;
  final String label;

  /// `brain`, `vision`, `workspace` or `channels`.
  final String group;

  /// What stops working without it.
  final String powers;

  /// Where to get one.
  final String source;
  final String? url;

  /// The part people get wrong — free-tier limits, extra steps.
  final String? note;

  final bool stored;

  /// Present in the environment but not the encrypted store. Works, but is not
  /// where a secret should live, and Settings says so.
  final bool fromEnvironment;

  final bool secret;

  /// Last four characters of a stored value, so you can tell which key it is.
  ///
  /// Never more than four, and never the value itself. The core enforces this;
  /// the field is this short because there is nothing longer to receive.
  final String? hint;

  bool get present => stored || fromEnvironment;

  factory CredentialStatus.fromJson(Map<String, dynamic> json) => CredentialStatus(
        name: json['name'] as String? ?? '',
        label: json['label'] as String? ?? '',
        group: json['group'] as String? ?? 'brain',
        powers: json['powers'] as String? ?? '',
        source: json['source'] as String? ?? '',
        url: json['url'] as String?,
        note: json['note'] as String?,
        stored: json['stored'] as bool? ?? false,
        fromEnvironment: json['fromEnvironment'] as bool? ?? false,
        secret: json['secret'] as bool? ?? true,
        hint: json['hint'] as String?,
      );
}

class BrainProviderSpec {
  const BrainProviderSpec({
    required this.id,
    required this.label,
    required this.credential,
    required this.defaultModel,
    required this.blurb,
  });

  final String id;
  final String label;

  /// The credential it needs, or null when it authenticates some other way —
  /// which is exactly what makes the Claude Code option different.
  final String? credential;

  final String defaultModel;
  final String blurb;

  factory BrainProviderSpec.fromJson(Map<String, dynamic> json) => BrainProviderSpec(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        credential: json['credential'] as String?,
        defaultModel: json['defaultModel'] as String? ?? '',
        blurb: json['blurb'] as String? ?? '',
      );
}

/// Whether the Claude Code path is actually available on this machine.
///
/// Two separate failures with two different fixes: not installed, and
/// installed but not signed in. The card shows whichever applies rather than a
/// single "unavailable", because "run `claude` and log in" is only the answer
/// to the second one.
class ClaudeCodeStatus {
  const ClaudeCodeStatus({
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

  factory ClaudeCodeStatus.fromJson(Map<String, dynamic> json) => ClaudeCodeStatus(
        installed: json['installed'] as bool? ?? false,
        signedIn: json['signedIn'] as bool? ?? false,
        version: json['version'] as String?,
        reason: json['reason'] as String?,
      );

  static const unknown = ClaudeCodeStatus(installed: false, signedIn: false);
}

class ProviderTestResult {
  const ProviderTestResult({
    required this.ok,
    required this.provider,
    required this.latencyMs,
    this.error,
  });

  final bool ok;
  final String provider;
  final int latencyMs;

  /// The provider's own words. "Your credit ran out" and "that key was
  /// revoked" both live here, and neither is something Dex could infer.
  final String? error;

  factory ProviderTestResult.fromJson(Map<String, dynamic> json) => ProviderTestResult(
        ok: json['ok'] as bool? ?? false,
        provider: json['provider'] as String? ?? '',
        latencyMs: json['latencyMs'] as int? ?? 0,
        error: json['error'] as String?,
      );
}

class SettingsSnapshot {
  const SettingsSnapshot({
    required this.credentials,
    required this.brainProviders,
    required this.brainProvider,
    required this.brainModel,
    required this.claudeCode,
    required this.env,
    required this.credentialStore,
    required this.envFile,
  });

  final List<CredentialStatus> credentials;
  final List<BrainProviderSpec> brainProviders;
  final String brainProvider;
  final String brainModel;
  final ClaudeCodeStatus claudeCode;
  final Map<String, String> env;

  /// Shown in Settings so the owner can find their own encrypted store.
  final String credentialStore;
  final String envFile;

  List<CredentialStatus> inGroup(String group) =>
      credentials.where((c) => c.group == group).toList();

  bool get usingClaudeCode => brainProvider == 'claude-code';

  factory SettingsSnapshot.fromJson(Map<String, dynamic> json) {
    final brain = (json['brain'] as Map?)?.cast<String, dynamic>() ?? const {};
    return SettingsSnapshot(
      credentials: ((json['credentials'] as List?) ?? const [])
          .map((c) => CredentialStatus.fromJson(Map<String, dynamic>.from(c as Map)))
          .toList(),
      brainProviders: ((json['brainProviders'] as List?) ?? const [])
          .map((p) => BrainProviderSpec.fromJson(Map<String, dynamic>.from(p as Map)))
          .toList(),
      brainProvider: brain['provider'] as String? ?? '',
      brainModel: brain['model'] as String? ?? '',
      claudeCode: json['claudeCode'] == null
          ? ClaudeCodeStatus.unknown
          : ClaudeCodeStatus.fromJson(
              Map<String, dynamic>.from(json['claudeCode'] as Map)),
      env: ((json['env'] as Map?) ?? const {})
          .map((k, v) => MapEntry(k as String, '$v')),
      credentialStore: json['credentialStore'] as String? ?? '',
      envFile: json['envFile'] as String? ?? '',
    );
  }
}
