// Shared prompt-history ring buffer. The composer (main window) and the
// Spotlight overlay both push submitted prompts here; up-arrow in either
// input recalls them shell-style. In-memory per app run — persistence to
// disk is a non-goal (matches terminal behavior users already expect).

class PromptHistory {
  PromptHistory._();
  static final PromptHistory instance = PromptHistory._();

  static const int _cap = 200;

  final List<String> _entries = <String>[];

  /// Oldest → newest.
  List<String> get entries => List.unmodifiable(_entries);

  void push(String text) {
    final t = text.trim();
    if (t.isEmpty) return;
    // Repeating the same prompt shouldn't create duplicate history slots.
    if (_entries.isNotEmpty && _entries.last == t) return;
    _entries.add(t);
    if (_entries.length > _cap) _entries.removeAt(0);
  }
}
