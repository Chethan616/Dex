// Dex -- entry point.
//
// Boots the app, wires the GatewayClient + ConversationStore, and hands the
// home screen the listenable store. Window sizing for desktop uses Flutter's
// built-in window APIs -- no extra packages.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/gateway_client.dart';
import 'core/state/conversation_store.dart';
import 'screens/home_desktop.dart';
import 'theme/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setApplicationSwitcherDescription(
    const ApplicationSwitcherDescription(label: 'Dex'),
  );

  // Read gateway URL + auth token from ~\.openclaw\openclaw.json so we
  // don't have to ask the user for them.
  final client = GatewayClient(GatewayConfig.fromLocalConfig());
  // Best-effort connect; the UI shows the live connection state.
  unawaited(client.connect());

  final store = ConversationStore(client);

  runApp(DexApp(store: store));
}

void unawaited(Future<void> _) {}

class DexApp extends StatelessWidget {
  const DexApp({super.key, required this.store});

  final ConversationStore store;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dex',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      theme: buildDexLightTheme(),
      darkTheme: buildDexDarkTheme(),
      home: HomeDesktop(store: store),
    );
  }
}
