// The Spotlight sub-window. Spawned via desktop_multi_window from the
// main Dex window when the user hits the global Ctrl+K while Dex is
// unfocused. Renders the same composer-style summon panel that the
// in-app SpotlightOverlay used to, but as a real borderless Windows
// overlay sitting on top of whatever the user is currently doing.
//
// IPC: when the user submits, the panel invokes the
// `dex.spotlight` WindowMethodChannel's `sendPrompt` method. The main
// window has the handler registered (see main.dart) and forwards the
// prompt into ConversationStore.sendHumanMessage.

import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:window_manager/window_manager.dart';

import 'main.dart' show DexScrollBehavior, dexSpotlightChannel;
import 'theme/theme.dart';
import 'theme/tokens.dart';
import 'widgets/home/suggestion_chip.dart';

/// Default suggestions surfaced under the overlay's input. Same shape
/// as the in-app SpotlightOverlay had so users recognise the surface.
const List<String> _suggestions = <String>[
  'Open this file',
  'Summarise this tab',
  'Take a screenshot',
  'Send an email',
];

/// Boot the spotlight sub-window. Sets up the borderless always-on-top
/// chrome, then runs the MaterialApp.
Future<void> runSpotlightWindow(WindowController self) async {
  // Style the sub-window before showing it: borderless (no titlebar),
  // transparent background so the acrylic card reads as glass, sized
  // to the overlay's content + always-on-top + centered. Wrapped in
  // try/catch because window_manager calls from a sub-window can throw
  // on the very first frame on some Windows versions; we'd rather show
  // a slightly-chromed window than fail to summon at all.
  try {
    await windowManager.ensureInitialized();
    const opts = WindowOptions(
      size: Size(640, 360),
      backgroundColor: Colors.transparent,
      skipTaskbar: true,
      titleBarStyle: TitleBarStyle.hidden,
      alwaysOnTop: true,
    );
    await windowManager.waitUntilReadyToShow(opts, () async {
      await windowManager.setAsFrameless();
      await windowManager.setAlwaysOnTop(true);
      await windowManager.center();
      await windowManager.show();
      await windowManager.focus();
    });
  } catch (e, st) {
    // Fallback: still show whatever the OS handed us. Logged so the
    // first-frame-on-Windows-11 corner case doesn't go silent.
    debugPrint('[dex] spotlight window styling failed: $e\n$st');
  }

  runApp(SpotlightWindowApp(controller: self));
}

class SpotlightWindowApp extends StatelessWidget {
  const SpotlightWindowApp({super.key, required this.controller});
  final WindowController controller;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dex Spotlight',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      theme: buildDexLightTheme(),
      darkTheme: buildDexDarkTheme(),
      scrollBehavior: const DexScrollBehavior(),
      home: SpotlightScreen(controller: controller),
    );
  }
}

class SpotlightScreen extends StatefulWidget {
  const SpotlightScreen({super.key, required this.controller});
  final WindowController controller;

  @override
  State<SpotlightScreen> createState() => _SpotlightScreenState();
}

class _SpotlightScreenState extends State<SpotlightScreen> {
  late final TextEditingController _ctrl;
  late final FocusNode _focus;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController();
    _focus = FocusNode();
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _submit([String? text]) async {
    final t = (text ?? _ctrl.text).trim();
    if (t.isEmpty || _submitting) return;
    setState(() => _submitting = true);
    const channel = WindowMethodChannel(dexSpotlightChannel);
    try {
      await channel.invokeMethod<void>('sendPrompt', t);
    } catch (e, st) {
      // Even if IPC failed, still close the window -- the user expects
      // dismissal on submit. Logging so a real failure shows up.
      debugPrint('[dex] spotlight sendPrompt failed: $e\n$st');
    }
    await _dismiss();
  }

  Future<void> _dismiss() async {
    if (Platform.isWindows) {
      try {
        await windowManager.close();
      } catch (e) {
        // If close fails, hide so the panel at least disappears.
        await windowManager.hide();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: Shortcuts(
        shortcuts: const <ShortcutActivator, Intent>{
          SingleActivator(LogicalKeyboardKey.escape): _DismissIntent(),
        },
        child: Actions(
          actions: <Type, Action<Intent>>{
            _DismissIntent: CallbackAction<_DismissIntent>(
              onInvoke: (_) {
                _dismiss();
                return null;
              },
            ),
          },
          child: Padding(
            padding: const EdgeInsets.all(DexSpace.lg),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ClipRRect(
                    borderRadius: DexRadius.rxl,
                    child: BackdropFilter(
                      filter: ImageFilter.blur(
                        sigmaX: DexSurface.blurSigma,
                        sigmaY: DexSurface.blurSigma,
                      ),
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: DexSurface.glossyGradient(),
                          borderRadius: DexRadius.rxl,
                          border: DexSurface.glossyBorder(),
                          boxShadow: DexSurface.glossyShadow,
                        ),
                        padding: const EdgeInsets.fromLTRB(
                          DexSpace.lg, DexSpace.md, DexSpace.lg, DexSpace.md,
                        ),
                        child: Row(
                          children: [
                            const Icon(LucideIcons.search,
                                size: 20, color: DexColors.textDim),
                            const SizedBox(width: DexSpace.md),
                            Expanded(
                              child: KeyboardListener(
                                focusNode: FocusNode(skipTraversal: true),
                                onKeyEvent: (e) {
                                  if (e is KeyDownEvent &&
                                      e.logicalKey == LogicalKeyboardKey.enter &&
                                      !HardwareKeyboard.instance.isShiftPressed) {
                                    _submit();
                                  }
                                },
                                child: TextField(
                                  controller: _ctrl,
                                  focusNode: _focus,
                                  enabled: !_submitting,
                                  style: DexType.body(color: DexColors.text),
                                  decoration: InputDecoration(
                                    isCollapsed: true,
                                    border: InputBorder.none,
                                    enabledBorder: InputBorder.none,
                                    focusedBorder: InputBorder.none,
                                    filled: false,
                                    hintText: 'Ask Dex anything...',
                                    hintStyle: DexType.body(
                                      color: DexColors.textFaint,
                                    ),
                                  ),
                                  textInputAction: TextInputAction.send,
                                  onSubmitted: (_) => _submit(),
                                ),
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: DexSpace.sm, vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: DexColors.surface,
                                borderRadius: DexRadius.rsm,
                                border: Border.all(color: DexColors.border),
                              ),
                              child: Text(
                                'esc',
                                style: DexType.caption(color: DexColors.textFaint),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: DexSpace.md),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: DexSpace.sm,
                    runSpacing: DexSpace.sm,
                    children: _suggestions
                        .map((s) =>
                            SuggestionChip(label: s, onTap: () => _submit(s)))
                        .toList(growable: false),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DismissIntent extends Intent {
  const _DismissIntent();
}
