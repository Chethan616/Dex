# Flights — Google Flights (and Kiwi.com)

DEX's own playbook (not synced from upstream). URL forms checked to load on
2026-10-07. Google changes its layouts often: read the page, don't trust
fixed selectors.

## First choice: the Kiwi.com connector

If `mcp__remote_kiwi__search-flight` is among your tools, the user added
Kiwi.com in the Marketplace: it returns structured results with prices,
times and booking links, faster than any page. Use it, then use Google
Flights to compare or when Kiwi has no result.

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

Give the user a short table — airline, depart → arrive, duration, stops,
price — with the 3–5 best, not everything.

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
