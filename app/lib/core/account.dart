// Local account identity — UI-only auth for now.
//
// There is no backend: "signing in" just persists a display name +
// email in SharedPreferences so the app has an identity surface
// (greeting, Account tab, profile menu) and a real sign-in/sign-out
// FLOW to hang future auth on. Sign-out clears the flag and routes
// back to the login screen; nothing about the agent stack (keys,
// models, channels) is touched by account state.

import 'package:shared_preferences/shared_preferences.dart';

const String _kSignedIn = 'dex.account.signedIn';
const String _kName = 'dex.account.name';
const String _kEmail = 'dex.account.email';

class DexAccount {
  DexAccount._({required this.signedIn, this.name, this.email});

  final bool signedIn;
  final String? name;
  final String? email;

  static Future<DexAccount> load() async {
    final prefs = await SharedPreferences.getInstance();
    return DexAccount._(
      signedIn: prefs.getBool(_kSignedIn) ?? false,
      name: prefs.getString(_kName),
      email: prefs.getString(_kEmail),
    );
  }

  static Future<void> signIn({required String name, required String email}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kSignedIn, true);
    await prefs.setString(_kName, name.trim());
    await prefs.setString(_kEmail, email.trim());
  }

  static Future<void> signOut() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kSignedIn, false);
  }
}
