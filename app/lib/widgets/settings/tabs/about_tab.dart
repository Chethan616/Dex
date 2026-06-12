// About tab. Version string + a stack of legal / policy links.

import 'package:flutter/material.dart';

import '../../../theme/tokens.dart';
import '../settings_row.dart';

class AboutTab extends StatelessWidget {
  const AboutTab({super.key});

  static const String _version = 'Dex v1.2 (desktop, Windows preview)';

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'About',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_version, style: DexType.body(color: DexColors.text)),
            const SizedBox(height: DexSpace.sm),
            Text(
              'A calm cockpit for commanding agents you can trust.',
              style: DexType.caption(color: DexColors.textFaint),
            ),
            const Divider(),
            SettingsLinkRow(label: 'Open source notices', onTap: () {}),
            SettingsLinkRow(label: 'Consumer health privacy', onTap: () {}),
            SettingsLinkRow(label: 'Your privacy choices', onTap: () {}),
            SettingsLinkRow(label: 'Report legal or privacy concern', onTap: () {}),
            SettingsLinkRow(label: 'Third-party notices', onTap: () {}),
          ],
        ),
      ),
    );
  }
}
