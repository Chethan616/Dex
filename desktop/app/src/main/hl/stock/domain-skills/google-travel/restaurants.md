# Restaurants and table bookings — Google Maps

DEX's own playbook (not synced from upstream). URL form checked to load on
2026-10-07. Read the page; layouts change.

## Search by URL

```
https://www.google.com/maps/search/<words>?hl=en
```

Examples: `restaurants near Indiranagar Bengaluru`,
`vegan restaurants open now in Koramangala`, `best biryani near me` (only
when the user's location is known — otherwise ask where).

## Reading the results

The results list is a feed of places (`[role="feed"]`); each place is a link
whose aria-label is its name, and the card text has the rating, review count,
price level, cuisine, whether it's open, and sometimes "Reserve a table":

```js
[...document.querySelectorAll('[role="feed"] > div')]
  .map((card) => card.innerText.replace(/\s+\n/g, '\n').trim())
  .filter(Boolean)
  .slice(0, 12)
```

Scroll the feed (not the page) for more. Opening a place shows hours, phone,
address, the menu link and recent reviews.

Show the best 3–5 as `dex-ui cards` (`icon: "food"`): name, "cuisine · price
level · distance" as subtitle, rating as the badge ("4.5 ★"), a line for
open-now or online booking, and actions **Directions** (`url`: a Google Maps
directions link), **Call** (`url`: `tel:`) and **Book** (`reply`) where they
can be booked.

## Booking a table

Places with **Reserve a table** book through a partner (OpenTable, Resy,
TheFork, EazyDiner, Dineout, Zomato… depending on the country).

1. **Confirm with the user** the place, date, time and party size first —
   one `dex-ui ask` with a `date`, `time` slots (the ones the place offers)
   and a `number` for the party.
2. Click Reserve a table, pick the slot, and fill in the name and phone
   number the user gave you.
3. **Ask before the final "Confirm"** if anything differs from what they
   asked (another time, a deposit, a cancellation fee). Never pay a deposit
   yourself — stop and hand it to them.
4. No online booking: give them the phone number and hours instead.
5. Afterwards: the booking details in your reply, and the reservation on
   their calendar if one is connected (ask first).
