# Hotels — Google Hotels

DEX's own playbook (not synced from upstream). URL form checked to load on
2026-10-07. Read the page; layouts change.

## Search by URL

```
https://www.google.com/travel/search?q=<words>&hl=en&curr=<CUR>
```

| Want | `q` |
|---|---|
| Place and dates | `hotels in Goa from 2026-11-15 to 2026-11-18` |
| Guests | `… for 2 adults` |
| Area | `hotels near Baga Beach Goa …` |
| Kind | `resorts in …`, `hostels in …`, `vacation rentals in …` |

Filters (price, rating, free cancellation, amenities) are chips at the top;
click them rather than guessing URL parameters.

## Reading the results

Hotel cards carry aria-labels with the name, nightly price, rating and
review count. Read them the same way as flights:

```js
[...document.querySelectorAll('[aria-label]')]
  .map((e) => e.getAttribute('aria-label'))
  .filter((t) => /\b(rupees|dollars|euros|pounds)\b/i.test(t) && /(star|rating|reviews)/i.test(t))
  .slice(0, 15)
```

Opening a hotel shows **Prices** (the same room from each booking site),
**Reviews** and **Location**. When the user cares about price, compare the
sites in Prices; say which one is cheapest and whether it's refundable.

Give a short table — name, area, rating (reviews), price per night, total,
free cancellation — with the 3–5 best for what they asked.

## Booking

1. **Wait for the user to choose** the hotel, the room and the site.
2. Follow the site's flow and fill in guest details the user gave you.
3. **Stop at payment** — never type card numbers. Tell the user it's ready
   for them in the tab they can see.
4. Afterwards: the confirmation number in your reply, and the stay on their
   calendar if Google Calendar or Microsoft 365 is connected (ask first).
