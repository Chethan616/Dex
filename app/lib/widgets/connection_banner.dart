// Small banner above the conversation showing the live gateway connection
// state. Hidden when ready -- only visible while connecting, disconnected,
// or in a failed state.

import 'package:flutter/material.dart';

import '../core/dex_gateway.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';

class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({super.key, required this.client});
  final DexGatewayClient client;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: client,
      builder: (context, _) {
        final s = client.connection;
        if (s == DexConnection.connected) {
          return const SizedBox.shrink();
        }
        final (color, label, hint) = _describe(s, client.connectionError);
        return Padding(
          padding: const EdgeInsets.only(bottom: DexSpace.sm),
          child: AnimatedContainer(
            duration: DexMotion.respecting(context, DexMotion.medium),
            decoration: BoxDecoration(
              color: DexColors.surface,
              borderRadius: DexRadius.rsm,
              border: Border.all(color: color),
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.md, vertical: DexSpace.sm,
            ),
            child: Row(
              children: [
                Container(
                  width: 8, height: 8,
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                ),
                const SizedBox(width: DexSpace.sm),
                Text(label, style: DexType.label(color: color)),
                const SizedBox(width: DexSpace.md),
                Expanded(
                  child: Text(
                    hint,
                    style: DexType.caption(color: DexColors.textDim),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (s == DexConnection.noCore ||
                    s == DexConnection.disconnected) ...[
                  TextButton(
                    onPressed: client.connect,
                    child: Text('Retry', style: DexType.label(color: DexColors.accent)),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  (Color, String, String) _describe(DexConnection s, String? err) {
    switch (s) {
      case DexConnection.disconnected:
        return (
          DexColors.textDim,
          'disconnected',
          err ?? 'Reconnecting to the Dex core…',
        );
      case DexConnection.connecting:
        return (DexColors.stateActing, 'connecting', 'Opening the link to the Dex core…');
      case DexConnection.noCore:
        // Named rather than called "failed": the core is normally started by
        // the app itself, so this almost always means it is still coming up or
        // it died — and the log is where that is answered.
        return (
          DexColors.stateError,
          'core not running',
          err ?? r'The Dex core is not listening. See %LOCALAPPDATA%\DEX\core.log',
        );
      case DexConnection.connected:
        return (DexColors.stateApprove, 'ready', '');
    }
  }

}
