// Attachments — files / images / pasted text that ride along with the
// user's next prompt. Populated by the composer's DropRegion + Ctrl+V
// paste handler (and the spotlight overlay's same wiring), rendered as
// a horizontal chip strip above the input.

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:super_clipboard/super_clipboard.dart';
import 'package:super_drag_and_drop/super_drag_and_drop.dart';
import 'package:uuid/uuid.dart';

import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../glass_badge_button.dart';

enum AttachmentKind { image, file, text }

class AttachedItem {
  AttachedItem({
    required this.id,
    required this.kind,
    required this.name,
    this.fileUri,
    this.imageBytes,
    this.text,
  });

  factory AttachedItem.fromFileUri(Uri uri) {
    final name = _basename(uri);
    return AttachedItem(
      id: const Uuid().v4(),
      kind: AttachmentKind.file,
      name: name,
      fileUri: uri,
    );
  }

  factory AttachedItem.fromImage(Uint8List bytes, {String? name}) {
    return AttachedItem(
      id: const Uuid().v4(),
      kind: AttachmentKind.image,
      name: name ?? 'pasted-image.png',
      imageBytes: bytes,
    );
  }

  factory AttachedItem.fromLongText(String text) {
    final preview = text.length > 40 ? '${text.substring(0, 40)}…' : text;
    return AttachedItem(
      id: const Uuid().v4(),
      kind: AttachmentKind.text,
      name: preview.replaceAll('\n', ' '),
      text: text,
    );
  }

  final String id;
  final AttachmentKind kind;
  final String name;
  final Uri? fileUri;
  final Uint8List? imageBytes;
  final String? text;

  IconData get icon => switch (kind) {
        AttachmentKind.image => LucideIcons.image,
        AttachmentKind.file => LucideIcons.file,
        AttachmentKind.text => LucideIcons.type,
      };

  /// Length text rendered under the name on the chip (right side).
  String get sublabel => switch (kind) {
        AttachmentKind.image when imageBytes != null =>
          _humanBytes(imageBytes!.length),
        AttachmentKind.file => 'file',
        AttachmentKind.text => 'text',
        _ => '',
      };

  static String _basename(Uri uri) {
    final parts = uri.pathSegments;
    if (parts.isEmpty) return uri.toString();
    return parts.last.isEmpty
        ? (parts.length > 1 ? parts[parts.length - 2] : uri.toString())
        : parts.last;
  }

  static String _humanBytes(int n) {
    if (n < 1024) return '${n}B';
    if (n < 1024 * 1024) return '${(n / 1024).toStringAsFixed(0)}KB';
    return '${(n / 1024 / 1024).toStringAsFixed(1)}MB';
  }
}

/// Drop formats the composer/spotlight accepts. Order matters for the
/// "did this item provide X?" checks — we prefer file URIs (cleanest
/// reference) over raw image bytes over plain text.
final List<DataFormat<Object>> kAcceptedDropFormats = <DataFormat<Object>>[
  Formats.fileUri,
  Formats.png,
  Formats.jpeg,
  Formats.gif,
  Formats.webp,
  Formats.bmp,
  Formats.plainText,
  Formats.uri,
  Formats.htmlText,
];

/// Read all items from a [DropEvent] and turn them into [AttachedItem]s.
/// Failures on individual readers are swallowed (with debug logs) so a
/// mixed-format drag (e.g. an image PLUS a stray hidden text rep) still
/// completes for the items that succeeded.
Future<List<AttachedItem>> extractDroppedItems(
  PerformDropEvent event,
) async {
  final out = <AttachedItem>[];
  for (final item in event.session.items) {
    final reader = item.dataReader;
    if (reader == null) continue;
    try {
      final added = await _readItem(reader);
      if (added != null) out.add(added);
    } catch (e, st) {
      debugPrint('[dex] drop reader failed: $e\n$st');
    }
  }
  return out;
}

/// Read the user's clipboard (Ctrl+V path) and produce attachments for
/// any non-plaintext payload (image, file, big text). Returns an empty
/// list when only short plain text is on the clipboard — that path is
/// left to the default TextField paste so short text still flows into
/// the input box rather than appearing as a chip.
Future<List<AttachedItem>> extractClipboardItems() async {
  final clipboard = SystemClipboard.instance;
  if (clipboard == null) return const [];
  final reader = await clipboard.read();
  try {
    final attachment = await _readItem(reader);
    if (attachment != null) {
      // Skip "short text" chips — short plain text should land in the
      // input via the default paste behaviour.
      if (attachment.kind == AttachmentKind.text &&
          (attachment.text?.length ?? 0) < 200) {
        return const [];
      }
      return <AttachedItem>[attachment];
    }
    return const [];
  } catch (e, st) {
    debugPrint('[dex] clipboard reader failed: $e\n$st');
    return const [];
  }
}

Future<AttachedItem?> _readItem(DataReader reader) async {
  // File URI -- the cleanest reference; never copies bytes.
  if (reader.canProvide(Formats.fileUri)) {
    final completer = Completer<AttachedItem?>();
    reader.getValue<Uri>(Formats.fileUri, (uri) {
      if (uri == null) {
        completer.complete(null);
        return;
      }
      completer.complete(AttachedItem.fromFileUri(uri));
    }, onError: (e) {
      debugPrint('[dex] fileUri read failed: $e');
      completer.complete(null);
    });
    return completer.future;
  }

  // Image bytes -- ride this path when the drag/paste source put raw
  // image data on the clipboard instead of a file reference (typical
  // for "copy image" from a browser).
  for (final fmt in <FileFormat>[
    Formats.png,
    Formats.jpeg,
    Formats.gif,
    Formats.webp,
    Formats.bmp,
  ]) {
    if (reader.canProvide(fmt)) {
      final completer = Completer<AttachedItem?>();
      reader.getFile(fmt, (file) async {
        try {
          final bytes = await file.readAll();
          completer.complete(AttachedItem.fromImage(bytes));
        } catch (e) {
          debugPrint('[dex] image read failed: $e');
          completer.complete(null);
        }
      }, onError: (e) {
        debugPrint('[dex] image file open failed: $e');
        completer.complete(null);
      });
      return completer.future;
    }
  }

  // Long text -- 200+ chars; chip representation. Short text falls
  // through to caller (so it lands in the input box).
  if (reader.canProvide(Formats.plainText)) {
    final completer = Completer<AttachedItem?>();
    reader.getValue<String>(Formats.plainText, (text) {
      if (text == null || text.isEmpty) {
        completer.complete(null);
        return;
      }
      completer.complete(AttachedItem.fromLongText(text));
    }, onError: (e) {
      debugPrint('[dex] text read failed: $e');
      completer.complete(null);
    });
    return completer.future;
  }

  return null;
}

/// Horizontal scrollable chip strip rendered above the composer input
/// when [items] is non-empty. Each chip shows file-type icon, name,
/// sublabel, and a ✕ to remove. Tap the ✕ to remove via [onRemove].
class AttachmentStrip extends StatelessWidget {
  const AttachmentStrip({
    super.key,
    required this.items,
    required this.onRemove,
  });

  final List<AttachedItem> items;
  final ValueChanged<String> onRemove;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return AnimatedSize(
      duration: DexMotion.respecting(context, DexMotion.medium),
      curve: DexMotion.respectingCurve(context, DexMotion.dampened),
      alignment: Alignment.topCenter,
      child: Padding(
        padding: const EdgeInsets.only(bottom: DexSpace.sm),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final item in items) ...[
                _AttachmentChip(
                  item: item,
                  onRemove: () => onRemove(item.id),
                ),
                const SizedBox(width: DexSpace.xs),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _AttachmentChip extends StatelessWidget {
  const _AttachmentChip({required this.item, required this.onRemove});
  final AttachedItem item;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 240),
      child: GlassContainer(
      useOwnLayer: true,
      // Neutral clear-crystal glass (no blue accent), minimal quality so the
      // chip rim doesn't flicker over the drifting fog.
      quality: GlassQuality.minimal,
      shape: const LiquidRoundedSuperellipse(borderRadius: 16),
      settings: const LiquidGlassSettings(
        glassColor: Color.fromRGBO(255, 255, 255, 0.10),
        blur: 8,
        thickness: 10,
      ),
      padding: const EdgeInsets.fromLTRB(
        DexSpace.sm, 4, 4, 4,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (item.kind == AttachmentKind.image && item.imageBytes != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: Image.memory(
                item.imageBytes!,
                width: 20,
                height: 20,
                fit: BoxFit.cover,
              ),
            )
          else
            Icon(item.icon, size: 14, color: DexColors.textDim),
          const SizedBox(width: DexSpace.xs),
          Flexible(
            child: Text(
              item.name,
              style: DexType.caption(color: DexColors.text),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (item.sublabel.isNotEmpty) ...[
            const SizedBox(width: 4),
            Text(item.sublabel,
                style: DexType.caption(color: DexColors.textFaint)),
          ],
          const SizedBox(width: 4),
          GlassBadgeButton(
            icon: LucideIcons.x,
            onTap: onRemove,
            size: 20,
            iconColor: DexColors.stateError,
            glowColor: DexColors.stateError,
          ),
        ],
      ),
      ),
    );
  }
}
