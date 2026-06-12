// Privacy tab. Toggles for context use, training, transcript, plus links
// to managing shared data and exporting history.

import 'package:flutter/material.dart';

import '../../../theme/tokens.dart';
import '../settings_row.dart';

class PrivacyTab extends StatefulWidget {
  const PrivacyTab({super.key});
  @override
  State<PrivacyTab> createState() => _PrivacyTabState();
}

class _PrivacyTabState extends State<PrivacyTab> {
  bool _contextClues = true;
  bool _videoTranscript = false;
  bool _trainOnChat = true;
  bool _trainOnVoice = false;
  bool _diagnostics = true;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Privacy',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsRow(
              label: 'Context clues',
              control: Switch(
                value: _contextClues,
                onChanged: (v) => setState(() => _contextClues = v),
              ),
              description:
                  'Dex may give better answers based on the current window, open tabs, or browsing history.',
            ),
            SettingsRow(
              label: 'Video transcript',
              control: Switch(
                value: _videoTranscript,
                onChanged: (v) => setState(() => _videoTranscript = v),
              ),
              description:
                  'Dex may surface video highlights with timestamps based on the video transcript.',
            ),
            SettingsRow(
              label: 'Training on conversation activity',
              control: Switch(
                value: _trainOnChat,
                onChanged: (v) => setState(() => _trainOnChat = v),
              ),
              description:
                  'Allow conversations with Dex to help train future models.',
            ),
            SettingsRow(
              label: 'Training on voice conversations',
              control: Switch(
                value: _trainOnVoice,
                onChanged: (v) => setState(() => _trainOnVoice = v),
              ),
            ),
            const Divider(),
            SettingsLinkRow(label: 'Manage shared links', onTap: () {}),
            SettingsLinkRow(
                label: 'Manage personalisation and memory', onTap: () {}),
            SettingsLinkRow(label: 'Export or delete history', onTap: () {}),
            const Divider(),
            SettingsRow(
              label: 'Optional diagnostic data sharing',
              control: Switch(
                value: _diagnostics,
                onChanged: (v) => setState(() => _diagnostics = v),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
