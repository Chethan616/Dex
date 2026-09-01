/**
 * The client half of the mesh link: dial the relay, seal/open frames, and hand
 * decoded host frames to a callback. Knows nothing about the DOM.
 *
 * Reconnects with backoff. Buffers outbound frames while the socket is down so
 * a prompt typed a second after a blip is not lost.
 */
(function (global) {
  'use strict';

  const P = global.MeshProtocol;
  const C = global.MeshCrypto;

  const RECONNECT_BASE_MS = 1000;
  const RECONNECT_MAX_MS = 20000;
  const PING_MS = 25000;

  function MeshLink(opts) {
    this.relayUrl = opts.relayUrl;
    this.roomId = opts.roomId;
    this.session = opts.session;           // MeshCrypto session, or null pre-pair
    this.onFrame = opts.onFrame || function () {};
    this.onStatus = opts.onStatus || function () {};
    this.onPaired = opts.onPaired || function () {};

    this.ws = null;
    this.stopped = false;
    this.attempts = 0;
    this.outbox = [];
    this.pingTimer = null;
  }

  MeshLink.prototype.connect = function () {
    if (this.stopped) return;
    const self = this;
    this.onStatus('connecting');

    // Cloudflare Workers deployment wants /r/<roomId> in the path; a plain
    // `ws` server ignores it. Sending it always is harmless and covers both.
    const url = this.relayUrl.replace(/\/+$/, '') + '/r/' + this.roomId;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = async function () {
      self.attempts = 0;
      ws.send(JSON.stringify(P.helloFrame(self.roomId, 'client')));
      // First sealed frame of every connection is a bootstrap `hello` — it
      // carries our public key so the PC can find or create our session.
      if (self.session) {
        try {
          const box = await C.sealHello(self.session, { t: 'hello' });
          ws.send(JSON.stringify({ t: 'box', meshId: self.roomId, box: box }));
        } catch (e) { /* the PC will simply not see us; reconnect retries */ }
      }
      self.onStatus('on');
      self.flush();
      self.pingTimer = setInterval(function () {
        if (ws.readyState === 1) self.send({ t: 'ping' }).catch(function () {});
      }, PING_MS);
    };

    ws.onmessage = function (ev) {
      self.handleRelayMessage(ev.data);
    };

    ws.onclose = function () {
      if (self.pingTimer) clearInterval(self.pingTimer);
      self.ws = null;
      if (self.stopped) return;
      self.onStatus('off');
      self.scheduleReconnect();
    };

    ws.onerror = function () {
      // onclose follows.
    };
  };

  MeshLink.prototype.scheduleReconnect = function () {
    const self = this;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.attempts++), RECONNECT_MAX_MS);
    setTimeout(function () { self.connect(); }, delay);
  };

  MeshLink.prototype.stop = function () {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) this.ws.close(1000, 'bye');
    this.ws = null;
  };

  MeshLink.prototype.setSession = function (session) {
    this.session = session;
  };

  MeshLink.prototype.setRoom = function (roomId) {
    if (this.roomId === roomId) return;
    this.roomId = roomId;
    if (this.ws) this.ws.close(1000, 're-room'); // reconnect picks up the new room
  };

  MeshLink.prototype.handleRelayMessage = async function (text) {
    let frame;
    try {
      frame = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (frame.t === 'presence') {
      this.onStatus(frame.host ? 'on' : 'connecting', frame);
      return;
    }
    if (frame.t !== 'box') return;
    if (!this.session) return;

    let opened;
    try {
      opened = await C.open(this.session, frame.box);
    } catch (e) {
      return; // tamper, replay, or wrong key — silence
    }

    const inner = opened.frame;
    if (inner && inner.t === 'paired') {
      this.onPaired(inner.deviceId, opened.senderPublicKey);
    }
    this.onFrame(inner);
  };

  /** Seal and send an object. Queues it if the socket is not up. */
  MeshLink.prototype.send = async function (obj) {
    if (!this.session) throw new Error('mesh: no session yet');
    const box = await C.seal(this.session, obj);
    const env = { t: 'box', meshId: this.roomId, box: box };
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(env));
    } else {
      this.outbox.push(env);
    }
  };

  MeshLink.prototype.flush = function () {
    if (!this.ws || this.ws.readyState !== 1) return;
    while (this.outbox.length) {
      this.ws.send(JSON.stringify(this.outbox.shift()));
    }
  };

  global.MeshLink = MeshLink;
})(self);
