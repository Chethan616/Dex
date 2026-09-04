/**
 * FORK CHANGE — not from OpenDia. The Chrome DevTools Protocol, from inside the
 * extension.
 *
 * Three things the owner asked for cannot be done with ordinary extension APIs,
 * and all three are deliberate browser restrictions rather than oversights:
 *
 *   uploading a file    A page's <input type="file"> cannot be set from
 *                       JavaScript. `input.files = ...` throws, and a synthetic
 *                       change event on an empty input uploads nothing. This is
 *                       the rule that stops a web page reading your disk, and it
 *                       applies to extension content scripts too.
 *   a click that counts `element.click()` dispatches an untrusted event.
 *                       `isTrusted` is false, React's synthetic layer handles it
 *                       but many widgets check the flag, and anything expecting
 *                       a real pointer sequence — drag handles, menus that open
 *                       on pointerdown, upload buttons — does nothing at all.
 *                       This is most of "it did half the work".
 *   knowing what landed Downloads go wherever Chrome puts them, and the
 *                       extension is told nothing. Guessing "the newest file in
 *                       Downloads" is wrong the moment anything else downloads.
 *
 * `chrome.debugger` is the sanctioned way through all three. It matters that it
 * is an *extension API*: Chrome 136 refuses `--remote-debugging-port` on a
 * default profile precisely so that a local process cannot drive a signed-in
 * browser, and Dex is not going around that. This runs inside the browser, in
 * the profile the owner installed it into, with the permission they granted.
 *
 * **The cost, stated.** Attaching raises Chrome's "Dex started debugging this
 * browser" bar. It is a real warning about a real capability and it should be
 * visible. It can be silenced machine-wide with the SilentDebuggerExtensionAPI
 * policy — see scripts/install-extension-policy.ps1 — which is the owner's
 * choice to make, not this file's.
 *
 * So: attach for the operation, do it, detach. A tab left attached is a bar
 * that never goes away.
 */

const PROTOCOL = '1.3';

/** Tabs currently attached, so a nested call does not attach twice. */
const attached = new Map();

/**
 * Attach to a tab, run `work`, detach.
 *
 * Detaching in a finally block rather than at the end of the happy path: an
 * exception midway would otherwise leave the debugging bar up for the rest of
 * the session, and the owner would have to close the tab to be rid of it.
 */
async function withDebugger(tabId, work) {
  const target = { tabId };
  const nested = attached.has(tabId);

  if (!nested) {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach(target, PROTOCOL, () => {
        const err = chrome.runtime.lastError;
        // Already attached is a state, not a failure — DevTools may be open, or
        // another operation may be mid-flight.
        if (err && !/already attached/i.test(err.message)) reject(new Error(err.message));
        else resolve();
      });
    });
    attached.set(tabId, true);
  }

  try {
    return await work(target);
  } finally {
    if (!nested) {
      attached.delete(tabId);
      await new Promise((resolve) => chrome.debugger.detach(target, () => {
        void chrome.runtime.lastError;
        resolve();
      }));
    }
  }
}

/** One CDP command. Rejects with the protocol's own message, which is specific. */
function send(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(`${method}: ${err.message}`));
      else resolve(result);
    });
  });
}

/** The tab a tool should act on: the one named, or the active one. */
async function resolveTab(tabId) {
  if (tabId) return Number(tabId);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab to work in.');
  return tab.id;
}

/**
 * Put files into a file input.
 *
 * `element_id` comes from page_analyze, the same as every other element tool —
 * the caller never writes a selector, because ids from the analysis are what
 * the rest of the extension speaks and they survive a page that renames its
 * classes.
 *
 * The paths are read by the browser process, not by the page: DOM.setFileInputFiles
 * hands the file to the upload the same way the file picker would, and the page
 * never learns anything it would not have learned from the owner choosing it.
 */
export async function uploadFile({ element_id, paths, tab_id }) {
  if (!element_id) throw new Error('element_upload_file needs element_id from page_analyze.');
  const files = Array.isArray(paths) ? paths : [paths];
  if (files.length === 0 || !files[0]) throw new Error('element_upload_file needs at least one file path.');

  const tabId = await resolveTab(tab_id);

  return withDebugger(tabId, async (target) => {
    await send(target, 'DOM.enable');
    const { root } = await send(target, 'DOM.getDocument', { depth: -1, pierce: true });

    // The element the analysis found, located again in the CDP node tree. The
    // content script stamps its ids onto the DOM, so this is a lookup rather
    // than a guess.
    const { nodeIds } = await send(target, 'DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: `[data-opendia-id="${element_id}"], #${CSS.escape(element_id)}`,
    });

    let nodeId = nodeIds && nodeIds[0];

    // Falling back to the first file input on the page.
    //
    // Upload buttons are very often a styled <label> or <button> in front of a
    // hidden input, and the analysis returns the visible one because that is
    // what a person would click. Setting files on the label does nothing, so
    // the honest thing is to find the input it stands for.
    if (!nodeId) {
      const inputs = await send(target, 'DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: 'input[type="file"]',
      });
      nodeId = inputs.nodeIds && inputs.nodeIds[0];
    }

    if (!nodeId) throw new Error('No file input on this page to upload into.');

    await send(target, 'DOM.setFileInputFiles', { nodeId, files });
    return { uploaded: files, element_id, tab_id: tabId };
  });
}

/**
 * A click the page cannot tell from the owner's.
 *
 * The full pointer sequence rather than a bare mousePressed/Released pair,
 * because menus that open on pointerdown and buttons that arm on mousemove both
 * exist, and a click with no approach is not what a person's mouse does.
 */
export async function clickTrusted({ x, y, element_id, tab_id }) {
  const tabId = await resolveTab(tab_id);

  return withDebugger(tabId, async (target) => {
    let point = { x, y };

    if (element_id && (x === undefined || y === undefined)) {
      // Where that element actually is on screen, asked of the page.
      const { result } = await send(target, 'Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector('[data-opendia-id="${element_id}"]')
            || document.getElementById(${JSON.stringify(element_id)});
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        })()`,
        returnByValue: true,
      });
      if (!result.value) throw new Error(`No element ${element_id} on this page.`);
      point = JSON.parse(result.value);
    }

    if (point.x === undefined || point.y === undefined) {
      throw new Error('element_click_trusted needs element_id, or x and y.');
    }

    const common = { x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 };
    await send(target, 'Input.dispatchMouseEvent', { ...common, type: 'mouseMoved', button: 'none', clickCount: 0 });
    await send(target, 'Input.dispatchMouseEvent', { ...common, type: 'mousePressed' });
    await send(target, 'Input.dispatchMouseEvent', { ...common, type: 'mouseReleased' });

    return { clicked: true, at: common, element_id: element_id ?? null };
  });
}

/**
 * Send the next download to a directory Dex chose, and say what arrived.
 *
 * Two problems solved at once. The file lands where the task wanted it rather
 * than in Downloads, and — the part that matters for chaining — Dex learns the
 * exact filename from Page.downloadProgress instead of inferring it from
 * whatever is newest on disk. That guess is wrong whenever anything else
 * downloads while a task runs, and it is the reason a browser step could not
 * hand a file to a file step.
 */
export async function downloadTo({ directory, trigger_element_id, timeout_ms, tab_id }) {
  if (!directory) throw new Error('page_download_to needs a directory.');
  const tabId = await resolveTab(tab_id);
  const deadline = Number(timeout_ms) > 0 ? Number(timeout_ms) : 120000;

  return withDebugger(tabId, async (target) => {
    await send(target, 'Page.enable');
    await send(target, 'Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: directory,
      eventsEnabled: true,
    });

    const arrived = new Promise((resolve, reject) => {
      let guid = null;
      let suggested = null;

      const onEvent = (source, method, payload) => {
        if (source.tabId !== tabId) return;

        if (method === 'Page.downloadWillBegin') {
          guid = payload.guid;
          suggested = payload.suggestedFilename;
          return;
        }
        if (method !== 'Page.downloadProgress') return;
        if (guid && payload.guid !== guid) return;

        if (payload.state === 'completed') {
          chrome.debugger.onEvent.removeListener(onEvent);
          clearTimeout(timer);
          // `allowAndName` writes the file under its guid, so the guid is the
          // name on disk and `suggestedFilename` is what the page wanted it
          // called. Both are reported: the caller renames if it cares.
          resolve({
            downloaded: true,
            directory,
            file: payload.guid,
            suggested_name: suggested,
            bytes: payload.totalBytes ?? null,
          });
        } else if (payload.state === 'canceled') {
          chrome.debugger.onEvent.removeListener(onEvent);
          clearTimeout(timer);
          reject(new Error('The download was cancelled.'));
        }
      };

      const timer = setTimeout(() => {
        chrome.debugger.onEvent.removeListener(onEvent);
        reject(new Error(`Nothing finished downloading within ${deadline / 1000}s.`));
      }, deadline);

      chrome.debugger.onEvent.addListener(onEvent);
    });

    // Arm the listener before the click, so a fast download cannot finish in
    // the gap between triggering it and starting to watch.
    if (trigger_element_id) {
      await clickTrusted({ element_id: trigger_element_id, tab_id: tabId });
    }

    return arrived;
  });
}

/** Detach from a tab, or from every tab. The debugging bar goes with it. */
export async function detach({ tab_id }) {
  const targets = tab_id ? [Number(tab_id)] : [...attached.keys()];
  for (const tabId of targets) {
    attached.delete(tabId);
    await new Promise((resolve) => chrome.debugger.detach({ tabId }, () => {
      void chrome.runtime.lastError;
      resolve();
    }));
  }
  return { detached: targets };
}

/**
 * A key press, a screenshot, and history — the gaps in the tool surface.
 *
 * These exist so that the deterministic web tier (navigate/click/press_key/
 * screenshot/go_back) can run in the owner's browser too. Without them, half
 * those actions had no equivalent here, and Dex fell back to its own signed-out
 * browser for the whole step — which is the wrong-browser bug, arriving through
 * a side door.
 */
export async function pressKey({ key, tab_id }) {
  const tabId = await resolveTab(tab_id);
  const named = {
    Enter: { windowsVirtualKeyCode: 13, text: '\r' },
    Tab: { windowsVirtualKeyCode: 9, text: '\t' },
    Escape: { windowsVirtualKeyCode: 27 },
    Backspace: { windowsVirtualKeyCode: 8 },
    ArrowDown: { windowsVirtualKeyCode: 40 },
    ArrowUp: { windowsVirtualKeyCode: 38 },
  };
  const spec = named[key] ?? { text: key };

  return withDebugger(tabId, async (target) => {
    await send(target, 'Input.dispatchKeyEvent', { type: 'keyDown', key, ...spec });
    await send(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key, ...spec });
    return { pressed: key };
  });
}

export async function screenshot({ full_page, tab_id }) {
  const tabId = await resolveTab(tab_id);
  return withDebugger(tabId, async (target) => {
    await send(target, 'Page.enable');
    const shot = await send(target, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: full_page === true,
    });
    // Base64 back over the socket. The caller writes the file, because the
    // extension has no disk and the path the owner sees should be Dex's.
    return { format: 'png', base64: shot.data };
  });
}

export async function history({ delta, tab_id }) {
  const tabId = await resolveTab(tab_id);
  return withDebugger(tabId, async (target) => {
    await send(target, 'Page.enable');
    const { currentIndex, entries } = await send(target, 'Page.getNavigationHistory');
    const wanted = currentIndex + (Number(delta) || -1);
    if (wanted < 0 || wanted >= entries.length) {
      throw new Error(delta > 0 ? 'Nothing forward in this tab.' : 'Nothing back in this tab.');
    }
    await send(target, 'Page.navigateToHistoryEntry', { entryId: entries[wanted].id });
    return { url: entries[wanted].url };
  });
}

/** Whether the debugger is usable at all, so callers can fall back rather than fail. */
export function available() {
  return typeof chrome !== 'undefined' && !!chrome.debugger;
}
