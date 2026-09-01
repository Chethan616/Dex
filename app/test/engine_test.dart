// Phase C.7-flutter -- unit tests for the engine-id mapping used to label
// tool chips + the Live panel running-engine card.

import 'package:dex/core/models/engine.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('engineForToolId', () {
    test('routes windows-desktop-control to ufo-uia', () {
      expect(engineForToolId('windows-desktop-control'), EngineId.ufoUia);
      expect(engineForToolId('run_desktop_task'), EngineId.ufoUia);
    });

    test('routes browser-control to browser-use', () {
      expect(engineForToolId('browser-control'), EngineId.browserUse);
      expect(engineForToolId('run_browser_task'), EngineId.browserUse);
    });

    test('routes omniparser tools to omniparser', () {
      expect(engineForToolId('omniparser'), EngineId.omniparser);
      expect(engineForToolId('parse_screen'), EngineId.omniparser);
    });

    test('handles MCP namespaced ids like mcp__server__tool', () {
      expect(
        engineForToolId('mcp__browser-control__run_browser_task'),
        EngineId.browserUse,
      );
      expect(
        engineForToolId('mcp__omniparser__parse_screen'),
        EngineId.omniparser,
      );
    });

    test('falls back to shell for built-in / unknown tools', () {
      expect(engineForToolId('bash'), EngineId.shell);
      expect(engineForToolId('read'), EngineId.shell);
      expect(engineForToolId('write'), EngineId.shell);
      expect(engineForToolId('edit'), EngineId.shell);
      expect(engineForToolId('process'), EngineId.shell);
      expect(engineForToolId('something-totally-new'), EngineId.shell);
    });
  });

  group('descriptorForEngine', () {
    test('every engine has a non-empty label + icon', () {
      for (final id in EngineId.values) {
        final d = descriptorForEngine(id);
        expect(d.label, isNotEmpty);
        expect(d.label, equals(d.label.toLowerCase()),
            reason: 'engine labels stay lowercase to match telemetry keys');
      }
    });

    test('label matches the orchestrator EngineId on the TS side', () {
      // These strings are the EngineId union members in
      // dex/core/src/orchestration/types.ts -- keep in sync.
      expect(descriptorForEngine(EngineId.shell).label, 'shell');
      expect(descriptorForEngine(EngineId.ufoUia).label, 'ufo-uia');
      expect(descriptorForEngine(EngineId.browserUse).label, 'browser-use');
      expect(descriptorForEngine(EngineId.omniparser).label, 'omniparser');
    });
  });
}
