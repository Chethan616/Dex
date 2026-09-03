// A search result is drawn, not read out.
//
// The bug this covers: twenty files came back as
// `matches name=… path=… directory=…, name=… (+12 more)` — a paragraph with
// every path in it three times. These tests hold the two halves of the fix:
// the frame parses into rows, and a malformed one degrades to nothing rather
// than throwing in the middle of a conversation.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dex/core/models/artifact.dart';
import 'package:dex/widgets/chat/artifact_card.dart';

void main() {
  group('parsing what the core sent', () {
    test('a well-formed artifact becomes rows', () {
      final artifact = Artifact.tryParse({
        'kind': 'files',
        'title': '2 files found',
        'total': 2,
        'note': 'for "aadhaar" · 74,500 files indexed by name',
        'items': [
          {
            'label': 'aadhar.pdf',
            'detail': r'C:\Users\cheth\OneDrive\Documents\aadhar.pdf',
            'reasons': ['filename'],
            'bytes': 1319046,
          },
          {
            'label': 'scan001.jpg',
            'detail': r'C:\Users\cheth\CrossDevice\storage\Download\scan001.jpg',
            'reasons': ['OCR text', 'also called "uid"'],
            'excerpt': 'GOVERNMENT OF INDIA AADHAAR 1234 5678 9012',
          },
        ],
      });

      expect(artifact, isNotNull);
      expect(artifact!.items, hasLength(2));
      expect(artifact.items.first.label, 'aadhar.pdf');
      expect(artifact.items.last.reasons, contains('OCR text'));
      expect(artifact.items.last.excerpt, contains('AADHAAR'));
      expect(artifact.total, 2);
    });

    test('a frame with no items is not an artifact', () {
      expect(
        Artifact.tryParse({'kind': 'files', 'title': 'nothing', 'items': []}),
        isNull,
      );
    });

    test('rubbish degrades to null rather than throwing', () {
      expect(Artifact.tryParse(null), isNull);
      expect(Artifact.tryParse('a string'), isNull);
      expect(Artifact.tryParse({'items': 3}), isNull);
      // An item without a label cannot be drawn, and must not take the whole
      // card down with it.
      expect(
        Artifact.tryParse({
          'kind': 'files',
          'title': 'one good one bad',
          'items': [
            {'detail': 'no label here'},
            {'label': 'real.pdf'},
          ],
        })!.items,
        hasLength(1),
      );
    });
  });

  group('what the card shows', () {
    Widget wrap(Artifact artifact) => MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: ArtifactCard(artifact: artifact)),
          ),
        );

    testWidgets('the filename, the folder and why it matched', (tester) async {
      await tester.pumpWidget(wrap(Artifact.tryParse({
        'kind': 'files',
        'title': '1 file found',
        'total': 1,
        'items': [
          {
            'label': 'UI.png',
            'detail': r'C:\Users\cheth\OneDrive\Desktop\UI\UI INSPIRATIONS\UI.png',
            'reasons': ['filename'],
            'bytes': 2048,
          },
        ],
      })!));
      await tester.pump();

      expect(find.text('1 file found'), findsOneWidget);
      expect(find.text('UI.png'), findsOneWidget);
      // The folder, without the filename repeated after it.
      expect(
        find.text(r'C:\Users\cheth\OneDrive\Desktop\UI\UI INSPIRATIONS'),
        findsOneWidget,
      );
      expect(find.text('filename'), findsOneWidget);
      expect(find.text('2 KB'), findsOneWidget);
    });

    testWidgets('a count when more were found than are shown', (tester) async {
      await tester.pumpWidget(wrap(Artifact.tryParse({
        'kind': 'files',
        'title': '40 files found',
        'total': 40,
        'items': [
          {'label': 'one.pdf', 'detail': r'C:\a\one.pdf'},
        ],
      })!));
      await tester.pump();

      expect(find.text('40 files found'), findsOneWidget);
      expect(find.text('showing 1'), findsOneWidget);
    });

    testWidgets('the matching line, when the match was on contents',
        (tester) async {
      await tester.pumpWidget(wrap(Artifact.tryParse({
        'kind': 'files',
        'title': '1 file found',
        'total': 1,
        'items': [
          {
            'label': 'scan001.jpg',
            'detail': r'C:\a\scan001.jpg',
            'reasons': ['OCR text'],
            'excerpt': 'GOVERNMENT OF INDIA AADHAAR',
          },
        ],
      })!));
      await tester.pump();

      // Without this line the owner has to take on trust that a file named
      // scan001.jpg is the card they asked for.
      expect(find.text('GOVERNMENT OF INDIA AADHAAR'), findsOneWidget);
      expect(find.text('OCR text'), findsOneWidget);
    });
  });
}
