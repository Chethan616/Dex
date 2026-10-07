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
   {"id": "from", "kind": "place", "label": "From", "suggestions": ["Hyderabad (HYD)", "Bengaluru (BLR)"]},
   {"id": "date", "kind": "date", "label": "Date", "default": "2026-10-09"},
   {"id": "pax", "kind": "number", "label": "Travellers", "min": 1, "max": 9, "default": 1, "unit": "adult(s)"}
 ],
 "submit": "Find flights"}
EOF
```

`ask` — `title` (the question), optional `note`, `icon`, `submit`, and 1–6
`fields`. Each field has an optional `id` and `label`, `optional: true` if it
may be left empty, and a `kind`:

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

## Ideas, by kind of task

- **Travel:** ask from / to / dates / travellers in one form; flights or
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
