// One capability, and whether Dex can use it right now.
//
// Mirrors CapabilityHealth in core/settings/settings_service.ts, which probes
// each one rather than reporting a static list: the daemon by looking for its
// named pipe, the agents by connecting to their ports, the chat channels by
// whether both halves of their configuration are present.

class CapabilityHealth {
  const CapabilityHealth({
    required this.id,
    required this.name,
    required this.group,
    required this.detail,
    required this.ok,
    this.reason,
  });

  final String id;
  final String name;

  /// `built in`, `agents`, `chat`, `accounts`.
  final String group;

  final String detail;
  final bool ok;

  /// What to do about it. The useful half when something is down —
  /// "unavailable" is not a next step; "add a bot token" is.
  final String? reason;

  factory CapabilityHealth.fromJson(Map<String, dynamic> json) => CapabilityHealth(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        group: json['group'] as String? ?? '',
        detail: json['detail'] as String? ?? '',
        ok: json['ok'] as bool? ?? false,
        reason: json['reason'] as String?,
      );
}
