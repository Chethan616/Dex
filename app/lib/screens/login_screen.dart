// Login / Create account â€” identity surface, UI-only for now.
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
import '../widgets/dex_logo.dart';
import '../widgets/glass_text_field.dart';
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
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(DexSpace.xl),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: DexGlass(
                  radius: 20,
                  rim: true,
                  padding: const EdgeInsets.all(DexSpace.xl),
                  child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: DexSpace.sm),
                        const DexLogo(size: 56),
                        const SizedBox(height: DexSpace.md),
                        Text(
                          _creating ? 'Create your account' : 'Welcome back',
                          textAlign: TextAlign.center,
                          style: DexType.title(color: DexColors.text),
                        ),
                        const SizedBox(height: DexSpace.xs),
                        Text(
                          'Your cockpit, your machine. Everything stays local.',
                          textAlign: TextAlign.center,
                          style: DexType.caption(color: DexColors.textDim),
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
                                  child: DexGlassField(
                                    controller: _name,
                                    hint: 'Name',
                                    icon: LucideIcons.user,
                                  ),
                                )
                              : const SizedBox(width: double.infinity),
                        ),
                        DexGlassField(
                          controller: _email,
                          hint: 'Email',
                          icon: LucideIcons.mail,
                          keyboardType: TextInputType.emailAddress,
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
                        PremiumButton(
                          label: _creating ? 'Create account' : 'Sign in',
                          onTap: _submit,
                          busy: _busy,
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
          ),
        ),
    );
  }
}


class PremiumButton extends StatelessWidget {
  const PremiumButton({
    super.key,
    required this.label,
    this.onTap,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null && !busy;
    return MouseRegion(
      cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      child: GestureDetector(
        onTap: enabled ? onTap : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          height: 46,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            gradient: enabled
                ? const LinearGradient(
                    colors: [
                      DexColors.accent,
                      Color(0xFF8BA5FF),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  )
                : null,
            color: enabled ? null : DexColors.border,
            boxShadow: enabled
                ? [
                    BoxShadow(
                      color: DexColors.accent.withValues(alpha: 0.25),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    )
                  ] 
                : null,
          ),
          alignment: Alignment.center,
          child: busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(DexColors.bg),
                  ),
                )
              : Text(
                  label,
                  style: DexType.label(color: DexColors.bg).copyWith(
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.5,
                  ),
                ),
        ),
      ),
    );
  }
}