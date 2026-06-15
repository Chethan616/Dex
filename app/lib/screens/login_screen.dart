// Login / Create account — identity surface, UI-only for now.
//
// No backend: the form persists name + email locally (DexAccount) so
// the app has a real sign-in/sign-out FLOW for future auth to slot
// into. Appears before onboarding on first launch; sign-out from the
// profile menu routes back here.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../core/account.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/dex_glass.dart';
import '../widgets/living_background.dart';
import '../widgets/secret_field.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.onSignedIn});
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _creating = false; // false = Sign in, true = Create account
  final TextEditingController _name = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    final name = _creating
        ? _name.text.trim()
        : (_name.text.trim().isEmpty
            ? email.split('@').first
            : _name.text.trim());
    if (email.isEmpty || !email.contains('@')) {
      setState(() => _error = 'Enter a valid email address.');
      return;
    }
    if (_creating && name.isEmpty) {
      setState(() => _error = 'Tell Dex what to call you.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    await DexAccount.signIn(name: name.isEmpty ? 'Dex user' : name, email: email);
    if (mounted) widget.onSignedIn();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: LivingBackground(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: DexGlass(
              radius: 20,
              padding: const EdgeInsets.all(DexSpace.xl),
              child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: DexSpace.sm),
                        const Icon(LucideIcons.sparkles,
                            size: 32, color: DexColors.accent),
                        const SizedBox(height: DexSpace.md),
                        Text(
                          _creating ? 'Create your account' : 'Welcome back',
                          textAlign: TextAlign.center,
                          style: DexType.heading(color: DexColors.text),
                        ),
                        const SizedBox(height: DexSpace.xs),
                        Text(
                          'Your cockpit, your machine. Everything stays local.',
                          textAlign: TextAlign.center,
                          style: DexType.caption(color: DexColors.textFaint),
                        ),
                        const SizedBox(height: DexSpace.xl),
                        AnimatedSize(
                          duration:
                              DexMotion.respecting(context, DexMotion.medium),
                          curve: DexMotion.easeOut,
                          child: _creating
                              ? Padding(
                                  padding: const EdgeInsets.only(
                                      bottom: DexSpace.md),
                                  child: _PlainField(
                                    controller: _name,
                                    hint: 'Name',
                                    icon: LucideIcons.user,
                                  ),
                                )
                              : const SizedBox(width: double.infinity),
                        ),
                        _PlainField(
                          controller: _email,
                          hint: 'Email',
                          icon: LucideIcons.mail,
                        ),
                        const SizedBox(height: DexSpace.md),
                        SecretField(
                          controller: _password,
                          hint: 'Password',
                          icon: LucideIcons.lock,
                          onSubmitted: (_) => _submit(),
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: DexSpace.sm),
                          Text(_error!,
                              style: DexType.caption(
                                  color: DexColors.stateError)),
                        ],
                        const SizedBox(height: DexSpace.lg),
                        ElevatedButton(
                          onPressed: _busy ? null : _submit,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: DexColors.accent,
                            foregroundColor: DexColors.bg,
                            padding: const EdgeInsets.symmetric(
                                vertical: DexSpace.md),
                          ),
                          child: Text(_busy
                              ? 'One moment…'
                              : (_creating ? 'Create account' : 'Sign in')),
                        ),
                        const SizedBox(height: DexSpace.md),
                        MouseRegion(
                          cursor: SystemMouseCursors.click,
                          child: GestureDetector(
                            onTap: () => setState(() {
                              _creating = !_creating;
                              _error = null;
                            }),
                            child: Text(
                              _creating
                                  ? 'Already have an account?  Sign in'
                                  : "New to Dex?  Create an account",
                              textAlign: TextAlign.center,
                              style:
                                  DexType.caption(color: DexColors.accent),
                            ),
                          ),
                        ),
                        const SizedBox(height: DexSpace.xs),
                      ],
                    ),
                  ),
                ),
              ),
        ),
    );
  }
}

/// Unmasked sibling of SecretField with the same focus-ring language.
class _PlainField extends StatefulWidget {
  const _PlainField({
    required this.controller,
    required this.hint,
    required this.icon,
  });
  final TextEditingController controller;
  final String hint;
  final IconData icon;

  @override
  State<_PlainField> createState() => _PlainFieldState();
}

class _PlainFieldState extends State<_PlainField> {
  final FocusNode _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final focused = _focus.hasFocus;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: DexSpace.md),
      decoration: BoxDecoration(
        color: focused
            ? DexColors.surface2.withValues(alpha: 0.7)
            : DexColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: focused
              ? DexColors.accent.withValues(alpha: 0.65)
              : DexColors.border,
        ),
        boxShadow: focused
            ? <BoxShadow>[
                BoxShadow(
                  color: DexColors.accent.withValues(alpha: 0.12),
                  blurRadius: 12,
                  spreadRadius: 1,
                ),
              ]
            : const <BoxShadow>[],
      ),
      child: Row(
        children: [
          Icon(widget.icon,
              size: 15,
              color: focused ? DexColors.accent : DexColors.textFaint),
          const SizedBox(width: DexSpace.sm),
          Expanded(
            child: TextField(
              controller: widget.controller,
              focusNode: _focus,
              style: DexType.body(color: DexColors.text),
              cursorColor: DexColors.accent,
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: widget.hint,
                hintStyle: DexType.body(color: DexColors.textFaint),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
