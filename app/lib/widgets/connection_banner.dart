// Small banner above the conversation showing the live gateway connection
// state. Hidden when ready -- only visible while connecting, disconnected,
// or in a failed state.

import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';

class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({super.key, required this.client});
  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: client,
      builder: (context, _) {
        final s = client.state;
        if (s == GatewayConnState.ready) {
          return const SizedBox.shrink();
        }
        final (color, label, hint) = _describe(s, client.lastError);
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
                if (s == GatewayConnState.failed ||
                    s == GatewayConnState.disconnected) ...[
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

  (Color, String, String) _describe(GatewayConnState s, String? err) {
    switch (s) {
      case GatewayConnState.disconnected:
        return (DexColors.textDim, 'disconnected', 'Gateway is not connected. Click Retry, or make sure `openclaw gateway` is running on 127.0.0.1:18789.');
      case GatewayConnState.connecting:
        return (DexColors.stateActing, 'connecting', 'Opening WebSocket to the OpenClaw gateway...');
      case GatewayConnState.handshaking:
        return (DexColors.stateActing, 'handshaking', 'Authenticating with the gateway...');
      case GatewayConnState.failed:
        return (DexColors.stateError, 'failed', err ?? 'Gateway rejected the connection.');
      case GatewayConnState.ready:
        return (DexColors.stateApprove, 'ready', '');
    }
  }
}
