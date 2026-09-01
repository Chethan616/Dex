// About tab. Version, tagline, heritage credit (MIT attribution), and
// links that actually go somewhere (repo + issue tracker).

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../theme/tokens.dart';
import '../settings_row.dart';

class AboutTab extends StatelessWidget {
  const AboutTab({super.key});

  static const String _version = 'Dex 2026.6.22 — desktop (Windows preview)';
  static const String _repo = 'https://github.com/Chethan616/Dex';

  void _open(String url) {
    launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

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
            const SizedBox(height: DexSpace.md),
            Text(
              'Built on open source: OpenClaw (agent core), Microsoft UFO² '
              '(desktop automation), and browser-use (web automation). '
              'MIT-licensed.',
              style: DexType.caption(color: DexColors.textFaint),
            ),
            const Divider(),
            SettingsLinkRow(
              label: 'Source & licenses',
              description: 'View the code and third-party notices on GitHub.',
              onTap: () => _open(_repo),
            ),
            SettingsLinkRow(
              label: 'Report an issue',
              description: 'Something broken or missing? Open an issue.',
              onTap: () => _open('$_repo/issues/new'),
            ),
          ],
        ),
      ),
    );
  }
}
