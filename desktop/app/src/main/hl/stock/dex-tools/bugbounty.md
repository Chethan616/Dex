# Skill: authorized vulnerability assessment

Triggered by `/bugbounty <url>`. Finds and demonstrates **actual, exploitable
vulnerabilities** — broken access control, injection, XSS, CSRF that is
really enforceable, auth/session flaws, file-handling bugs, business-logic
abuse — with reproducible evidence of impact. A missing security header is
not a finding here; it is a footnote.

**The failure mode this replaces**: a report full of "Missing CSP — High",
"Missing X-Frame-Options — Medium", "robots.txt allows indexing —
Informational". Those are hardening gaps, not vulnerabilities, and dressing
them up as findings is exactly what a real bug-bounty program will bounce
back with "not applicable." This skill's job is to actually try to break the
thing, safely, and only claim what it can prove.

## Authorization and scope — do this first, every time

Before anything else, establish that the target is one this assessment is
allowed to touch, and what parts of it. It is allowed only if **one** of
these holds:

- the user owns or operates the site, or
- the site runs a public bug-bounty or vulnerability-disclosure program and
  this target is within its stated scope (check the program's scope page —
  subdomains, excluded assets, and disallowed techniques all matter), or
- the user has explicit written permission to test it, stating what is and
  isn't in scope.

If none is clearly true, **stop and ask** which applies. Do not proceed on
the assumption that it is fine, and do not let "I'll only look, not touch"
talk you into skipping this — active validation is exactly what this skill
does now, so the gate matters more than it used to, not less.

Once authorization is established, pin down scope explicitly: which
hosts/subdomains, which account is the tester's own, whether any accounts or
data belong to other real people (out of bounds regardless of anything else
below), and any techniques the program explicitly disallows. State the basis
and the scope in the report.

## Investigation flow

1. **Authorization and scope** (above).
2. **Map the attack surface** — walk the site (reuse `/scrape`'s approach if
   a site map already exists in `$DEX_SITE_MEMORY_DIR`) and build a concrete
   inventory: every endpoint, form, and API call seen; every parameter name;
   every place an ID appears in a URL, a hidden field, a request body, or a
   response. Authenticate as the tester's own account and repeat — most of
   the interesting surface is behind login.
3. **Discover functionality**, authenticated and not: what actions can be
   taken, what state changes, what data is returned.
4. **Enumerate identifiers and state-changing requests** specifically —
   this is the raw material for section 1 below, and it is worth a pass of
   its own rather than folding it into general mapping.
5. **Generate hypotheses** — for each piece of surface, name the vulnerability
   class that plausibly applies and *why* (see the classes below), before
   touching anything.
6. **Validate safely** — the tester's own account/data first, minimal
   requests, non-destructive techniques, comparing authorized vs.
   unauthorized responses rather than guessing. See each class's method.
7. **Require evidence before calling it a vulnerability.** No exploit
   demonstrated, no unauthorized outcome shown → it is not CONFIRMED or
   LIKELY, no matter how suspicious it looks. Downgrade to INFORMATIONAL or
   drop it.
8. **Report** only findings that clear that bar in the main findings section;
   everything else goes to Security Hygiene / Informational.

## Vulnerability classes, in priority order

### 1. Broken access control / IDOR / BOLA — highest priority

Look for identifiers anywhere in requests or responses: `userId`,
`studentId`, `applicationId`, `documentId`, `courseId`, `registrationId`,
`recordId`, `semesterId`, attendance IDs, marks/grade IDs, receipt/document
IDs, or any other object reference. For each one, ask: **is authorization
enforced server-side, or does the server just trust that the ID in the
request belongs to the caller?**

Safe validation:
- Compare a request for the tester's own resource against the same request
  with the ID changed to a neighboring value (sequential ID, or a second
  test account the tester controls) — do this with **non-sensitive metadata
  first**: does the server even return a `200` / a body shape indicating the
  record exists, before deciding whether to pull anything more.
- If a second controlled account is available, use it as the "victim" —
  never a real, unrelated user's account.
- If no second account is available, evidence can still be strong from: the
  ID being predictable/sequential, the endpoint returning data for the
  tester's own valid ID, and the same endpoint returning a *different but
  still well-formed, non-error* response for an adjacent ID (as opposed to a
  clean 403/404 that would show authorization is actually checked).
- Never enumerate real users' IDs at volume to "prove the pattern" — one or
  two adjacent values is validation; scanning a range is enumeration.

**Do not** blindly walk IDs pulling real students' records to "prove" the
bug. The proof is that the server returned *something* it should have
refused — reading the minimum needed to establish that (ideally metadata,
not the full sensitive record) is enough. Stop as soon as unauthorized
access is demonstrated.

Report as CONFIRMED only when there is direct evidence an authenticated
user reached or changed a resource outside their authorization. A 403/404
on the adjacent ID is a **negative** result — record it as a checked,
not-vulnerable path, not a finding.

### 2. Parameter tampering

Identify parameters that carry resource ownership, user identity, record
identity, semester/course selection, permissions, workflow state,
prices/fees, application status, or document selection — anything the
server *should* be deriving from the authenticated session rather than
trusting from the client.

Change one such parameter at a time (own account, own resources, or a
disposable test value) and check whether the server's response changes in a
way that bypasses an authorization or business-rule check. A price that
changes because the client sent a different one and the server accepted it
without re-validating server-side is a finding. A dropdown that only offers
the values the UI wants you to pick, but the server independently validates
whatever comes through, is not — confirm which one you're looking at before
reporting either way.

Ordinary client-side manipulation (editing a hidden field, changing a select
value) is not itself a vulnerability. It only becomes one when it produces a
meaningful unauthorized outcome server-side.

### 3. Authentication and session flaws

Investigate, using the tester's own account:
- Can any authenticated action be reached without authenticating at all?
- Does a session fixate — does a pre-login session ID remain valid and
  privileged after login, rather than being rotated?
- Does logging out actually invalidate the session server-side, or does the
  old token/cookie keep working against protected endpoints afterward?
- Is there a path to privilege escalation — an ordinary account reaching an
  admin/staff-only action or view?
- Are authorization checks consistent across equivalent endpoints — e.g. the
  web UI blocks an action but a mobile/legacy API path for the same action
  does not?

Cookie attributes (`Secure`, `HttpOnly`, `SameSite`) are checked and noted,
but a missing flag alone is Informational. It becomes a real finding only
when it is shown to enable something concrete — e.g. session theft is
actually feasible in this deployment's threat model (mixed HTTP content
present, XSS demonstrated separately, a documented MITM-feasible network
path) — state exactly what the missing flag enables here, or file it as
hardening.

### 4. CSRF

For every state-changing endpoint found in the attack-surface map (anything
that creates, modifies, deletes, or transitions state — not GETs), determine
whether server-side validation is *actually enforced*, not just whether a
token is present in the form:

- Does a token exist in the request?
- Is it validated server-side — does the request succeed if you strip it, or
  send an empty/malformed value, using the tester's own authenticated
  session?
- Is it single-use or reusable? Bound to the session that requested it, or
  accepted regardless of which session presents it?
- Is the endpoint genuinely state-changing in the first place — a POST that
  only re-renders the same read-only view is not a CSRF target even without
  a token.

Report CSRF only where a state-changing action was actually completed
against the tester's own account *without* a valid, session-bound token —
i.e., the request succeeded when it should have been rejected. "I didn't see
a token on this page" is a hypothesis, not a finding — go confirm whether
the server checks one before reporting anything.

### 5. XSS

Look for reflected input, stored input, DOM-based sinks, and unsafe
HTML/template interpolation, using **harmless, clearly-inert proof-of-concept
payloads** (e.g. a marker string that would only execute if actually
interpreted as HTML/script — `<svg onload=alert(1)>`-style test values or
similar non-destructive markers), and only against inputs the tester is
authorized to submit (their own profile fields, their own comments/posts,
search boxes, etc. — never another user's stored content).

Confirm the payload actually reaches an executable sink (renders unescaped
into HTML, into an attribute, into a script context, or into the DOM via an
unsafe API) in a context that matters — not just that it appears verbatim
somewhere. Reflected-but-encoded input is not XSS. A missing CSP is not XSS,
and does not become XSS just because a sink also exists nearby — the sink is
the finding; the CSP (or lack of it) is a separate, informational note about
how much a real XSS there would be worth.

Clean up any stored PoC content afterward if the target doesn't do so
automatically.

### 6. Injection (SQL, NoSQL, command, template, LDAP, XPath)

Where the attack surface and authorization scope make it appropriate,
probe with **non-destructive** techniques: boolean/error-based differential
responses (does a single quote change the response differently than an
escaped single quote?), timing differentials for blind cases, and template
syntax echoed back unrendered vs. rendered. Never use payloads designed to
modify, delete, or exfiltrate data, and never chain a suspected injection
into an actual data dump, write, or OS command — the differential response
itself is the evidence, not what you could theoretically do with it next.

Do not run `DROP`, `DELETE`, `UPDATE`, `UNION SELECT` against real tables,
destructive OS commands, or anything that persists a change. A confirmed
injection point can be reported and remediated without ever having proven it
by actually damaging or extracting real data.

Require a genuine differential (the server visibly behaves differently
based on injected syntax vs. its escaped equivalent) before calling
something CONFIRMED. A single unusual error page on a malformed request,
with no differential and no further signal, is LIKELY at best — say what
additional check would resolve it.

### 7. File handling

Investigate path traversal, arbitrary file read, unsafe file
download/serving, unrestricted file upload (type/extension/content
validation), filename or path manipulation, and authorization bypass on
documents (can the tester reach another document by changing an ID or path
segment — this overlaps with IDOR/section 1 and should be cross-referenced,
not double-counted).

Use harmless, clearly-marked test files and paths the tester controls (a
test upload with an innocuous name and content; a traversal probe aimed at
a known-safe file within the test scope, not `/etc/passwd` or
`C:\Windows\win.ini` on someone else's infrastructure). Do not attempt to
read real system files, configuration containing secrets, or other users'
private files merely to prove the class of bug exists — proving that a
traversal sequence reaches *outside* the intended directory at all (e.g. by
reaching a known, harmless, predictable file one directory up) is sufficient
evidence without needing to reach anything sensitive.

### 8. Business-logic vulnerabilities

Look for workflows where the server trusts client-controlled state instead
of re-deriving or re-checking it: skipping a required step by calling a
later step's endpoint directly, replaying a completed action (does
submitting the same "finalize" request twice do it twice?), duplicate
submission of something that should be idempotent or single-use, modifying
values across a multi-step workflow that should be fixed once set (e.g. a
price or an approver decided in step 1, re-sent by the client in step 3),
or reaching step 3 without ever completing step 1 or 2.

These require walking the actual workflow once normally first, so the
expected sequence and expected server-side checks are understood, then
retrying it out of order or with a substituted value from the tester's own
session. A concrete unauthorized outcome — a workflow completed with a step
skipped, a value that should have been server-controlled instead being
accepted from the client — is what makes this reportable, not merely
"the state machine seems permissive."

### 9. Information disclosure

Distinguish harmless metadata from sensitive disclosure. Worth reporting:
credentials, session tokens, API keys, internal authorization data, private
student/user information, other users' records, or sensitive server
configuration actually reachable by the tester. Generic framework/version
banners are Informational, not a major finding, unless a specific known
exploit for that exact version is also demonstrated against the target
(if so, that's really a finding in a different class above, referencing the
disclosure as how it was found).

## Evidence requirements

Every vulnerability candidate carries, at minimum:

1. Target/endpoint
2. Preconditions (account state, prior steps required)
3. Exact request or action used
4. Expected secure behavior
5. Actual behavior
6. Security impact
7. Minimal safe reproduction
8. Evidence supporting exploitability (the actual response/observation, not
   a description of what it probably was)
9. Suggested remediation

### Confidence levels

- **CONFIRMED** — reproducible security impact actually demonstrated.
- **LIKELY** — strong evidence, but full impact needs a validation step this
  skill didn't take (e.g. it would require a second real account, or a
  destructive step that's out of bounds) — say exactly what that step is.
- **INFORMATIONAL** — a real hardening gap (missing header, verbose banner,
  missing SRI, etc.) with no demonstrated exploitability. Still worth
  listing, just not as a vulnerability.
- **FALSE POSITIVE** — investigated and determined not vulnerable (e.g. the
  adjacent-ID request correctly 403'd, the CSRF token was validated and
  rejected when stripped). Record these too — a program wants to see what
  was checked, not just what was found.

Only CONFIRMED and strong LIKELY findings go in the main findings section.
Missing headers, obsolete-but-unexploited libraries, verbose banners, `robots.txt`
entries with nothing sensitive actually reachable behind them, and other
defense-in-depth gaps go in Security Hygiene / Informational — always, even
if that section ends up longer than the findings. Do not inflate a header
finding to Medium/High severity because the findings section would otherwise
look thin; a short findings section with nothing exaggerated is the correct
outcome for a well-hardened site.

## Live output while working

Maintain and show, as you go (not only at the end):

```
TARGET
AUTHORIZATION/SCOPE
ATTACK SURFACE
TESTING CONSTRAINTS
```

then keep these updated through the assessment:

- **ATTACK SURFACE** — endpoints, parameters, authenticated functionality,
  state-changing operations, file handling, object identifiers found so far.
- **HYPOTHESES** — suspected vulnerability, why it might exist, the safe
  validation method chosen for it. Add these as surface is discovered, before
  validating them.
- **VALIDATED FINDINGS** — confirmed vulnerabilities, with evidence, impact,
  and reproduction, as each is nailed down.
- **INFORMATIONAL** — missing headers, obsolete headers, defense-in-depth
  recommendations, and other hardening observations, collected separately
  from the moment they're noticed.

## The report

Save to `$DEX_SITE_MEMORY_DIR/<host>.security.md` and record it with
`dex-state file`. Open with the authorization basis, the scope actually
tested, and a one-line summary of what was and wasn't found. Then, for every
CONFIRMED or strong LIKELY finding:

```markdown
### <Title>
**Severity:** <Critical / High / Medium / Low / Informational — based on demonstrated impact>
**Affected endpoint:** <method + path>
**Vulnerability class:** <e.g. IDOR, Reflected XSS, CSRF, ...>
**Confidence:** <CONFIRMED / LIKELY>

**Summary:** <one or two sentences>

**Prerequisites:** <account state, access needed>

**Steps to reproduce:**
1. ...

**Expected behavior:** <what a correctly-authorized server would do>
**Actual behavior:** <what it did instead>
**Security impact:** <concrete consequence — not "this could potentially...">
**Evidence:** <the actual request/response or observation>
**Remediation:** <the concrete fix>
```

Rank most severe first. Base severity on demonstrated impact, not on the
existence of a missing control — a working IDOR on financial/academic
records is High or Critical; a missing `X-Frame-Options` with no framing
attack actually shown is, at most, an Informational note, never a standalone
Medium finding.

Close with a **Security Hygiene / Informational** section listing every
hardening gap noted along the way (headers, TLS details, outdated-but-not-
exploited libraries, verbose errors, etc.), and — if any hypotheses were
investigated and cleared — a short **Checked, Not Vulnerable** list, since a
program benefits from knowing what was tried and ruled out, not only what
broke.

## Safety boundaries — non-negotiable regardless of what the methodology above allows

This skill must not, under any circumstances:

- act outside the declared/authorized scope
- brute-force accounts or credentials
- enumerate large numbers of real users, or pull real users' private data to
  "prove" access control is broken beyond the minimum needed
- retrieve, modify, or delete another real user's data
- run destructive database operations (`DROP`/`DELETE`/`UPDATE`/persistence)
  or destructive OS commands
- deploy any form of persistence, backdoor, or malware
- exfiltrate credentials, secrets, or tokens anywhere outside the report
  itself
- perform load or denial-of-service testing
- evade authorization controls for anything outside the authorized test
  scope, or chain a finding into unauthorized access beyond what's needed to
  demonstrate it

For access-control testing specifically, always prefer the tester's own
resources or an explicitly provided second test account over touching any
other real account's data — this is the one rule with no exception in this
document, methodology or not. When a validation step would require crossing
one of these lines, stop, mark the finding LIKELY (not CONFIRMED), and say
exactly what step was skipped and why — do not take the line-crossing step
"just to be sure."
