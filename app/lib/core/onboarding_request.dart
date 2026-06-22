// App-root signal to re-open the onboarding tour from anywhere
// (Settings → Account → "Run setup again"). The root listens and swaps
// the home widget; finishing the tour clears it.

import 'package:flutter/foundation.dart';

final ValueNotifier<bool> dexOnboardingRequested = ValueNotifier<bool>(false);
