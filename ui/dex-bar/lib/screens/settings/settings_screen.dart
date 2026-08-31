import 'package:flutter/material.dart';

import '../../core/gateway_client.dart';
import '../../core/settings_models.dart';
import '../../core/supervisor/health.dart';
import '../../core/supervisor/supervisor.dart';
import '../../core/theme_controller.dart';
import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../../widgets/access_chip.dart';
import '../../widgets/primitives/primitives.dart';
import '../../widgets/secret_field.dart';
import 'brain_cards.dart';

/// Everything Dex can be told, in one place.
///
/// Before this existed the answer to "how do I change my API key" was a
/// terminal command, and the answer to "which keys does it even want" was
/// reading the source. Both are now on this screen.
///
/// One thing deliberately *not* here: a switch that turns off the confirmation
/// ladder wholesale, or one that unlocks the RED registry band. Full Access is
/// here because granting it is a conscious act with a UAC prompt attached. RED
/// stays behind an environment variable set by hand, because turning off every
/// prompt and unlocking the sharpest keys in Windows should not be the same
/// gesture — and now that a Settings page exists, the temptation to merge them
/// is exactly what needs resisting.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.client,
    required this.supervisor,
    required this.theme,
    required this.onQuit,
  });

  final GatewayClient client;
  final Supervisor supervisor;
  final ThemeController theme;
  final Future<void> Function() onQuit;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Map<String, HealthReport> _health = const {};

  @override
  void initState() {
    super.initState();
    widget.client.refreshSettings();
    _refreshHealth();
  }

  Future<void> _refreshHealth() async {
    final health = await widget.supervisor.checkAll();
    if (mounted) setState(() => _health = health);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final settings = widget.client.settings;

    if (settings == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2, color: t.accent),
            ),
            const SizedBox(height: DexTokens.spaceMd),
            Text('Reading settings…', style: DexType.caption(color: t.textMuted)),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        DexTokens.spaceXl,
        DexTokens.spaceLg,
        DexTokens.spaceXl,
        DexTokens.spaceXl * 2,
      ),
      children: [
        _SettingsHeader(settings: settings),
        _Section(
          title: 'The Brain',
          blurb: 'What Dex thinks with. Pick one.',
          child: BrainCards(client: widget.client, settings: settings),
        ),
        _Section(
          title: 'How a request moves',
          blurb: 'The model makes the plan; Dex keeps control of the machine.',
          child: _HowDexWorks(settings: settings),
        ),
        _Section(
          title: 'Full Access',
          blurb: 'Whether Dex asks before each privileged step.',
          child: _FullAccessSection(client: widget.client),
        ),
        _Section(
          title: 'Agents',
          blurb: 'The processes that do the work. Turning one off makes Dex '
              'lighter and less capable.',
          child: _AgentsSection(
            client: widget.client,
            supervisor: widget.supervisor,
            settings: settings,
            health: _health,
            onRefresh: _refreshHealth,
          ),
        ),
        _Section(
          title: 'Email, calendar and files',
          blurb: 'Optional. Without these Dex simply has no Workspace agent.',
          child: _CredentialList(
            client: widget.client,
            credentials: settings.inGroup('workspace'),
          ),
        ),
        _Section(
          title: 'Vision',
          blurb: 'Only used when a window has no accessible controls to read.',
          child: _CredentialList(
            client: widget.client,
            credentials: settings.inGroup('vision'),
          ),
        ),
        _Section(
          title: 'Chat channels',
          blurb: 'Talk to Dex from your phone. A channel starts only when it '
              'has both a token and an owner id.',
          child: _ChannelsSection(client: widget.client, settings: settings),
        ),
        _Section(
          title: 'General',
          blurb: null,
          child: _GeneralSection(
            client: widget.client,
            supervisor: widget.supervisor,
            settings: settings,
            theme: widget.theme,
            onQuit: widget.onQuit,
          ),
        ),
      ],
    );
  }
}

class _SettingsHeader extends StatelessWidget {
  const _SettingsHeader({required this.settings});

  final SettingsSnapshot settings;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final provider = settings.brainProviders
            .where((item) => item.id == settings.brainProvider)
            .map((item) => item.label)
            .firstOrNull ??
        (settings.brainProvider.isEmpty ? 'Not configured' : settings.brainProvider);
    final statusTone = settings.brainProvider.isEmpty
        ? t.warn
        : settings.usingClaudeCode
            ? t.attention
            : t.positive;

    return Padding(
      padding: const EdgeInsets.only(bottom: DexTokens.spaceXl),
      child: DexEntrance(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Settings', style: DexType.display(color: t.text, strong: true)),
                  const SizedBox(height: DexTokens.spaceXs),
                  Text(
                    'Choose how Dex thinks, what it can reach, and what stays yours.',
                    style: DexType.body(color: t.textMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: DexTokens.spaceMd),
            DexTag.round(
              settings.brainProvider.isEmpty ? 'Needs setup' : '$provider active',
              tone: statusTone,
            ),
          ],
        ),
      ),
    );
  }
}

class _HowDexWorks extends StatelessWidget {
  const _HowDexWorks({required this.settings});

  final SettingsSnapshot settings;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final provider = settings.brainProviders
            .where((item) => item.id == settings.brainProvider)
            .map((item) => item.label)
            .firstOrNull ??
        (settings.brainProvider.isEmpty ? 'your selected brain' : settings.brainProvider);
    final brainDetail = settings.usingClaudeCode
        ? 'Claude Code returns the plan through your signed-in local CLI.'
        : '$provider turns your request into a structured plan.';

    final stages = [
      _FlowStageData(
        index: '01',
        title: 'Brain',
        detail: '$brainDetail It does not click or type.',
        icon: Icons.psychology_alt_outlined,
        tone: t.accent,
      ),
      _FlowStageData(
        index: '02',
        title: 'Core',
        detail: 'Checks the plan, asks for approval, runs steps, and verifies results.',
        icon: Icons.account_tree_outlined,
        tone: t.info,
      ),
      _FlowStageData(
        index: '03',
        title: 'Agents',
        detail: 'OS, app, browser, and vision workers perform the actual action.',
        icon: Icons.precision_manufacturing_outlined,
        tone: t.positive,
      ),
    ];

    return DexPanel(
      accent: t.info,
      padding: const EdgeInsets.all(DexTokens.spaceLg),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= 720;
          final children = <Widget>[];
          for (var i = 0; i < stages.length; i++) {
            if (i > 0) {
              children.add(
                Icon(
                  wide ? Icons.arrow_forward_rounded : Icons.arrow_downward_rounded,
                  size: 16,
                  color: t.textFaint,
                ),
              );
            }
            final stage = _FlowStage(data: stages[i]);
            children.add(wide ? Expanded(child: stage) : stage);
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'One request, three responsibilities',
                style: DexType.title(color: t.text, strong: true),
              ),
              const SizedBox(height: DexTokens.spaceLg),
              wide
                  ? Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: children,
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: children,
                    ),
              const SizedBox(height: DexTokens.spaceLg),
              Text(
                'Claude Code is another Brain option. It supplies a plan through its local CLI; Dex still owns the tools, permissions, and verification.',
                style: DexType.caption(color: t.textMuted),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _FlowStageData {
  const _FlowStageData({
    required this.index,
    required this.title,
    required this.detail,
    required this.icon,
    required this.tone,
  });

  final String index;
  final String title;
  final String detail;
  final IconData icon;
  final Color tone;
}

class _FlowStage extends StatelessWidget {
  const _FlowStage({required this.data});

  final _FlowStageData data;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Padding(
      padding: const EdgeInsets.all(DexTokens.spaceSm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: data.tone.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(DexTokens.radiusSm),
              border: Border.all(color: data.tone.withValues(alpha: 0.35)),
            ),
            child: Icon(data.icon, size: 16, color: data.tone),
          ),
          const SizedBox(width: DexTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${data.index}  ${data.title}', style: DexType.label(color: t.text, strong: true)),
                const SizedBox(height: 3),
                Text(data.detail, style: DexType.caption(color: t.textMuted)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.blurb, required this.child});

  final String title;
  final String? blurb;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Padding(
      padding: const EdgeInsets.only(bottom: DexTokens.spaceXl),
      child: DexEntrance(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: DexType.title(color: t.text)),
            if (blurb != null) ...[
              const SizedBox(height: 2),
              Text(blurb!, style: DexType.caption(color: t.textMuted)),
            ],
            const SizedBox(height: DexTokens.spaceMd),
            child,
          ],
        ),
      ),
    );
  }
}

class _CredentialList extends StatelessWidget {
  const _CredentialList({required this.client, required this.credentials});

  final GatewayClient client;
  final List<CredentialStatus> credentials;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final credential in credentials) ...[
          SecretField(
            credential: credential,
            busy: client.settingsBusy,
            onSave: (value) => client.setCredential(credential.name, value),
            onClear: () => client.deleteCredential(credential.name),
          ),
          const SizedBox(height: DexTokens.spaceMd),
        ],
      ],
    );
  }
}

class _FullAccessSection extends StatelessWidget {
  const _FullAccessSection({required this.client});

  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return DexPanel(
      padding: const EdgeInsets.all(DexTokens.spaceLg),
      accent: client.fullAccess ? t.positive : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  client.fullAccess
                      ? 'Dex runs privileged steps without asking.'
                      : 'Dex asks before each privileged step.',
                  style: DexType.body(color: t.text),
                ),
              ),
              AccessChip(
                enabled: client.fullAccess,
                serviceState: client.daemonService,
                onToggle: client.setFullAccess,
              ),
            ],
          ),
          const SizedBox(height: DexTokens.spaceMd),
          Text(
            'Granting it costs one Windows elevation prompt, once. After that a '
            'logon task runs the daemon elevated in your own session, so DNS, '
            'Wi-Fi, power plans and HKLM writes work without a prompt.',
            style: DexType.caption(color: t.textMuted),
          ),
          const SizedBox(height: DexTokens.spaceMd),
          _Boundary(
            'RED registry keys stay refused.',
            'Defender, Group Policy, services, Winlogon, LSA, autostart, UAC. '
                'Full Access does not unlock them. They are reachable only by '
                'setting DEX_ALLOW_RED by hand, and even then every one of them '
                'raises a confirmation card.',
          ),
          _Boundary(
            'Hand-offs still reach you.',
            'No amount of privilege lets Dex read a CAPTCHA or type a password '
                'it does not know. Those stop and ask, always.',
          ),
          _Boundary(
            'It turns itself off if it is not real.',
            'Configured but not actually elevated is the worst combination '
                'available — confirmations skipped for steps that then fail. Dex '
                'detects that and puts the cards back.',
          ),
        ],
      ),
    );
  }
}

class _Boundary extends StatelessWidget {
  const _Boundary(this.title, this.detail);

  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Padding(
      padding: const EdgeInsets.only(top: DexTokens.spaceMd),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.shield_outlined, size: 14, color: t.info),
          const SizedBox(width: DexTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: DexType.body(strong: true, color: t.text)),
                Text(detail, style: DexType.caption(color: t.textMuted)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AgentsSection extends StatelessWidget {
  const _AgentsSection({
    required this.client,
    required this.supervisor,
    required this.settings,
    required this.health,
    required this.onRefresh,
  });

  final GatewayClient client;
  final Supervisor supervisor;
  final SettingsSnapshot settings;
  final Map<String, HealthReport> health;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return DexPanel(
      padding: const EdgeInsets.all(DexTokens.spaceLg),
      child: Column(
        children: [
          for (final agent in const [
            ('daemon', 'Privileged daemon', 'DNS, registry, power, audio, apps'),
            ('core', 'Core', 'Planning, verification, memory'),
            ('app', 'App agent', 'Driving applications without screenshots'),
            ('desktop', 'Vision agent', 'Reading the screen when nothing else works'),
            ('browser', 'Browser agent', 'The web'),
          ])
            _AgentRow(
              id: agent.$1,
              name: agent.$2,
              blurb: agent.$3,
              report: health[agent.$1],
              supervisor: supervisor,
              onRefresh: onRefresh,
            ),
          const SizedBox(height: DexTokens.spaceMd),
          Row(
            children: [
              DexButton(
                label: 'Re-check',
                icon: Icons.refresh_rounded,
                dense: true,
                onTap: onRefresh,
              ),
              const SizedBox(width: DexTokens.spaceMd),
              Expanded(
                child: Text(
                  supervisor.childrenAreOwned
                      ? 'Everything Dex started closes when Dex does — the OS '
                          'enforces it, not a cleanup routine.'
                      : 'Warning: the job object could not be created, so agents '
                          'may outlive Dex. Use Stop everything before quitting.',
                  style: DexType.caption(
                    color: supervisor.childrenAreOwned ? t.textFaint : t.warn,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AgentRow extends StatelessWidget {
  const _AgentRow({
    required this.id,
    required this.name,
    required this.blurb,
    required this.report,
    required this.supervisor,
    required this.onRefresh,
  });

  final String id;
  final String name;
  final String blurb;
  final HealthReport? report;
  final Supervisor supervisor;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final up = report?.up ?? false;
    final pid = supervisor.pidOf(id);

    return Padding(
      padding: const EdgeInsets.only(bottom: DexTokens.spaceMd),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: report == null
                    ? t.textFaint
                    : up
                        ? t.positive
                        : t.negative,
                shape: BoxShape.circle,
              ),
            ),
          ),
          const SizedBox(width: DexTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(name, style: DexType.body(color: t.text)),
                    if (pid != null) ...[
                      const SizedBox(width: DexTokens.spaceSm),
                      Text('pid $pid', style: DexType.code(color: t.textFaint)),
                    ],
                  ],
                ),
                Text(
                  up ? blurb : (report?.reason ?? 'not checked'),
                  style: DexType.caption(color: up ? t.textMuted : t.negative),
                ),
              ],
            ),
          ),
          // The daemon is not ours to restart — it belongs to the scheduled
          // task and stopping it needs the elevation Dex deliberately lacks.
          if (id != 'daemon')
            DexButton(
              label: up ? 'Restart' : 'Start',
              dense: true,
              consequential: true,
              onTap: () async {
                await supervisor.restart(id);
                onRefresh();
              },
            ),
        ],
      ),
    );
  }
}

class _ChannelsSection extends StatelessWidget {
  const _ChannelsSection({required this.client, required this.settings});

  final GatewayClient client;
  final SettingsSnapshot settings;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _CredentialList(client: client, credentials: settings.inGroup('channels')),
        _EnvField(
          client: client,
          settings: settings,
          envKey: 'DEX_OWNER_TELEGRAM',
          label: 'Your Telegram user id',
          hint: 'Ask @userinfobot for it',
        ),
        _EnvField(
          client: client,
          settings: settings,
          envKey: 'DEX_OWNER_DISCORD',
          label: 'Your Discord user id',
          hint: 'Developer mode on, then right-click yourself → Copy User ID',
        ),
        _EnvField(
          client: client,
          settings: settings,
          envKey: 'DEX_TRIGGER_PREFIX',
          label: 'What summons Dex in a group chat',
          hint: '@dex',
        ),
      ],
    );
  }
}

class _GeneralSection extends StatelessWidget {
  const _GeneralSection({
    required this.client,
    required this.supervisor,
    required this.settings,
    required this.theme,
    required this.onQuit,
  });

  final GatewayClient client;
  final Supervisor supervisor;
  final SettingsSnapshot settings;
  final ThemeController theme;
  final Future<void> Function() onQuit;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return DexPanel(
      padding: const EdgeInsets.all(DexTokens.spaceLg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Appearance', style: DexType.label(color: t.textMuted)),
          const SizedBox(height: DexTokens.spaceSm),
          Wrap(
            spacing: DexTokens.spaceSm,
            children: [
              for (final mode in ThemeMode.values)
                DexButton(
                  label: switch (mode) {
                    ThemeMode.system => 'Match Windows',
                    ThemeMode.light => 'Light',
                    ThemeMode.dark => 'Dark',
                  },
                  dense: true,
                  variant: theme.mode == mode
                      ? DexButtonVariant.primary
                      : DexButtonVariant.secondary,
                  onTap: () => theme.set(mode),
                ),
            ],
          ),
          const SizedBox(height: DexTokens.spaceLg),
          Text('Where things live', style: DexType.label(color: t.textMuted)),
          const SizedBox(height: DexTokens.spaceSm),
          _Path('Encrypted credentials', settings.credentialStore),
          _Path('Settings file', settings.envFile),
          _Path('Logs', '%LOCALAPPDATA%\\DEX'),
          const SizedBox(height: DexTokens.spaceLg),
          Row(
            children: [
              DexButton(
                label: 'Stop everything',
                icon: Icons.power_settings_new_rounded,
                dense: true,
                tone: t.negative,
                consequential: true,
                onTap: supervisor.stopAll,
              ),
              const SizedBox(width: DexTokens.spaceMd),
              DexButton(
                label: 'Quit Dex',
                icon: Icons.close_rounded,
                dense: true,
                tone: t.negative,
                consequential: true,
                onTap: onQuit,
              ),
              const SizedBox(width: DexTokens.spaceMd),
              Expanded(
                child: Text(
                  'The close button hides Dex so Alt+Space stays available. '
                  'Quit Dex ends the app and its child processes.',
                  style: DexType.caption(color: t.textFaint),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Path extends StatelessWidget {
  const _Path(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Padding(
      padding: const EdgeInsets.only(bottom: DexTokens.spaceXs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 150,
            child: Text(label, style: DexType.caption(color: t.textMuted)),
          ),
          Expanded(child: Text(value, style: DexType.code(color: t.textFaint))),
        ],
      ),
    );
  }
}

/// A plain, non-secret setting that lives in `.env`.
class _EnvField extends StatefulWidget {
  const _EnvField({
    required this.client,
    required this.settings,
    required this.envKey,
    required this.label,
    required this.hint,
  });

  final GatewayClient client;
  final SettingsSnapshot settings;
  final String envKey;
  final String label;
  final String hint;

  @override
  State<_EnvField> createState() => _EnvFieldState();
}

class _EnvFieldState extends State<_EnvField> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.settings.env[widget.envKey] ?? '',
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Padding(
      padding: const EdgeInsets.only(bottom: DexTokens.spaceMd),
      child: DexPanel(
        padding: const EdgeInsets.all(DexTokens.spaceLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.label, style: DexType.body(strong: true, color: t.text)),
            const SizedBox(height: DexTokens.spaceSm),
            Row(
              children: [
                Expanded(
                  child: DexField(
                    controller: _controller,
                    hint: widget.hint,
                    onSubmitted: (v) =>
                        widget.client.setEnv({widget.envKey: v.isEmpty ? null : v}),
                  ),
                ),
                const SizedBox(width: DexTokens.spaceSm),
                DexButton(
                  label: 'Save',
                  dense: true,
                  enabled: !widget.client.settingsBusy,
                  onTap: () => widget.client.setEnv({
                    widget.envKey:
                        _controller.text.isEmpty ? null : _controller.text,
                  }),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
