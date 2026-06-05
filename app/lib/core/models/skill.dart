// A registered Dex skill, surfaced in the left rail so the user can see what
// their assistant can do. Read-only in v1 (no toggle); Phase 7 may add an
// on/off switch backed by the gateway's MCP enable/disable.

class Skill {
  final String name;
  final String description;
  final bool enabled;

  const Skill({
    required this.name,
    required this.description,
    this.enabled = true,
  });
}
