"""
The verbs a browsing agent needs, and did not have.

Before this the deterministic surface was a CSS-selector click and a
CSS-selector type. No form filling, no tables, no tabs, no waiting, no
scrolling, no frames — so the planner emitted `navigate` because that was
mostly what existed, and everything harder fell to an autonomous loop that had
to rediscover the page every step.

Two ideas run through all of it:

**Address things the way a person would.** `fill_form({'Username': '21BCE1234'})`
matches on the label, the placeholder, the aria-label or the text beside the
box — not on a selector nobody can guess from outside. A plan written against
labels survives a site changing its markup, which is most of what changes.

**Report what did not happen.** Every verb returns what it managed and what it
could not, by name. A form filler that silently skips the field it could not
find is how a task "succeeds" having filled nothing.

Passwords stay refused here exactly as in `type_text`. `sign_in` remains the
only path that fills one.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

# Matched against a field's type and name. Same rule as type_text: a browsing
# model must not be able to reach a password by asking for one nicely.
_SECRET = ('password', 'otp', 'mfa', '2fa', 'one-time', 'onetime', 'cvv', 'pin')


def _is_secret(field: dict) -> bool:
    haystack = f"{field.get('type', '')} {field.get('name', '')} {field.get('label', '')}".lower()
    return any(word in haystack for word in _SECRET)


FILL_JS = r"""
(() => {
  const spec = __SPEC__;
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const setValue = (el, value) => {
    // Through the prototype setter, so React and Angular see the change. A
    // plain el.value = x updates the DOM and not the framework's state, which
    // is why a form filled that way submits empty.
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  };

  const filled = [], missed = [];

  for (const item of spec) {
    const el = document.querySelector(item.selector);
    if (!el) { missed.push({ label: item.label, why: 'the field is no longer on the page' }); continue; }
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();

    try {
      if (type === 'checkbox' || type === 'radio') {
        const want = /^(true|yes|on|1|checked)$/i.test(String(item.value));
        if (el.checked !== want) el.click();
        filled.push({ label: item.label, value: el.checked });
      } else if (el.tagName === 'SELECT') {
        const wanted = norm(item.value);
        const match = Array.from(el.options).find(o =>
          norm(o.text) === wanted || norm(o.value) === wanted) ||
          Array.from(el.options).find(o => norm(o.text).includes(wanted));
        if (!match) {
          missed.push({ label: item.label, why: 'no such option',
            options: Array.from(el.options).slice(0, 20).map(o => o.text) });
          continue;
        }
        setValue(el, match.value);
        filled.push({ label: item.label, value: match.text });
      } else {
        setValue(el, String(item.value));
        // Read back. A field bound to something that rejects the value snaps
        // straight back, and only a read-back sees that.
        filled.push({ label: item.label, value: el.value,
                      verified: String(el.value) === String(item.value) });
      }
    } catch (e) {
      missed.push({ label: item.label, why: String(e).slice(0, 120) });
    }
  }
  return JSON.stringify({ filled, missed });
})()
"""

CLICK_JS = r"""
(() => {
  const want = __WANT__;
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const target = norm(want.text || '');

  let el = null;
  if (want.selector) el = document.querySelector(want.selector);

  if (!el && target) {
    const all = Array.from(document.querySelectorAll(
      'button,a[href],[role=button],[role=menuitem],[role=tab],input[type=submit],label,summary'));
    const named = all.map(e => ({
      e, t: norm(e.innerText || e.getAttribute('aria-label') || e.value || ''),
    })).filter(x => x.t);
    // Exact, then starts-with, then contains. A page with "Save" and "Save a
    // copy" must not have "Save" pick the longer one.
    el = (named.find(x => x.t === target)
       || named.find(x => x.t.startsWith(target))
       || named.find(x => x.t.includes(target)) || {}).e || null;
  }

  if (!el) return JSON.stringify({ ok: false, why: 'nothing matched' });

  const rect = el.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    el.scrollIntoView({ block: 'center' });
  }
  const label = norm(el.innerText || el.getAttribute('aria-label') || el.value || '');
  el.click();
  return JSON.stringify({ ok: true, clicked: label, tag: el.tagName.toLowerCase() });
})()
"""


async def fill_form(session, evaluate, model: dict, values: dict) -> dict:
    """
    Fill fields by what they are called.

    `values` is `{label: value}`. Each key is matched against every field the
    page model found, best match wins, and anything that matched nothing is
    reported by name rather than dropped.
    """
    fields = [f for form in model.get('forms', []) for f in form.get('fields', [])]

    spec, unmatched, refused = [], [], []
    for label, value in values.items():
        field = _best_field(fields, label)
        if field is None:
            unmatched.append(label)
            continue
        if _is_secret(field):
            # The one rule this file does not get to relax.
            refused.append(field.get('label') or label)
            continue
        spec.append({'label': label, 'selector': field['selector'], 'value': str(value)})

    result = {'filled': [], 'missed': []}
    if spec:
        raw = await evaluate(session, FILL_JS.replace('__SPEC__', json.dumps(spec)))
        try:
            result = json.loads(raw) if isinstance(raw, str) else (raw or result)
        except (TypeError, ValueError):
            pass

    if unmatched:
        result['not_found'] = unmatched
        result['available'] = [f.get('label') for f in fields if f.get('label')][:25]
    if refused:
        result['refused'] = refused
        result['refused_reason'] = (
            'Dex does not type into password or one-time-code fields. Use '
            'sign_in for a stored credential, or the owner types it.'
        )
    return result


def _best_field(fields: list, wanted: str) -> dict | None:
    """The field a person would mean by this name."""
    target = _norm(wanted)
    if not target:
        return None

    scored = []
    for field in fields:
        if field.get('disabled'):
            continue
        for candidate in (field.get('label'), field.get('name'), field.get('type')):
            text = _norm(candidate)
            if not text:
                continue
            if text == target:
                scored.append((100, field))
            elif text.startswith(target) or target.startswith(text):
                scored.append((60, field))
            elif target in text or text in target:
                scored.append((30, field))
    if not scored:
        return None
    # A visible field beats a hidden one at the same score.
    scored.sort(key=lambda pair: (pair[0], pair[1].get('visible', False)), reverse=True)
    return scored[0][1]


def _norm(text) -> str:
    return ''.join(c if c.isalnum() else ' ' for c in str(text or '').lower()).strip()


async def click(session, evaluate, want: dict) -> dict:
    """Click by visible text, or by selector when one is given."""
    raw = await evaluate(session, CLICK_JS.replace('__WANT__', json.dumps(want)))
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw or {})
    except (TypeError, ValueError):
        return {'ok': False, 'why': 'the click could not be reported'}


async def wait_for(session, evaluate, snapshot, spec: dict, timeout: float = 20.0) -> dict:
    """
    Wait for the page to be ready in the way this step needs.

    The missing primitive behind most browsing flakiness: without it, an agent
    either acts before the page has changed or sleeps a fixed second and hopes.
    Polls rather than sleeps, so a fast page costs 200ms and a slow one is
    still caught.
    """
    text = spec.get('text')
    selector = spec.get('selector')
    url_part = spec.get('url')
    idle = spec.get('idle', False)

    deadline = asyncio.get_event_loop().time() + float(timeout)
    last = ''
    while asyncio.get_event_loop().time() < deadline:
        snap = await snapshot(session)
        last = snap.get('url', '')

        if url_part and url_part.lower() in last.lower():
            return {'ok': True, 'matched': 'url', 'url': last}
        if text and text.lower() in (snap.get('text', '') or '').lower():
            return {'ok': True, 'matched': 'text', 'url': last}
        if selector:
            found = await evaluate(
                session, f'!!document.querySelector({json.dumps(selector)})')
            if found:
                return {'ok': True, 'matched': 'selector', 'url': last}
        if idle:
            ready = await evaluate(session, 'document.readyState')
            if ready == 'complete':
                return {'ok': True, 'matched': 'idle', 'url': last}

        await asyncio.sleep(0.25)

    return {
        'ok': False,
        'url': last,
        'why': f'nothing matched within {timeout:g}s',
        # What was waited for, so the failure is readable without the call site.
        'waited_for': {k: v for k, v in spec.items() if v},
    }


async def extract_table(session, evaluate, model: dict, which: Any = 0) -> dict:
    """A table as rows of objects. `which` is an index or a header to match."""
    tables = model.get('tables', [])
    if not tables:
        return {'ok': False, 'why': 'no table on this page'}

    if isinstance(which, str):
        target = _norm(which)
        chosen = next(
            (t for t in tables
             if any(target in _norm(h) for h in t.get('headers', []))),
            None,
        )
        if chosen is None:
            return {'ok': False, 'why': f'no table with a "{which}" column',
                    'tables': [t.get('headers') for t in tables]}
    else:
        index = int(which or 0)
        if index >= len(tables):
            return {'ok': False, 'why': f'only {len(tables)} table(s) on this page'}
        chosen = tables[index]

    return {'ok': True, **chosen}


async def scroll(session, evaluate, amount: Any = 'down') -> dict:
    """Scroll by a page, to the bottom, or to an element."""
    if isinstance(amount, str) and amount.lower() in ('bottom', 'end'):
        js = 'window.scrollTo(0, document.body.scrollHeight); document.body.scrollHeight'
    elif isinstance(amount, str) and amount.lower() in ('top', 'start'):
        js = 'window.scrollTo(0, 0); 0'
    elif isinstance(amount, str) and amount.lower() == 'up':
        js = 'window.scrollBy(0, -window.innerHeight * 0.9); window.scrollY'
    else:
        js = 'window.scrollBy(0, window.innerHeight * 0.9); window.scrollY'
    y = await evaluate(session, js)
    return {'ok': True, 'y': y}


async def press_key(session, evaluate, key: str) -> dict:
    """A key on the focused element — Enter to submit, Escape to dismiss."""
    js = f"""
    (() => {{
      const el = document.activeElement || document.body;
      const key = {json.dumps(key)};
      for (const type of ['keydown', 'keypress', 'keyup']) {{
        el.dispatchEvent(new KeyboardEvent(type, {{
          key: key, code: key, bubbles: true, cancelable: true,
        }}));
      }}
      if (key === 'Enter' && el.form) el.form.requestSubmit?.();
      return true;
    }})()
    """
    await evaluate(session, js)
    return {'ok': True, 'key': key}
