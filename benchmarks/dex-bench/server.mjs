// DEX-Bench's local website: a shop, a contact form, a data table, a student
// portal, a paginated library and a settings page behind a cookie banner.
// Deterministic, offline, and it records what the agent did so the checkers
// can read the end state (GET /__state), like OSWorld's Chrome checkers do.
//
//   node server.mjs [port]      (default 8765)
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] || process.env.DEX_BENCH_PORT || 8765);

export const PRODUCTS = [
  { id: 'p1', name: 'Logi Glide Wireless Mouse', category: 'Mouse', wireless: true, price: 1299, rating: 4.2 },
  { id: 'p2', name: 'Zebronics Pulse Wireless Mouse', category: 'Mouse', wireless: true, price: 549, rating: 3.6 },
  { id: 'p3', name: 'Portronics Toad Wireless Mouse', category: 'Mouse', wireless: true, price: 799, rating: 4.1 },
  { id: 'p4', name: 'HP X200 Wired Mouse', category: 'Mouse', wireless: false, price: 399, rating: 4.4 },
  { id: 'p5', name: 'Dell MS3320 Wireless Mouse', category: 'Mouse', wireless: true, price: 1099, rating: 4.5 },
  { id: 'p6', name: 'Keychron K2 Keyboard', category: 'Keyboard', wireless: true, price: 7499, rating: 4.7 },
  { id: 'p7', name: 'boAt Rockerz 450 Headphones', category: 'Audio', wireless: true, price: 1499, rating: 4.0 },
  { id: 'p8', name: 'Anker 65W USB-C Charger', category: 'Power', wireless: false, price: 2299, rating: 4.6 },
  { id: 'p9', name: 'SanDisk 128GB Pen Drive', category: 'Storage', wireless: false, price: 899, rating: 4.3 },
  { id: 'p10', name: 'Lenovo 300 Wireless Mouse', category: 'Mouse', wireless: true, price: 849, rating: 3.9 },
];

export const POPULATION_2025 = [
  ['Mumbai', 21673000], ['Delhi', 33807000], ['Bengaluru', 14008000], ['Hyderabad', 11337000],
  ['Chennai', 12336000], ['Kolkata', 15845000], ['Pune', 7348000], ['Ahmedabad', 8854000],
];
const POPULATION_2020 = [['Mumbai', 20411000], ['Delhi', 30291000], ['Bengaluru', 12327000], ['Hyderabad', 10004000]];

const AUTHORS = ['Ursula K. Le Guin', 'Isaac Asimov', 'Octavia E. Butler', 'Arthur C. Clarke', 'Ted Chiang', 'N. K. Jemisin'];
export const BOOKS = Array.from({ length: 38 }, (_, i) => {
  const leGuin = [2, 9, 13, 17, 24, 30, 36].includes(i);
  return { id: i + 1, title: `${leGuin ? 'Earthsea' : 'Signals'} Volume ${i + 1}`, author: leGuin ? 'Ursula K. Le Guin' : AUTHORS[1 + (i % 5)], year: 1960 + i };
});

let state;
const reset = () => {
  state = { cart: [], orders: [], contact: [], logins: [], settings: { emailNotifications: true, language: 'en', saves: 0 }, currency: 'INR', nonce: randomBytes(6).toString('hex') };
};
reset();

const page = (title, body, extraHead = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:15px/1.5 system-ui,Segoe UI,sans-serif;margin:0;background:#f6f7f9;color:#1d1f23}
header{background:#1f3b73;color:#fff;padding:12px 24px;display:flex;gap:18px;align-items:center}
header a{color:#cfe0ff;text-decoration:none} main{max-width:980px;margin:24px auto;padding:0 16px}
.card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:12px}
table{border-collapse:collapse;width:100%;background:#fff} th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left}
button,input[type=submit]{background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}
input,select,textarea{padding:7px 9px;border:1px solid #c9ced6;border-radius:8px;font:inherit} label{display:block;margin:10px 0 4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.muted{color:#6b7280}.price{font-weight:700}
#cookie{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
#cookie .card{max-width:420px}
</style>${extraHead}</head><body><header><b>BenchMart</b><a href="/shop">Shop</a><a href="/cart">Cart</a><a href="/contact">Contact</a><a href="/data">Data</a><a href="/library">Library</a><a href="/portal">Portal</a><a href="/settings">Settings</a></header><main>${body}</main></body></html>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (n) => (state.currency === 'USD' ? `$${(n / 84).toFixed(2)}` : `₹${n.toLocaleString('en-IN')}`);

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}

const send = (res, code, html, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(html); };
const json = (res, v, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
const redirect = (res, to, headers = {}) => { res.writeHead(303, { location: to, ...headers }); res.end(); };
const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    // ── For the checkers ──
    if (p === '/__state') return json(res, state);
    if (p === '/__reset' && req.method === 'POST') { reset(); return json(res, { ok: true }); }
    if (p === '/' ) return redirect(res, '/shop');

    // ── Shop: rendered by the page's script; cart changes need the page's nonce ──
    if (p === '/api/products') return json(res, PRODUCTS.map((x) => ({ ...x, display: money(x.price) })));
    if (p === '/shop') {
      return send(res, 200, page('BenchMart — Shop', `
<div class="card" style="display:flex;justify-content:space-between;align-items:center"><h1 style="margin:0">Shop</h1>
<form method="post" action="/currency"><label style="display:inline;margin-right:6px">Currency</label><select name="currency" onchange="this.form.submit()">
<option value="INR"${state.currency === 'INR' ? ' selected' : ''}>INR (₹)</option><option value="USD"${state.currency === 'USD' ? ' selected' : ''}>USD ($)</option></select></form></div>
<p class="muted">Cart: <span id="count">${state.cart.length}</span> item(s) · <a href="/cart">View cart</a></p>
<div class="grid" id="grid">Loading products…</div>
<script>
const NONCE = ${JSON.stringify(state.nonce)};
fetch('/api/products').then(r => r.json()).then(list => {
  document.getElementById('grid').innerHTML = list.map(p => '<div class="card"><div><b>' + p.name + '</b></div><div class="muted">' + p.category + (p.wireless ? ' · Wireless' : ' · Wired') + '</div><div>Rating ' + p.rating.toFixed(1) + ' ★</div><div class="price">' + p.display + '</div><button data-id="' + p.id + '">Add to cart</button></div>').join('');
  document.querySelectorAll('button[data-id]').forEach(b => b.onclick = async () => {
    const r = await fetch('/api/cart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id, nonce: NONCE }) });
    const j = await r.json(); document.getElementById('count').textContent = j.count; b.textContent = 'Added ✓';
  });
});
</script>`));
    }
    if (p === '/api/cart' && req.method === 'POST') {
      const b = await body(req);
      if (b.nonce !== state.nonce) return json(res, { error: 'bad nonce' }, 403);
      if (!PRODUCTS.some((x) => x.id === b.id)) return json(res, { error: 'no such product' }, 404);
      state.cart.push(b.id);
      return json(res, { count: state.cart.length });
    }
    if (p === '/currency' && req.method === 'POST') {
      const b = await body(req);
      if (['INR', 'USD'].includes(b.currency)) state.currency = b.currency;
      return redirect(res, '/shop');
    }
    if (p === '/cart') {
      const items = state.cart.map((id) => PRODUCTS.find((x) => x.id === id));
      const rows = items.map((x, i) => `<tr><td>${esc(x.name)}</td><td>${money(x.price)}</td><td><form method="post" action="/cart/remove"><input type="hidden" name="i" value="${i}"><button>Remove</button></form></td></tr>`).join('');
      return send(res, 200, page('BenchMart — Cart', `<h1>Your cart</h1>
${items.length ? `<table><tr><th>Item</th><th>Price</th><th></th></tr>${rows}</table>
<div class="card" style="margin-top:16px"><h2>Checkout</h2><form method="post" action="/checkout">
<label>Full name</label><input name="name" required><label>Email</label><input name="email" type="email" required><br><br><input type="submit" value="Place order"></form></div>` : '<p>Your cart is empty.</p>'}`));
    }
    if (p === '/cart/remove' && req.method === 'POST') {
      const b = await body(req);
      state.cart.splice(Number(b.i), 1);
      return redirect(res, '/cart');
    }
    if (p === '/checkout' && req.method === 'POST') {
      const b = await body(req);
      if (!state.cart.length) return redirect(res, '/cart');
      state.orders.push({ items: [...state.cart], name: String(b.name || ''), email: String(b.email || ''), at: Date.now() });
      state.cart = [];
      return send(res, 200, page('Order placed', `<div class="card"><h1>Thank you!</h1><p>Order #${1000 + state.orders.length} is placed.</p></div>`));
    }

    // ── Contact form ──
    if (p === '/contact' && req.method === 'GET') {
      return send(res, 200, page('BenchMart — Contact', `<div class="card"><h1>Contact us</h1><form method="post" action="/contact">
<label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required>
<label>Topic</label><select name="topic"><option>General</option><option>Billing</option><option>Technical</option></select>
<label>Message</label><textarea name="message" rows="4" cols="50" required></textarea><br><br><input type="submit" value="Send"></form></div>`));
    }
    if (p === '/contact' && req.method === 'POST') {
      const b = await body(req);
      state.contact.push({ name: b.name, email: b.email, topic: b.topic, message: b.message });
      return send(res, 200, page('Sent', '<div class="card"><h1>Thanks, we got your message.</h1></div>'));
    }

    // ── Data ──
    if (p === '/data') {
      const t = (rows) => `<table><tr><th>City</th><th>Population</th></tr>${rows.map(([c, n]) => `<tr><td>${c}</td><td>${n.toLocaleString('en-IN')}</td></tr>`).join('')}</table>`;
      return send(res, 200, page('BenchMart — Data', `<div class="card"><h2>City population, 2020 (archived)</h2>${t(POPULATION_2020)}</div><div class="card"><h2>City population, 2025</h2>${t(POPULATION_2025)}</div>`));
    }

    // ── Student portal ──
    if (p === '/portal' && req.method === 'GET') {
      if (cookie(req, 'portal') === 'ok') return redirect(res, '/portal/dashboard');
      return send(res, 200, page('Student portal', `<div class="card"><h1>Student portal</h1><form method="post" action="/portal/login">
<label>Username</label><input name="username"><label>Password</label><input name="password" type="password"><br><br><input type="submit" value="Sign in"></form>
${url.searchParams.get('e') ? '<p style="color:#c00">Wrong username or password.</p>' : ''}</div>`));
    }
    if (p === '/portal/login' && req.method === 'POST') {
      const b = await body(req);
      const ok = b.username === 'student42' && b.password === 'Dex!2026';
      state.logins.push({ username: b.username, ok });
      return ok ? redirect(res, '/portal/dashboard', { 'set-cookie': 'portal=ok; Path=/' }) : redirect(res, '/portal?e=1');
    }
    if (p === '/portal/dashboard') {
      if (cookie(req, 'portal') !== 'ok') return redirect(res, '/portal');
      return send(res, 200, page('Dashboard', `<div class="card"><h1>Welcome, student42</h1><h3>Upcoming</h3><table>
<tr><th>What</th><th>When</th></tr><tr><td>Assignment 3 due (Data Structures)</td><td>2 November 2026</td></tr>
<tr><td>Exam: Operating Systems</td><td>14 November 2026</td></tr><tr><td>Exam: Compilers</td><td>21 November 2026</td></tr></table></div>`));
    }

    // ── Library (paginated) ──
    if (p === '/library') {
      const per = 10;
      const n = Math.max(1, Math.min(4, Number(url.searchParams.get('page') || 1)));
      const rows = BOOKS.slice((n - 1) * per, n * per).map((b) => `<tr><td>${b.title}</td><td>${b.author}</td><td>${b.year}</td></tr>`).join('');
      const pages = [1, 2, 3, 4].map((i) => (i === n ? `<b>${i}</b>` : `<a href="/library?page=${i}">${i}</a>`)).join(' ');
      return send(res, 200, page('Library', `<h1>Library catalogue</h1><table><tr><th>Title</th><th>Author</th><th>Year</th></tr>${rows}</table><p>Page: ${pages}${n < 4 ? ` · <a href="/library?page=${n + 1}">Next ›</a>` : ''}</p>`));
    }

    // ── Settings, behind a cookie banner; saved by the page's script ──
    if (p === '/settings' && req.method === 'GET') {
      const s = state.settings;
      return send(res, 200, page('Settings', `<div class="card"><h1>Account settings</h1>
<label><input type="checkbox" id="email"${s.emailNotifications ? ' checked' : ''}> Email notifications</label>
<label>Language</label><select id="lang"><option value="en"${s.language === 'en' ? ' selected' : ''}>English</option><option value="de"${s.language === 'de' ? ' selected' : ''}>Deutsch</option><option value="fr"${s.language === 'fr' ? ' selected' : ''}>Français</option></select>
<br><br><button id="save">Save</button> <span id="msg" class="muted"></span></div>
<div id="cookie"><div class="card"><h3>We use cookies</h3><p>To keep you signed in. Accept to continue.</p><button onclick="document.getElementById('cookie').remove()">Accept</button></div></div>
<script>
document.getElementById('save').onclick = async () => {
  await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailNotifications: document.getElementById('email').checked, language: document.getElementById('lang').value, nonce: ${JSON.stringify(state.nonce)} }) });
  document.getElementById('msg').textContent = 'Saved.';
};
</script>`));
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const b = await body(req);
      if (b.nonce !== state.nonce) return json(res, { error: 'bad nonce' }, 403);
      state.settings = { emailNotifications: Boolean(b.emailNotifications), language: String(b.language), saves: state.settings.saves + 1 };
      return json(res, { ok: true });
    }
    send(res, 404, page('Not found', '<h1>Not found</h1>'));
  } catch (err) {
    send(res, 500, page('Error', `<pre>${esc(err.stack)}</pre>`));
  }
});

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server.mjs')) {
  server.listen(PORT, '127.0.0.1', () => console.log(`DEX-Bench site on http://127.0.0.1:${PORT}`));
}
export { server };
