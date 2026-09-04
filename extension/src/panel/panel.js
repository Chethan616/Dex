// Dex, in the browser side panel.
//
// The same conversation as the app, in the window where the work is happening.
// Asking Dex about the page you are looking at should not mean alt-tabbing to
// another window to type it.
//
// **It talks to the core directly, not through the extension's socket.** The
// background worker's connection is Dex driving the browser — requests going
// one way, tool results coming back. This is the opposite direction: a person
// asking Dex to do something. Reusing that socket would mean multiplexing two
// unrelated protocols over one connection and teaching the bridge to route
// them, for no gain. The core already speaks to the Dex app over a WebSocket
// with a token; this is a second client of the same thing.
//
// The token lives in %LOCALAPPDATA%\DEX\ui.json, which an extension cannot
// read. So the core hands it over on a loopback-only endpoint that returns it
// to anything already able to reach 127.0.0.1 — which is anything running as
// this user, who is the owner. See `/handshake` in the browser agent.

const HANDSHAKE = 'http://127.0.0.1:8766/handshake';

const dot = document.getElementById('dot');
const state = document.getElementById('state');
const thread = document.getElementById('thread');
const hint = document.getElementById('hint');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const send = document.getElementById('send');
const stop = document.getElementById('stop');

let socket = null;
let requestId = null;

// The thread these turns belong to.
//
// Its own by default, so the panel has a history of its own rather than none;
// replaced by the app's when the app sends a prompt here, so a task started in
// one place and watched in the other is a single conversation.
let conversationId = `panel-${Date.now()}`;
let backoff = 500;

function setState(text, kind = '') {
  state.textContent = text;
  dot.className = 'dot' + (kind ? ' ' + kind : '');
}

function add(node) {
  hint.hidden = true;
  thread.append(node);
  thread.scrollTop = thread.scrollHeight;
}

function say(text, who) {
  const el = document.createElement('div');
  el.className = who;
  el.textContent = text;
  add(el);
  return el;
}

function step(text, kind) {
  const el = document.createElement('div');
  el.className = 'step' + (kind ? ' ' + kind : '');
  el.textContent = text;
  add(el);
}

/** A file result, drawn rather than read out — the same reasoning as the app. */
function card(artifact) {
  const el = document.createElement('div');
  el.className = 'card';

  const title = document.createElement('h4');
  title.textContent = artifact.title || 'Result';
  el.append(title);

  for (const item of (artifact.items || []).slice(0, 6)) {
    const row = document.createElement('div');
    row.textContent = item.label || '';
    el.append(row);
    if (item.detail) {
      const path = document.createElement('div');
      path.className = 'path';
      path.textContent = item.detail;
      el.append(path);
    }
  }
  if (artifact.body) {
    const body = document.createElement('div');
    body.textContent = artifact.body.slice(0, 1200);
    el.append(body);
  }
  add(el);
}

function busy(on) {
  send.hidden = on;
  stop.hidden = !on;
  input.disabled = on;
  setState(on ? 'working…' : 'ready', on ? 'busy' : 'on');
}

async function connect() {
  try {
    const response = await fetch(HANDSHAKE);
    if (!response.ok) throw new Error('no handshake');
    const { port, token } = await response.json();

    socket = new WebSocket(`ws://127.0.0.1:${port}`);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token }));
      backoff = 500;
      setState('ready', 'on');
    };

    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      handle(message);
    };

    socket.onclose = () => {
      setState('the core is not running', 'error');
      socket = null;
      // Backed off, so a closed app does not turn into a request every
      // millisecond for as long as the panel is open.
      backoff = Math.min(backoff * 2, 15000);
      setTimeout(connect, backoff);
    };

    socket.onerror = () => setState('cannot reach Dex', 'error');
  } catch {
    setState('the core is not running', 'error');
    backoff = Math.min(backoff * 2, 15000);
    setTimeout(connect, backoff);
  }
}

function handle(message) {
  if (message.type === 'event') {
    const event = message.event || {};

    // Which request this panel is watching.
    //
    // `requestId` was declared and never assigned, so Stop sent
    // `{type:'cancel', requestId: null}` and the core cancelled nothing. The
    // core mints the id inside `submit` and cannot return it, so the first
    // event that carries one is where the panel learns it.
    if (event.requestId && !requestId) requestId = event.requestId;

    if (!event.stepId) return;

    if (event.type === 'selecting') step(event.message);
    else if (event.type === 'done') {
      step(event.message, 'done');
      const artifact = event.data && event.data.artifact;
      if (artifact) card(artifact);
    } else if (event.type === 'failed') step(event.message, 'failed');
    return;
  }

  // A prompt sent here from the Dex app.
  //
  // The owner types in the app, and the work happens beside the page they are
  // looking at. Shown before it is sent, not after: watching your own words
  // appear is how you know the right thing was sent.
  if (message.type === 'panel' && message.action === 'prompt') {
    if (message.conversationId) conversationId = message.conversationId;
    run(String(message.text || ''));
    return;
  }

  // An approval card, for a step that needs one.
  //
  // The panel ignored these entirely, so a Tier 1 or 2 step raised by a task
  // the panel started sat unanswered until it timed out — invisible unless the
  // app happened to be open. A card raised here is answered here.
  if (message.type === 'confirmation') {
    confirmation(message.request || {});
    return;
  }

  if (message.type === 'confirmation_closed') {
    const open = document.querySelector(`.confirm[data-step="${message.stepId}"]`);
    if (open) open.remove();
    return;
  }

  if (message.type === 'result') {
    requestId = null;
    busy(false);
    if (message.summary) say(message.summary, 'dex');
  }
}

/**
 * An approval, rendered where it was raised.
 *
 * Deliberately plain: two buttons and the sentence the core wrote. The card in
 * the app is the same decision with the same words, and a panel that phrased it
 * differently would be a second source of truth about what Dex is about to do.
 */
function confirmation(request) {
  const card = document.createElement('div');
  card.className = 'confirm';
  card.dataset.step = request.stepId || '';

  const text = document.createElement('p');
  text.textContent = request.message || request.summary || 'Approve this step?';
  card.appendChild(text);

  const answer = (verdict) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'respond',
        requestId: request.requestId,
        stepId: request.stepId,
        stepVersion: request.stepVersion,
        verdict,
      }));
    }
    card.remove();
  };

  for (const [label, verdict] of [['Approve', 'approved'], ['Decline', 'declined']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = verdict === 'approved' ? 'primary' : '';
    button.textContent = label;
    button.addEventListener('click', () => answer(verdict));
    card.appendChild(button);
  }

  thread.appendChild(card);
  thread.scrollTop = thread.scrollHeight;
}

/** Send one prompt. The submit handler and the app-sent prompt share this. */
function run(text) {
  const trimmed = text.trim();
  if (!trimmed || !socket || socket.readyState !== WebSocket.OPEN) return;

  say(trimmed, 'you');
  input.value = '';
  input.style.height = 'auto';
  busy(true);
  requestId = null;
  socket.send(JSON.stringify({
    type: 'submit',
    text: trimmed,
    // The thread this belongs to.
    //
    // Without it the core takes its no-conversation branch and the turn is
    // never written to history — so anything said in the panel vanished, while
    // the same words typed in the app were kept. The panel claimed in its own
    // header to be "the same conversation as the app"; this makes that true.
    conversationId,
  }));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(input.value);
});

stop.addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'cancel', requestId }));
  }
  busy(false);
  step('Stopped.', 'failed');
});

// Enter sends, shift+enter is a newline — the same as the app's composer.
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});

connect();
