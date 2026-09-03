"""
What a page actually is, read from the document rather than the screen.

`read_page` returns rendered text, which is what a screenshot already shows and
is missing everything that matters for acting: a field's name, a link's href, a
select's options, a menu item inside a collapsed nav. `map_page` fixed part of
that by listing interactive elements. This is the rest — the page as structure.

    forms    fields with their real labels, types, options, required-ness
    tables   headers and rows, as objects
    actions  the buttons that look primary
    nav      links grouped by region, hidden ones included
    content  the main text with the furniture stripped
    frames   the same, per iframe, because portals live in frames

One JS evaluation, no round trips, and nothing visible to the owner.

**Labels are found the way a person finds them**, not by `for=` alone: an
explicit label, then a wrapping label, then aria-label, then the nearest text to
the left or above, then the placeholder. Portals get all of these wrong in
different ways, and a form filler that only understands `for=` fills nothing on
half the sites that matter.
"""
from __future__ import annotations

import json
from typing import Any

PAGE_MODEL_JS = r"""
(() => {
  const text = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const attr = (el, n) => (el.getAttribute(n) || '').trim();

  const visible = (el) => {
    if (!el || !el.getClientRects().length) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity || '1') > 0.05;
  };

  const selectorFor = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const name = attr(el, 'name');
    if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
    const parts = [];
    let n = el;
    for (let d = 0; n && n.nodeType === 1 && d < 4; d++) {
      let p = n.tagName.toLowerCase();
      if (n.parentElement) {
        const kin = Array.from(n.parentElement.children).filter(c => c.tagName === n.tagName);
        if (kin.length > 1) p += ':nth-of-type(' + (kin.indexOf(n) + 1) + ')';
      }
      parts.unshift(p);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };

  // How a person decides what a field is called.
  const labelFor = (el) => {
    if (el.id) {
      const explicit = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (explicit && text(explicit)) return text(explicit);
    }
    const wrapping = el.closest('label');
    if (wrapping && text(wrapping)) return text(wrapping);

    for (const a of ['aria-label', 'title', 'placeholder', 'name']) {
      const v = attr(el, a);
      if (v) return v;
    }

    // The nearest text before it, which is how most portals label things.
    let n = el.previousElementSibling;
    for (let i = 0; n && i < 3; i++, n = n.previousElementSibling) {
      const t = text(n);
      if (t && t.length < 80) return t;
    }
    const cell = el.closest('td');
    if (cell && cell.previousElementSibling) {
      const t = text(cell.previousElementSibling);
      if (t && t.length < 80) return t;
    }
    return '';
  };

  const fieldOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (attr(el, 'type') || (tag === 'select' ? 'select' : tag)).toLowerCase();
    const f = {
      label: labelFor(el),
      type: type,
      selector: selectorFor(el),
      name: attr(el, 'name'),
      required: el.required === true || attr(el, 'aria-required') === 'true',
      visible: visible(el),
    };
    if (type === 'select' && el.options) {
      f.options = Array.from(el.options).slice(0, 60).map(o => (o.text || o.value || '').trim());
    }
    if (type === 'checkbox' || type === 'radio') f.checked = el.checked === true;
    // Never a password's value, whatever else is reported.
    else if (type !== 'password' && el.value) f.value = String(el.value).slice(0, 120);
    if (el.disabled) f.disabled = true;
    return f;
  };

  const forms = Array.from(document.querySelectorAll('form')).slice(0, 12).map((form, i) => ({
    index: i,
    name: attr(form, 'name') || attr(form, 'id') || '',
    action: form.action || '',
    method: (form.method || 'get').toLowerCase(),
    fields: Array.from(form.querySelectorAll('input,select,textarea'))
      .filter(el => (attr(el, 'type') || '').toLowerCase() !== 'hidden')
      .slice(0, 40).map(fieldOf),
    submit: Array.from(form.querySelectorAll('button,input[type=submit]'))
      .slice(0, 6).map(b => ({ label: text(b) || attr(b, 'value'), selector: selectorFor(b) })),
  }));

  // Fields outside any form. Modern sites put half their inputs there.
  const loose = Array.from(document.querySelectorAll('input,select,textarea'))
    .filter(el => !el.closest('form') && (attr(el, 'type') || '').toLowerCase() !== 'hidden')
    .slice(0, 25).map(fieldOf);
  if (loose.length) forms.push({ index: forms.length, name: '(no form)', fields: loose, submit: [] });

  const tables = Array.from(document.querySelectorAll('table')).slice(0, 8).map((t, i) => {
    const rows = Array.from(t.rows).slice(0, 120);
    if (!rows.length) return null;
    const headers = Array.from(rows[0].cells).map(c => text(c) || ('col' + c.cellIndex));
    const body = rows.slice(1).map(r => {
      const o = {};
      Array.from(r.cells).forEach((c, j) => { o[headers[j] || ('col' + j)] = text(c); });
      return o;
    });
    return { index: i, headers: headers, rows: body, row_count: body.length };
  }).filter(Boolean);

  const actionable = Array.from(document.querySelectorAll(
    'button,a[href],[role=button],input[type=submit],[role=menuitem],[role=tab]'
  )).slice(0, 200).map(el => ({
    text: text(el) || attr(el, 'aria-label') || attr(el, 'value'),
    selector: selectorFor(el),
    href: el.href || '',
    visible: visible(el),
    primary: /submit|primary|btn-primary|cta/i.test(el.className || ''),
  })).filter(a => a.text);

  const main = document.querySelector('main,[role=main],article,#content,.content') || document.body;
  const content = (main ? main.innerText : '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);

  return JSON.stringify({
    url: location.href,
    title: document.title,
    ready: document.readyState,
    scroll: { y: Math.round(window.scrollY), height: document.body.scrollHeight,
              viewport: window.innerHeight },
    forms: forms,
    tables: tables,
    actions: actionable,
    content: content,
    frames: Array.from(document.querySelectorAll('iframe')).slice(0, 8).map((f, i) => ({
      index: i, name: attr(f, 'name') || attr(f, 'id') || '', src: f.src || '',
    })),
  });
})()
"""


def parse(raw: Any) -> dict:
    """The evaluation's result, or an empty model that says why."""
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw or {})
    except (TypeError, ValueError):
        return {'error': 'the page could not be read', 'forms': [], 'tables': [],
                'actions': [], 'content': ''}


def summarise(model: dict, limit: int = 3500) -> str:
    """
    The model as compact text for a prompt.

    Sent alongside the screenshot rather than instead of it: this carries names,
    hrefs and options a picture cannot, and the picture carries layout and what
    is actually on screen. Trimmed hard because it goes into every step.
    """
    out = [f"URL: {model.get('url', '')}", f"Title: {model.get('title', '')}"]

    for form in model.get('forms', [])[:4]:
        fields = form.get('fields', [])
        if not fields:
            continue
        out.append(f"\nFORM {form.get('name') or form.get('index')}:")
        for f in fields[:20]:
            bits = [f"  {f.get('label') or f.get('name') or '?'} ({f.get('type')})"]
            if f.get('required'):
                bits.append('required')
            if f.get('options'):
                bits.append('options: ' + ', '.join(f['options'][:8]))
            if f.get('value'):
                bits.append(f"currently: {f['value'][:40]}")
            out.append('  '.join(bits))
        for s in form.get('submit', [])[:3]:
            out.append(f"  [submit] {s.get('label')}")

    for table in model.get('tables', [])[:2]:
        out.append(f"\nTABLE: {', '.join(table.get('headers', [])[:8])} "
                   f"({table.get('row_count', 0)} rows)")

    actions = [a for a in model.get('actions', []) if a.get('visible')][:25]
    if actions:
        out.append('\nCLICKABLE: ' + ' | '.join(a['text'][:40] for a in actions))

    hidden = [a for a in model.get('actions', []) if not a.get('visible')][:12]
    if hidden:
        out.append('HIDDEN (in collapsed menus): ' + ' | '.join(a['text'][:30] for a in hidden))

    if model.get('frames'):
        out.append('FRAMES: ' + ', '.join(
            f.get('name') or f.get('src', '')[:40] for f in model['frames'][:4]))

    content = model.get('content', '')
    if content:
        out.append('\nTEXT:\n' + content[:1200])

    return '\n'.join(out)[:limit]
