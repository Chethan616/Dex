// In-app WhatsApp pairing — no command prompt.
//
// Drives the gateway's plugin-owned QR login flow:
//   web.login.start {force, timeoutMs}        -> {qrDataUrl?, connected?}
//   web.login.wait  {timeoutMs, currentQrDataUrl} -> same shape; the QR
//                                                rotates, wait returns the
//                                                fresh one until connected.
// (Schemas: packages/gateway-protocol/src/schema/channels.ts:757-779;
// handlers: src/gateway/server-methods/web.ts. qrDataUrl is a PNG data
// URL, rendered directly with Image.memory.)

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/gateway_client.dart';
import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../dex_glass.dart';
import '../glass_badge_button.dart';
import '../menu_glass.dart';

class WhatsAppPairDialog extends StatefulWidget {
  const WhatsAppPairDialog({super.key});

  /// Returns true when pairing completed.
  static Future<bool> show(BuildContext context) async {
    kGlassMenuOpenCount.value++;
    try {
      final ok = await showGeneralDialog<bool>(
        context: context,
        barrierDismissible: true,
        barrierLabel: 'Dismiss pairing',
        barrierColor: Colors.black.withValues(alpha: 0.4),
        transitionDuration: DexMotion.dialog,
        pageBuilder: (_, _, _) => const WhatsAppPairDialog(),
        transitionBuilder: (ctx, anim, _, child) {
          // if (MediaQuery.of(ctx).disableAnimations) return child;
          // final eased = CurvedAnimation(parent: anim, curve: DexMotion.dampened);
          return DexMotion.buildDialogTransition(ctx, anim, child);
        },
      );
      return ok ?? false;
    } finally {
      kGlassMenuOpenCount.value--;
    }
  }

  @override
  State<WhatsAppPairDialog> createState() => _WhatsAppPairDialogState();
}

enum _PairPhase { starting, scanQr, connected, failed }

class _WhatsAppPairDialogState extends State<WhatsAppPairDialog> {
  _PairPhase _phase = _PairPhase.starting;
  Uint8List? _qrBytes;
  String? _qrDataUrl;
  String? _error;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  Uint8List? _decodeDataUrl(String? dataUrl) {
    if (dataUrl == null) return null;
    final comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    try {
      return base64Decode(dataUrl.substring(comma + 1));
    } catch (_) {
      return null;
    }
  }

  Future<void> _start() async {
    final client = GatewayClient.current;
    if (client == null) {
      setState(() {
        _phase = _PairPhase.failed;
        _error = 'Gateway not connected. Start the Dex gateway first.';
      });
      return;
    }
    try {
      final res = await client.request(
        'web.login.start',
        params: <String, dynamic>{'force': true, 'timeoutMs': 30000},
        timeout: const Duration(seconds: 60),
      );
      if (_disposed) return;
      if (res['connected'] == true) {
        setState(() => _phase = _PairPhase.connected);
        return;
      }
      final qr = res['qrDataUrl'] as String?;
      final bytes = _decodeDataUrl(qr);
      if (bytes == null) {
        setState(() {
          _phase = _PairPhase.failed;
          _error = 'The channel did not produce a QR code. Is the WhatsApp '
              'plugin installed? (Connectors & Apps → WhatsApp)';
        });
        return;
      }
      setState(() {
        _phase = _PairPhase.scanQr;
        _qrBytes = bytes;
        _qrDataUrl = qr;
      });
      unawaited(_waitLoop(client));
    } catch (e) {
      if (_disposed) return;
      setState(() {
        _phase = _PairPhase.failed;
        _error = '$e';
      });
    }
  }

  Future<void> _waitLoop(GatewayClient client) async {
    // Poll until linked; each wait call refreshes the QR if it rotated.
    while (!_disposed && _phase == _PairPhase.scanQr) {
      try {
        final res = await client.request(
          'web.login.wait',
          params: <String, dynamic>{
            'timeoutMs': 25000,
            if (_qrDataUrl != null) 'currentQrDataUrl': _qrDataUrl,
          },
          timeout: const Duration(seconds: 40),
        );
        if (_disposed) return;
        if (res['connected'] == true) {
          setState(() => _phase = _PairPhase.connected);
          return;
        }
        final qr = res['qrDataUrl'] as String?;
        final bytes = _decodeDataUrl(qr);
        if (bytes != null && qr != _qrDataUrl) {
          setState(() {
            _qrBytes = bytes;
            _qrDataUrl = qr;
          });
        }
      } catch (e) {
        if (_disposed) return;
        // Transient wait timeout -- keep looping; hard errors surface.
        if (!'$e'.contains('timed out')) {
          setState(() {
            _phase = _PairPhase.failed;
            _error = '$e';
          });
          return;
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: DexGlass(
            radius: 20,
            rim: false,
            padding: const EdgeInsets.all(DexSpace.xl),
            child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          const Icon(LucideIcons.message_circle,
                              size: 18, color: DexColors.stateApprove),
                          const SizedBox(width: DexSpace.sm),
                          Expanded(
                            child: Text('Pair WhatsApp',
                                style:
                                    DexType.heading(color: DexColors.text)),
                          ),
                          GlassBadgeButton(
                            icon: LucideIcons.x,
                            onTap: () => Navigator.of(context).pop(false),
                            size: 30,
                            iconColor: DexColors.stateError,
                            glowColor: DexColors.stateError,
                          ),
                        ],
                      ),
                      const SizedBox(height: DexSpace.md),
                      ..._body(context),
                    ],
                  ),
            ),
          ),
        ),
    );
  }

  List<Widget> _body(BuildContext context) {
    switch (_phase) {
      case _PairPhase.starting:
        return <Widget>[
          const SizedBox(
            height: 120,
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2, color: DexColors.textDim,
                ),
              ),
            ),
          ),
          Text(
            'Preparing a pairing code…',
            textAlign: TextAlign.center,
            style: DexType.caption(color: DexColors.textFaint),
          ),
        ];
      case _PairPhase.scanQr:
        return <Widget>[
          Center(
            child: Container(
              padding: const EdgeInsets.all(DexSpace.sm),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: DexRadius.rmd,
              ),
              child: Image.memory(
                _qrBytes!,
                width: 220,
                height: 220,
                gaplessPlayback: true,
                filterQuality: FilterQuality.none,
              ),
            ),
          ),
          const SizedBox(height: DexSpace.md),
          Text(
            'WhatsApp → Settings → Linked devices → Link a device',
            textAlign: TextAlign.center,
            style: DexType.body(color: DexColors.textDim),
          ),
          const SizedBox(height: DexSpace.xs),
          Text(
            'The code refreshes automatically. This device will appear as "Dex".',
            textAlign: TextAlign.center,
            style: DexType.caption(color: DexColors.textFaint),
          ),
        ];
      case _PairPhase.connected:
        return <Widget>[
          const SizedBox(height: DexSpace.md),
          const Icon(LucideIcons.circle_check,
              size: 44, color: DexColors.stateApprove),
          const SizedBox(height: DexSpace.md),
          Text(
            'WhatsApp linked',
            textAlign: TextAlign.center,
            style: DexType.heading(color: DexColors.text),
          ),
          const SizedBox(height: DexSpace.xs),
          Text(
            'Try: "send hi to myself on WhatsApp"',
            textAlign: TextAlign.center,
            style: DexType.caption(color: DexColors.textFaint),
          ),
          const SizedBox(height: DexSpace.lg),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Done'),
          ),
        ];
      case _PairPhase.failed:
        return <Widget>[
          const SizedBox(height: DexSpace.sm),
          Text(
            _error ?? 'Pairing failed.',
            textAlign: TextAlign.center,
            style: DexType.body(color: DexColors.stateError),
          ),
          const SizedBox(height: DexSpace.lg),
          OutlinedButton(
            onPressed: () {
              setState(() {
                _phase = _PairPhase.starting;
                _error = null;
              });
              _start();
            },
            child: const Text('Try again'),
          ),
        ];
    }
  }
}
