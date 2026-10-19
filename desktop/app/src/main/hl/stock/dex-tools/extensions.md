# Chrome extensions in DEX's browser — `dex-ext`

DEX's browser runs real Chrome extensions from the Chrome Web Store, on every
page you use, just like in the user's own Chrome. Some sites only work with
one: a university's library proxy, a web3 site that needs a wallet, a reference
manager's "save" button, a site that says "install our extension to continue".
Others change what you see: an ad blocker, a dark mode, a translator.

## What's installed

```bash
dex-ext list
```

For each extension that's on, you get:
- what it does (its own description);
- its **button**: its title, its badge (a count, a status), and what pressing it
  does (`popup`, `side panel`, or `acts on the page`);
- where it runs (`every site`, or the sites it names);
- its **right-click items** on the page you're on;
- whether it's **off limits** (`password manager` or `wallet`).

Your prompt already names the installed extensions. Run `dex-ext list` when one
of them could help with the page you're on.

## When a site depends on one

Signs: the page says "install the extension", "extension not detected", "open
in the app", "connect your wallet"; a library or journal page asks you to sign
in through your institution; a button does nothing until an extension is there.

1. **It's installed:** use it the way the user would — usually its button
   (`dex-ext click`) or its right-click item (`dex-ext menu-click`).
2. **It isn't:** find it in the Chrome Web Store (a web search: `"<name>"
   chrome web store`), then `dex-ext install <store link>`. The user is asked
   to add it; they may say no. When added, reload the page so it runs there.
   Never install one the user didn't ask for unless the site plainly needs it,
   and say why in one line.
3. **It's off limits** (a password manager or a wallet): tell the user what to
   do in it ("approve the connection in MetaMask"), then carry on.

## Its button

```bash
dex-ext click "Zotero Connector"
```

- **acts on the page**: done at once (a proxy reloads the page through the
  library, a reader mode reflows it). Take a screenshot to see what changed.
- **popup** / **side panel**: it opens as a **background tab** in this task,
  and the result gives its `targetId`. Drive it like any tab:
  `session.use("<targetId>")`, read it, click it. The page you were on stays
  the extension's *current tab*, so whatever it does, it does there (saves
  that page, translates it, fills it). Close it with `dex-tab close <tab>`
  when you're done. If it says "no access to this page", the button is meant
  for another kind of page.

## Its right-click items

```bash
dex-ext menu                                  # items for the page itself
dex-ext menu --link "https://…"               # …for a link on it
dex-ext menu --image "https://…/cover.jpg"    # …for a picture
dex-ext menu --selection "the selected words" # …for some text
dex-ext menu-click "Google Translate" "Translate this page"
```

Pass the same `--link`/`--image`/`--selection` to `menu-click` as to `menu`.

## Its pages inside the page

Some extensions draw inside the page: a translator's bubble, a writing
assistant's panel, a coupon finder's box. Their frames are reachable like the
page's own (`dex-tab list`, `session.use`). A password manager's inline menu
and a wallet's frames are not.

## Its settings

```bash
dex-ext options "uBlock Origin Lite"
```

Opens its options page as a background tab. Its settings are the user's:
change one only when they asked you to.

## Rules

- **Password managers and wallets stay the user's.** You can't reach their
  pages or press their buttons. Never ask the user to paste a password from
  one; never approve, sign or send anything in a wallet — that's a payment.
- Pages look the way the user's extensions make them (no ads, dark colours, a
  proxy address in the URL). That's their setup; don't undo it.
- Don't remove or switch off extensions. If one gets in the way (an ad blocker
  breaking a checkout), tell the user which one and why.
