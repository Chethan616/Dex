# Skill: authorized security-posture review

Triggered by `/bugbounty <url>`. Produces a report of security weaknesses that
are **observable without attacking the target** — the kind of review a site
owner runs on their own service, or a researcher runs within the rules of a
published bug-bounty program.

## Authorization — do this first, every time

Before anything else, establish that the target is one this review is allowed
to touch. It is allowed only if **one** of these holds:

- the user owns or operates the site, or
- the site runs a public bug-bounty or vulnerability-disclosure program and
  this target is within its stated scope, or
- the user has explicit written permission to test it.

If none is clearly true, **stop and ask** which applies. Do not proceed on the
assumption that it is fine. Reviewing a system you are not authorized to test
is often unlawful, and "it was just headers" is not a defence worth relying on.

State in the report which basis applied.

## What this review does — observation only

Everything here reads what the site already exposes. None of it attacks:

- **Transport** — HTTPS enforced, HSTS present, TLS not obviously outdated, no mixed content.
- **Security headers** — Content-Security-Policy, X-Frame-Options / frame-ancestors, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Note what is missing and what it would prevent.
- **Cookies** — Secure, HttpOnly and SameSite on session cookies.
- **Client libraries** — JavaScript frameworks and libraries with versions in the page, flagged against known-vulnerable ranges. Report the version and the concern; do not exploit it.
- **Exposed paths** — only conventional, low-risk locations a site chooses whether to publish: `robots.txt`, `sitemap.xml`, `security.txt`, `.well-known/`, a visible `.git/` or `.env`, directory listings, source maps. Fetch the path and note if it reveals something it should not.
- **Information disclosure** — server/version banners, stack traces on a normal 404, verbose error pages, secrets left in client-side JavaScript or HTML comments.
- **Form and auth hygiene** — login forms served over HTTPS, visible CSRF protection, password fields not autocompleting on shared flows. Observe the form; never submit credentials or test payloads.

## What this review will not do

Not now, not on request within this skill:

- No exploitation of any weakness it finds.
- No authentication bypass, privilege escalation, or session attacks.
- No injection, XSS, SSRF, or fuzzing payloads against live endpoints.
- No brute force, credential stuffing, or password spraying.
- No load or denial-of-service testing.
- No automated vulnerability scanners hammering the target.
- No pivoting to other hosts or domains.

If a real test of a finding is warranted, that is a separate, explicitly
authorized engagement — say so in the report and stop there.

## Method

1. Confirm authorization (above).
2. Fetch the target over HTTP with the browser or a plain request and read the response headers and TLS.
3. Load the page and read its scripts, comments, and any inline config for versions and leaked values.
4. Fetch the handful of conventional paths listed above, gently — one request each, no enumeration.
5. Inspect the main forms as rendered.

## The report

Save to `$DEX_SITE_MEMORY_DIR/<host>.security.md` and record it with
`dex-state file`. For each finding:

```markdown
### <finding> — <severity: info / low / medium / high>
Observed: <exactly what was seen, with the evidence>.
Why it matters: <the risk, plainly>.
Fix: <the concrete change>.
```

Rank most serious first. Open with the authorization basis and one line on
scope. Be precise about severity — a missing Referrer-Policy is `info`, a
session cookie without `Secure` over a login flow is `high`. Overstating
findings is its own kind of wrong.
