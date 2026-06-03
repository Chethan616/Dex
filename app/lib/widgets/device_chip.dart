// Device chip in the left rail. v1 only ever renders "This PC", but the
// shape is list-of-1 so adding more later is free.

import 'package:flutter/material.dart';

import '../core/models/device.dart';
import '../theme/tokens.dart';

class DeviceChip extends StatelessWidget {
  const DeviceChip({super.key, required this.device});
  final Device device;

  Color _stateColor() {
    switch (device.state) {
      case DeviceConnection.online:
        return DexColors.stateApprove;
      case DeviceConnection.offline:
        return DexColors.textFaint;
      case DeviceConnection.paired:
        return DexColors.stateActing;
    }
  }

  String _stateWord() {
    switch (device.state) {
      case DeviceConnection.online:
        return 'online';
      case DeviceConnection.offline:
        return 'offline';
      case DeviceConnection.paired:
        return 'paired';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.xs),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: _stateColor(),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: DexSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(device.name, style: DexType.label(color: DexColors.text)),
                Text(
                  _stateWord(),
                  style: DexType.caption(color: DexColors.textFaint),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
