// Account tab. Reuses device_chip for "This device" presence.

import 'package:flutter/material.dart';

import '../../../core/models/device.dart';
import '../../../theme/tokens.dart';
import '../../device_chip.dart';
import '../settings_row.dart';

class AccountTab extends StatefulWidget {
  const AccountTab({super.key});
  @override
  State<AccountTab> createState() => _AccountTabState();
}

class _AccountTabState extends State<AccountTab> {
  static const _device = Device(
    id: 'local',
    name: 'This PC',
    state: DeviceConnection.online,
    capabilities: <String>['desktop', 'files', 'web'],
  );

  bool _phoneLinked = false;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Account',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsRow(
              label: 'Name',
              control: Text('Dex user',
                  style: DexType.label(color: DexColors.text)),
            ),
            const SizedBox(height: DexSpace.sm),
            Text('This device',
                style: DexType.caption(color: DexColors.textFaint)),
            const SizedBox(height: DexSpace.sm),
            const DeviceChip(device: _device),
            const Divider(),
            SettingsRow(
              label: 'Phone connection',
              control: Switch(
                value: _phoneLinked,
                onChanged: (v) => setState(() => _phoneLinked = v),
              ),
              description:
                  'Send or retrieve text messages, access contacts, and more by linking your phone.',
            ),
            const Divider(),
            Text('Delete account',
                style: DexType.label(color: DexColors.text)),
            const SizedBox(height: DexSpace.xs),
            Text(
              'If you delete and later re-activate, your local data may not be restored.',
              style: DexType.caption(color: DexColors.textFaint),
            ),
            const SizedBox(height: DexSpace.md),
            ElevatedButton(
              onPressed: () {},
              style: ElevatedButton.styleFrom(
                backgroundColor: DexColors.stateError,
                foregroundColor: DexColors.bg,
              ),
              child: const Text('Delete account'),
            ),
            const Divider(),
            SettingsLinkRow(label: 'Parental controls', onTap: () {}),
          ],
        ),
      ),
    );
  }
}
