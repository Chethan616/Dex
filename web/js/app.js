/**
 * The UI. Pairing form → console. Renders the core's typed event stream as it
 * lands, one line per event, verification text intact. Approval cards and file
 * transfers are the two things that are more than a line.
 */
(function () {
  'use strict';

  const P = window.MeshProtocol;
  const C = window.MeshCrypto;
  const Store = window.MeshStore;

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    pairing: $('pairing'), console: $('console'), stream: $('stream'),
    relayUrl: $('relayUrl'), pairCode: $('pairCode'), pairBtn: $('pairBtn'), pairMsg: $('pairMsg'),
    prompt: $('prompt'), promptForm: $('promptForm'), unpair: $('unpair'), link: $('link'),
  };

  let link = null;          // MeshLink
  let identity = null;      // { publicKey, privateKeyPkcs8, privateKey(CryptoKey) }
  /** Open file transfers, keyed by transfer id. */
  const transfers = {};
  /** requestId → the DOM group its events append to. */
  const groups = {};

  // ── boot ────────────────────────────────────────────────────────────────
  init().catch(function (e) { showPairMsg(String(e && e.message || e), true); });

  async function init() {
    const saved = await Store.load();
    if (saved && saved.pcPublicKey) {
      identity = {
        publicKey: saved.myPublicKey,
        privateKeyPkcs8: saved.myPrivateKeyPkcs8,
      };
      identity.privateKey = await C.importPrivate(identity.privateKeyPkcs8);
      await enterConsole(saved.relayUrl, saved.pcPublicKey, saved.roomId);
    } else {
      // Prefill the relay from ?relay= (the QR carries it) or last use.
      const params = new URLSearchParams(location.search);
      el.relayUrl.value = params.get('relay') || localStorage.getItem('lastRelay') || '';
      if (params.get('code')) el.pairCode.value = params.get('code');
    }
  }

  // ── pairing ─────────────────────────────────────────────────────────────
  el.pairBtn.addEventListener('click', function () {
    pair().catch(function (e) { showPairMsg(String(e && e.message || e), true); });
  });

  async function pair() {
    const relayUrl = el.relayUrl.value.trim();
    const code = el.pairCode.value.trim();
    if (!/^wss?:\/\//.test(relayUrl)) throw new Error('Enter the relay URL (wss://…)');
    const m = code.match(/^v1\.([A-Za-z0-9_-]{43,})\.([A-Za-z0-9_-]{8,})$/);
    if (!m) throw new Error('That does not look like a pairing code');
    const pcPublicKey = m[1];
    const salt = m[2];

    showPairMsg('Generating this device’s key…', false);
    const kp = await C.generateKeyPair();
    identity = { publicKey: kp.publicKey, privateKeyPkcs8: kp.privateKeyPkcs8 };
    identity.privateKey = await C.importPrivate(identity.privateKeyPkcs8);

    // Dial the PC's pairing room. MeshLink's first frame on connect is a sealed
    // `hello` that carries our public key — the frame itself proves we hold the
    // matching private key, and the PC records us as paired on receipt and
    // replies `{t:'paired'}`.
    const pairingRoom = await C.pairingRoomId(pcPublicKey, salt);
    const session = C.beginSession(identity.privateKey, identity.publicKey, pcPublicKey);

    showPairMsg('Contacting your PC…', false);
    const established = await C.establishedRoomId(pcPublicKey, identity.publicKey);

    await new Promise(function (resolve, reject) {
      let settled = false;
      const l = new window.MeshLink({
        relayUrl: relayUrl,
        roomId: pairingRoom,
        session: session,
        onFrame: function (f) {
          if (f && f.t === 'paired' && !settled) {
            settled = true;
            l.stop();
            resolve();
          }
        },
        onPaired: function () {},
        onStatus: function () {},
      });
      l.connect();
      setTimeout(function () {
        if (!settled) {
          l.stop();
          reject(new Error('No response from the PC. Is the pairing window still open?'));
        }
      }, 20000);
    });

    await Store.save({
      relayUrl: relayUrl,
      pcPublicKey: pcPublicKey,
      myPublicKey: identity.publicKey,
      myPrivateKeyPkcs8: identity.privateKeyPkcs8,
      roomId: established,
    });
    localStorage.setItem('lastRelay', relayUrl);

    showPairMsg('Paired.', false, true);
    await enterConsole(relayUrl, pcPublicKey, established);
  }

  // ── console ─────────────────────────────────────────────────────────────
  async function enterConsole(relayUrl, pcPublicKey, roomId) {
    el.pairing.hidden = true;
    el.console.hidden = false;

    const session = C.beginSession(identity.privateKey, identity.publicKey, pcPublicKey);
    link = new window.MeshLink({
      relayUrl: relayUrl,
      roomId: roomId,
      session: session,
      onFrame: onHostFrame,
      onStatus: onStatus,
      onPaired: function () {},
    });
    link.connect();
  }

  function onStatus(state) {
    el.link.className = 'link ' + (
      state === 'on' ? 'link--on' : state === 'connecting' ? 'link--connecting' : 'link--off'
    );
    el.link.textContent = state === 'on' ? 'linked' : state === 'connecting' ? 'connecting' : 'offline';
  }

  el.promptForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const text = el.prompt.value.trim();
    if (!text || !link) return;
    el.prompt.value = '';
    appendUserLine(text);
    link.send(P.promptFrame(text)).catch(function (err) {
      appendEvent({ type: 'failed', message: 'Could not send: ' + (err.message || err) });
    });
  });

  el.unpair.addEventListener('click', async function () {
    if (!confirm('Unpair this device? You will need the PC to show a new code.')) return;
    if (link) link.stop();
    await Store.clear();
    location.reload();
  });

  // ── rendering the stream ────────────────────────────────────────────────
  function groupFor(requestId) {
    if (!requestId) return el.stream;
    if (!groups[requestId]) {
      const g = document.createElement('div');
      g.className = 'group';
      g.dataset.req = requestId;
      el.stream.appendChild(g);
      groups[requestId] = g;
    }
    return groups[requestId];
  }

  function scroll() {
    el.stream.scrollTop = el.stream.scrollHeight;
  }

  function appendUserLine(text) {
    const d = document.createElement('div');
    d.className = 'ev ev--user';
    d.innerHTML = '<span class="ev__dot"></span><div class="ev__body"><span class="ev__type">you</span><span class="ev__msg"></span></div>';
    d.querySelector('.ev__msg').textContent = text;
    el.stream.appendChild(d);
    scroll();
  }

  function appendEvent(ev, container) {
    const tpl = document.getElementById('tpl-event').content.cloneNode(true);
    const root = tpl.querySelector('.ev');
    root.classList.add('ev--' + ev.type);
    tpl.querySelector('.ev__type').textContent = ev.type;
    tpl.querySelector('.ev__msg').textContent = ev.message || '';
    (container || el.stream).appendChild(tpl);
    scroll();
  }

  function onHostFrame(f) {
    if (!f || !f.t) return;
    switch (f.t) {
      case 'pong':
        return;
      case 'paired':
        return; // handled during pairing
      case 'event':
        appendEvent({ type: f.type, message: f.message }, groupFor(f.requestId));
        return;
      case 'result': {
        const c = groupFor(f.requestId);
        appendEvent(
          { type: 'result', message: f.answer || f.summary || f.status },
          c,
        );
        return;
      }
      case 'confirmation':
        renderConfirmation(f.request);
        return;
      case 'withdraw':
        withdrawConfirmation(f.requestId, f.stepId);
        return;
      case 'file':
        onFileChunk(f);
        return;
    }
  }

  // ── approval cards ──────────────────────────────────────────────────────
  const cards = {};
  function cardKey(requestId, stepId) { return requestId + '::' + stepId; }

  function renderConfirmation(req) {
    const key = cardKey(req.requestId, req.stepId);
    if (cards[key]) return;

    const isHandoff = req.tier === 1;
    const tpl = document.getElementById('tpl-confirm').content.cloneNode(true);
    const root = tpl.querySelector('.confirm');
    if (isHandoff) root.classList.add('confirm--handoff');
    tpl.querySelector('.confirm__tier').textContent =
      isHandoff ? 'Over to you' : 'Tier ' + req.tier + ' — approval needed';
    tpl.querySelector('.confirm__cap').textContent = req.capability + ':' + req.action;
    tpl.querySelector('.confirm__desc').textContent = req.description;

    const no = tpl.querySelector('.confirm__no');
    const once = tpl.querySelector('.confirm__once');
    const session = tpl.querySelector('.confirm__session');

    if (isHandoff) {
      once.textContent = 'I’ve done it';
      no.textContent = 'Skip';
    } else if (req.tier === 3) {
      session.hidden = false;
    }

    function answer(verdict) {
      root.classList.add('confirm--answered');
      delete cards[key];
      // stepVersion echoed back EXACTLY as received — the core rejects a stale one.
      const frame = isHandoff
        ? P.handoffFrame(req.requestId, req.stepId, req.stepVersion, verdict === 'approved')
        : P.approveFrame(req.requestId, req.stepId, req.stepVersion, verdict);
      link.send(frame).catch(function () {});
    }

    no.addEventListener('click', function () { answer('rejected'); });
    once.addEventListener('click', function () { answer('approved'); });
    session.addEventListener('click', function () { answer('approved_session'); });

    groupFor(req.requestId).appendChild(tpl);
    cards[key] = root;
    scroll();
  }

  function withdrawConfirmation(requestId, stepId) {
    const key = cardKey(requestId, stepId);
    const card = cards[key];
    if (card) {
      card.classList.add('confirm--answered');
      delete cards[key];
    }
  }

  // ── file reassembly ────────────────────────────────────────────────────
  function onFileChunk(f) {
    let t = transfers[f.id];
    if (!t) {
      const tpl = document.getElementById('tpl-file').content.cloneNode(true);
      const root = tpl.querySelector('.file');
      tpl.querySelector('.file__name').textContent = f.name;
      tpl.querySelector('.file__size').textContent = humanSize(f.size);
      groupFor('').appendChild(tpl);
      t = transfers[f.id] = {
        root: root,
        bar: root.querySelector('.file__bar'),
        dl: root.querySelector('.file__dl'),
        parts: new Array(f.chunks),
        got: 0,
        name: f.name,
        mime: f.mime,
      };
      scroll();
    }
    if (t.parts[f.chunk] === undefined) {
      t.parts[f.chunk] = base64ToBytes(f.bytes);
      t.got++;
    }
    t.bar.value = Math.round((t.got / f.chunks) * 100);

    if (t.got === f.chunks) {
      const blob = new Blob(t.parts, { type: t.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      t.dl.href = url;
      t.dl.download = t.name;
      t.dl.hidden = false;
      t.bar.hidden = true;
      delete transfers[f.id];
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function humanSize(n) {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function showPairMsg(text, isErr, isOk) {
    el.pairMsg.hidden = false;
    el.pairMsg.textContent = text;
    el.pairMsg.className = 'msg' + (isErr ? ' msg--err' : isOk ? ' msg--ok' : '');
  }
})();
