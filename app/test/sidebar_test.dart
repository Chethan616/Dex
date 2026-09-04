// The sidebar groups history the way a person thinks about it.
//
// `when` is already a phrase — "2h ago" — and a phrase cannot be bucketed, so
// twenty rows of "2h ago", "5h ago", "yesterday" read as one undifferentiated
// list. The timestamp is carried alongside so the rows can be split.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dex/widgets/dex_sidebar.dart';
import 'package:dex/widgets/home/recent_chats_card.dart';

RecentChatItem chat(String id, DateTime? at) => RecentChatItem(
      id: id,
      title: id,
      when: 'whenever',
      at: at,
    );

void main() {
  final now = DateTime.now();

  testWidgets('history is split into today, yesterday and earlier',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 260,
          height: 800,
          child: DexSidebar(
            expanded: true,
            recentChats: [
              chat('this morning', now.subtract(const Duration(hours: 3))),
              chat('last night', now.subtract(const Duration(days: 1))),
              chat('last week', now.subtract(const Duration(days: 8))),
            ],
            activeChatId: null,
            userName: 'Dex user',
            onToggle: () {},
          ),
        ),
      ),
    ));
    await tester.pump();

    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Yesterday'), findsOneWidget);
    expect(find.text('Earlier'), findsOneWidget);
    expect(find.text('this morning'), findsOneWidget);
  });

  testWidgets('rows with no timestamp still show, with no heading',
      (tester) async {
    // A core from before conversations existed sends task rows with no
    // lastAt. Showing nothing would be worse than showing them ungrouped.
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 260,
          height: 800,
          child: DexSidebar(
            expanded: true,
            recentChats: [chat('an old task', null)],
            activeChatId: null,
            userName: 'Dex user',
            onToggle: () {},
          ),
        ),
      ),
    ));
    await tester.pump();

    expect(find.text('an old task'), findsOneWidget);
    expect(find.text('Today'), findsNothing);
  });

  testWidgets('the rail is grouped rather than six equal rows',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 260,
          height: 800,
          child: DexSidebar(
            expanded: true,
            recentChats: const [],
            activeChatId: null,
            userName: 'Dex user',
            onToggle: () {},
          ),
        ),
      ),
    ));
    await tester.pump();

    expect(find.text('AUTOMATE'), findsOneWidget);
    expect(find.text('THIS MACHINE'), findsOneWidget);
    // New chat stays on its own, above both.
    expect(find.text('New chat'), findsOneWidget);
  });
}
