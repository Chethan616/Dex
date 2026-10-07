# Flights — Google Flights (and Kiwi.com)

DEX's own playbook (not synced from upstream). URL forms checked to load on
2026-10-07. Google changes its layouts often: read the page, don't trust
fixed selectors.

## Before searching: ask once, with a widget

Missing the origin, the date or how many are flying? Ask for all of it in
**one** `dex-ui ask` (a `place` for From/To with likely airports as
suggestions, a `date` — `range: true` for a return — and a `number` for
travellers), then end your turn. Never ask in prose, one thing at a time.
Don't ask for what you can infer ("on Friday" is a date you can work out).

## First choice: the Kiwi.com connector

Every travel task gets `mcp__remote_kiwi__search-flight` (no sign-in): it
returns prices, times and a booking link for each flight, in seconds and with
no page to drive. Search there first and show the best 3–6 as `dex-ui cards`
(Select, and the booking link as Open). Open Google Flights only to book the
one the user picks, or when Kiwi finds nothing.

## Google Flights by URL

One URL does the search; Google parses plain words in `q`:

```
https://www.google.com/travel/flights?q=<words>&hl=en&curr=<CUR>
```

| Want | `q` |
|---|---|
| One way | `Flights to DEL from BLR on 2026-11-15 oneway` |
| Return | `Flights from BLR to DEL on 2026-11-15 through 2026-11-20` |
| People, class | `… for 2 adults 1 child business class` |
| Nonstop only | add `nonstop` |
| Anywhere cheap | `Flights from BLR to anywhere in December` (Explore) |

Use IATA codes when you know them, city names otherwise. Set `curr` to the
user's currency (INR, USD, EUR…) and `hl=en` so the words below match.

## Reading the results

Each result row has an aria-label that already says everything — price,
airline, times, duration, stops:

```js
[...document.querySelectorAll('li [aria-label]')]
  .map((e) => e.getAttribute('aria-label'))
  .filter((t) => /\b(rupees|dollars|euros|pounds)\b/i.test(t) && /flight/i.test(t))
  .slice(0, 12)
```

"Best" and "Cheapest" are tabs above the list. The date grid and price graph
show cheaper days; mention them when the user's dates are flexible.

Show the 3–5 best as `dex-ui cards` (`icon: "flight"`): title = airline and
flight number, subtitle = "07:05 → 09:15 · 2h 10m · Non-stop", price, a badge
for "Cheapest" / "Fastest", and actions **Select** (`reply`: "Book <flight>
at <time>") and **Open** (`url`: the Google Flights link). Add one sentence on
cheaper nearby days if the date grid shows any. Never tell the user to go to
the site and search themselves — give the button.

## Booking

1. Show the options and **wait for the user to pick one**. Never book on
   your own judgement.
2. Clicking a flight → "Select" → the booking options (airline site or an
   agency). Prefer the airline's own site unless the user says otherwise.
3. You may fill in passenger details the user gave you.
4. **Stop at payment.** Never type card numbers (DEX hides card fields from
   you anyway). Tell the user the page is ready for them to pay, in the tab
   they can see.
5. After they've paid: if Google Calendar is connected, offer to add the
   flight; put the confirmation number in your reply.
