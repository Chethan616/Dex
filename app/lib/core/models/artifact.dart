// What a step produced, when it has enough structure to be drawn.
//
// A file search that finds twenty documents used to arrive as a paragraph:
// `matches name=… path=… directory=…, name=… (+12 more)` — every path three
// times, in prose. The list is a list; it belongs in rows the owner can scan
// and click, with the sentence above it saying only what a sentence says well.
//
// The core decides what is worth drawing (`core/events/artifacts.ts`) and
// sends a fixed shape. This is the other half of that contract.

class ArtifactItem {
  const ArtifactItem({
    required this.label,
    this.detail,
    this.reasons = const <String>[],
    this.excerpt,
    this.bytes,
    this.modified,
  });

  /// Filename, or whatever the row is called.
  final String label;

  /// Full path. Shown small underneath, and what a click opens.
  final String? detail;

  /// Why this is in the answer — 'filename', 'OCR text', 'also called "uid"'.
  /// A result with no stated reason is a result the owner has to take on
  /// trust, which is how fifty build artifacts once passed for an answer.
  final List<String> reasons;

  /// A line of the matching text, when the match was on content rather than
  /// name. This is what shows that a file called `scan001.jpg` really is the
  /// Aadhaar card.
  final String? excerpt;

  final int? bytes;
  final int? modified;

  static ArtifactItem? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final label = raw['label'];
    if (label is! String || label.isEmpty) return null;
    return ArtifactItem(
      label: label,
      detail: raw['detail'] is String ? raw['detail'] as String : null,
      reasons: raw['reasons'] is List
          ? (raw['reasons'] as List).whereType<String>().toList()
          : const <String>[],
      excerpt: raw['excerpt'] is String && (raw['excerpt'] as String).isNotEmpty
          ? raw['excerpt'] as String
          : null,
      bytes: raw['bytes'] is num ? (raw['bytes'] as num).toInt() : null,
      modified: raw['modified'] is num ? (raw['modified'] as num).toInt() : null,
    );
  }
}

class Artifact {
  const Artifact({
    required this.kind,
    required this.title,
    required this.items,
    required this.total,
    this.note,
    this.body,
    this.file,
  });

  /// 'files' for a list of results, 'reading' for one file that was opened.
  /// Named rather than inferred from which fields are present, so a third
  /// kind does not have to pretend to be one of the first two.
  final String kind;
  final String title;
  final List<ArtifactItem> items;

  /// How many there were, which is not always how many are shown.
  final int total;

  /// What was searched, and how much of it.
  final String? note;

  /// For 'reading': the description or extracted text. The substance of the
  /// card rather than a footnote on it.
  final String? body;

  /// For 'reading': the file on disk. A description of a picture with no
  /// picture asks the owner to take it on faith.
  final String? file;

  /// Returns null for anything that is not a well-formed artifact, so a
  /// malformed frame degrades to the ordinary message rather than an error.
  static Artifact? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final kind = raw['kind'];
    final title = raw['title'];
    if (kind is! String || title is! String) return null;

    final items = <ArtifactItem>[];
    if (raw['items'] is List) {
      for (final entry in raw['items'] as List) {
        final item = ArtifactItem.tryParse(entry);
        if (item != null) items.add(item);
      }
    }
    if (items.isEmpty) return null;

    return Artifact(
      kind: kind,
      title: title,
      items: items,
      total: raw['total'] is num ? (raw['total'] as num).toInt() : items.length,
      note: raw['note'] is String && (raw['note'] as String).isNotEmpty
          ? raw['note'] as String
          : null,
      body: raw['body'] is String && (raw['body'] as String).isNotEmpty
          ? raw['body'] as String
          : null,
      file: raw['file'] is String && (raw['file'] as String).isNotEmpty
          ? raw['file'] as String
          : null,
    );
  }
}
