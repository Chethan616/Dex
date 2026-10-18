# Skill: widgets — ask with controls, show with cards

`dex-ui` puts a real control in the chat (on the PC and the phone) instead of
prose. It's a fixed kit, so it costs you a small JSON spec, not a web page.

**The rules**

1. Need something from the user — a place, a date, a time, a number, or one
   of a few options? **Ask with `dex-ui`, then end your turn.** Never type
   "Where are you flying from?" or "Which date?" as plain text. Their answer
   arrives as their next message ("Hyderabad (HYD)", "Fri, 9 Oct 2026
   (2026-10-09)").
2. Ask **once, for everything you're missing**, in one form — not one
   question per turn. Don't ask for what you can infer: today's date, what
   they already said, their home city if you know it.
3. **Never** write "visit https://… for more details" or "go to … and search".
   Give a button: `dex-ui link "Open in Google Flights" "<url>"`.
4. Results with a shape — flights, hotels, places, products, plans to pick
   from — go in **cards** (best first, at most 6), with at most two sentences
   of prose around them. A booking, a diagnosis or a summary of key numbers
   goes in **facts**.
5. A card's **reply** action sends its text as the user's next message: use
   it for "Select" / "Book this" / "Use this one", then act on it when it
   arrives (and still ask before paying).

## Quick forms

```bash
dex-ui choose "Which cabin?" "Economy" "Premium economy" "Business"
dex-ui link "Open in Google Flights" "https://www.google.com/travel/flights?q=..." "Directions" "https://www.google.com/maps/dir/?api=1&destination=..."
```

## The full kit (JSON on stdin)

```bash
dex-ui ask <<'EOF'
{"title": "Where and when are you flying?", "icon": "flight",
 "fields": [
   {"id": "trip", "kind": "choice", "label": "Trip", "options": ["One way", "Round trip"]},
   {"id": "from", "kind": "place", "label": "From", "suggestions": ["Hyderabad (HYD)", "Bengaluru (BLR)"]},
   {"id": "to", "kind": "place", "label": "To", "suggestions": ["Delhi (DEL)", "Goa (GOI)"]},
   {"id": "depart", "kind": "date", "label": "Depart", "default": "2026-10-09"},
   {"id": "back", "kind": "date", "label": "Return", "showIf": {"field": "trip", "is": "Round trip"}},
   {"id": "pax", "kind": "number", "label": "Travellers", "min": 1, "max": 9, "default": 1, "unit": "adult(s)"}
 ],
 "submit": "Find flights"}
EOF
```

`ask` — `title` (the question), optional `note`, `icon`, `submit`, and 1–6
`fields`. Each field has an optional `id` and `label`, `optional: true` if it
may be left empty, `showIf: {"field": "<id>", "is": "<answer>"}` to show it
only while another field has that answer (`is` can be a list), and a `kind`:

| kind | extra keys | what the user gets |
|---|---|---|
| `choice` | `options` (2–12 strings, or `{label, detail?, value?, icon?}`), `multi`, `other` (adds "Something else…") | pills, or rows when options have a `detail` |
| `place` | `suggestions` (≤8), `placeholder` | suggestion pills + a field |
| `date` | `min`, `max`, `default` (YYYY-MM-DD), `range: true` for a start and end | a strip of the next 7 days + a calendar. Past days are off unless you set `min` |
| `time` | `slots` (≤12, "HH:MM" 24h), `default` | slot pills + a time field |
| `number` | `min`, `max`, `step`, `default`, `unit` | a − n + stepper |
| `text` | `placeholder`, `multiline` | a field |

A one-field question answers in one tap; a form sends with its button.

```bash
dex-ui cards <<'EOF'
{"title": "Hyderabad → Delhi · Fri 9 Oct", "icon": "flight",
 "items": [
   {"title": "IndiGo 6E 2345", "subtitle": "07:05 → 09:15 · 2h 10m · Non-stop", "price": "₹4,850", "badge": "Cheapest",
    "actions": [{"label": "Select", "reply": "Book IndiGo 6E 2345 at 07:05", "primary": true},
                {"label": "Open", "url": "https://www.google.com/travel/flights?..."}]}
 ]}
EOF
```

`cards` — `title`, `icon`, and 1–8 `items`: `title`, `subtitle`, up to 3
`lines`, `price`, `badge` (≤24 chars: "Cheapest", "4.6 ★", "Open now"),
`icon`, and up to 3 `actions`.

`buttons` — `title`, 1–6 `buttons`.

`facts` — `title`, `icon`, 1–12 `rows` of `{label, value}`, up to 3 `actions`.

An **action** is `{label, url}` (https, http, mailto:, tel:, geo:) or
`{label, reply}`, with optional `primary: true` and `icon`.

**Icons:** flight, hotel, food, place, directions, calendar, time, mail,
call, cart, money, doc, code, music, link, person, star, ticket, car, train,
weather, pc, check.

## Triage — answering a batch of messages

"Reply to my unread emails", "go through today's WhatsApp", "answer my Slack
DMs": the user gets one card. Each message is a point on two axes, urgency
across and importance up, in four corners: Reply now · Quick reply · Plan a
reply · Later. Tapping a point opens the message with your drafted reply and
three buttons: **Yes** (send it), **No** (leave it), **Specify** (they say
what to change). Five or fewer show as a list instead of the plot.

1. **Fetch them.** Use the connector for the platform: Gmail or Outlook (MCP),
   Slack (MCP). WhatsApp and Telegram are their Windows apps, read with
   `mcp__windows__*` (see `desktop.md`). Take what was asked — "today", "unread",
   "from my team" — and at most 40. Read each one in full.
2. **Check who matters.** `dex-recall` for the people and their work before
   scoring; DEX's memory knows their manager, family and clients.
3. **Score each one, 0–10:**
   - **Urgency** is time pressure. A deadline today or a meeting within hours
     is 9–10. "Can you reply soon" or tomorrow is 7–8. This week is 5–6. No
     time pressure is 0–3.
   - **Importance** is who and what. Their manager, a client, a professor,
     family, or anything about money, health, legal matters, grades or a job
     offer is 8–10. A colleague or friend on something that matters is 5–7.
     FYI and social messages are 3–4. Newsletters, promotions and automated
     notifications are 0–2.
   - Five and up counts as high on that axis.
   - **Category**, what it's about: `academics` (college, courses, exams,
     professors), `work` (job, clients, colleagues), `personal` (family,
     friends, home) or `other` (shops, newsletters, notifications). It's the
     point's colour, and opening a corner splits it into one small plot per
     category. It never moves a point: the scores alone do that, so score
     each message on its own merits, not by its category.
4. **Draft each reply** as the user would write it, using their tone from
   memory. Keep it short, write in the language the message came in, and sign
   off the way they sign. No `draft` at all for something that needs no reply
   (a receipt, a newsletter, a no-reply sender).
5. **Show the card — always, even when nothing needs a reply** (four
   newsletters are four points in Later, without drafts: the user sees what
   came in and decides). Then end your turn:

```bash
dex-ui triage <<'EOF'
{"title": "Today's unread mail", "source": "gmail",
 "items": [
   {"id": "18c2f4a9b0e1", "from": "Priya Shah", "address": "priya@acme.com",
    "subject": "Q3 budget sign-off", "at": "9:42 am",
    "preview": "Need your sign-off on the Q3 numbers by 4 pm today…",
    "body": "<the message, in full or its first ~40 lines>",
    "urgency": 9, "importance": 9, "why": "Deadline 4 pm, your manager", "category": "work",
    "draft": "Hi Priya, signed off — the numbers look right. Thanks!"},
   {"id": "18c2f1d07e2a", "from": "Swiggy", "subject": "Your order receipt",
    "preview": "Order #4812 delivered", "urgency": 1, "importance": 1, "why": "Receipt, no reply needed", "category": "other"}
 ]}
EOF
```

Each item takes:
- `id`: the message or thread id from the connector, so you can find it again;
- `from`, plus optional `address`, `subject` (emails), `at`;
- `preview` (≤300 characters) and `body` (≤4000);
- `urgency` and `importance`;
- `why`, one line;
- `category`: academics, work, personal or other;
- `draft`;
- `source` per item, when they're mixed.

`dex-ui` answers with the card's id (`w…`). The card stays live: the user
answers messages in any order, one at a time.

6. **Each answer arrives as its own message** and says exactly what to do:
   - "Yes, send my reply to Priya Shah": it carries the reply. They may have
     edited it, so send exactly that, in the same thread, from the same
     account. Then mark it: `dex-ui mark <card> <item> sent`, or `failed "<why>"`.
   - "Change my reply to Priya Shah: …": redraft it. Put the new draft back
     with `dex-ui redraft <card> <item>` (text on stdin), don't send, and end
     your turn.
   - No: you never hear it. DEX marks the message skipped itself.

Send nothing without a Yes on that message. The exception is when the user
asks you to reply to one specific message or person ("reply to Priya and say
I'll call at 5"): draft it and send it straight away, then say in one line
what you sent.

## Ideas, by kind of task

- **Travel:** ask one way or round trip first, then from / to / dates /
  travellers, in one form. The return date has `showIf` on the trip choice,
  so a one-way traveller never sees it. Never assume a round trip; flights or
  hotels as cards with Select + Open; the chosen trip as facts.
- **Food and places:** ask area, party size and time (slots); restaurants as
  cards (rating badge, cuisine · distance) with Directions and Call.
- **Scheduling:** offer free slots from the calendar as `time` slots on a
  `date`; the booked event as facts with "Open in Calendar".
- **Shopping:** budget as a `number`, size/colour as `choice`; products as
  cards with price and "Open".
- **Mail and docs:** which draft or which file as `choice` rows with a
  detail line; "Open in Gmail" / "Open doc" buttons.
- **Code:** two or three approaches as `choice` rows with a one-line
  trade-off each; "Open PR" / "View diff" buttons.
- **Fixing the PC:** what you found as facts; the fixes as `choice` rows,
  cheapest first.

If `dex-ui` says the spec doesn't fit, it says which key — fix that and run it
again. Keep the prose short: the widget is the answer.
