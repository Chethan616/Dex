/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Chrome extension APIs Electron doesn't have, for extensions in DEX's
 * browser (docs/unify/PLAN.md §4.4, "the MIT shim").
 *
 * This function runs inside each extension's own JavaScript world — its
 * service worker and its pages — through contextBridge.executeInMainWorld,
 * before the extension's code. Electron *serializes* it to get it there, so
 * it must stay self-contained: no imports, no outer variables, no classes.
 *
 * Every API here is a thin forwarder: a call becomes `call(name,
 * args)` to DEX's main process (main/extensions/api.ts), which checks the
 * extension's permissions and its arguments and does the work. Events come
 * back through the function this returns. What Electron already does well
 * (runtime messaging, storage, scripting, alarms, i18n,
 * tabs.sendMessage/executeScript) is left alone.
 */
export interface ShimBridge {
  call(method: string, args: unknown[]): Promise<unknown>;
  /** The extension listens to `event` (with a listener id and filter for filtered events). */
  listen(event: string, spec?: { id: number; filter?: unknown; extra?: unknown } | null): void;
  unlisten(event: string, id?: number): void;
}

export type ShimDispatch = (event: string, args: unknown[], ids?: number[] | null) => unknown;

export function extensionShim(bridge: ShimBridge, context: 'worker' | 'page'): ShimDispatch | null {
  const g: any = globalThis as any;
  if (typeof location === 'undefined' || location.protocol !== 'chrome-extension:') return null;
  if (g.__dexExtensionShim) return null;
  const chrome: any = g.chrome;
  if (!chrome || !chrome.runtime) return null;
  g.__dexExtensionShim = context;

  // --- Errors and callbacks, the Chrome way --------------------------------

  // DEX answers an API error as a value ({__dexError}) rather than a thrown
  // IPC error, so its log isn't a stack trace per refused call.
  const call = (name: string, args: unknown[]): Promise<any> => bridge.call(name, args).then((r: any) => {
    if (r && typeof r === 'object' && typeof r.__dexError === 'string') throw new Error(r.__dexError);
    return r;
  });

  const cleanMessage = (e: any): string => String((e && e.message) || e || 'Unknown error')
    .replace(/^Error invoking remote method '[^']*': /, '')
    .replace(/^Error: /, '');

  const withLastError = (err: any, cb: (...a: any[]) => void): void => {
    const lastError = { message: cleanMessage(err) };
    let defined = false;
    try {
      Object.defineProperty(chrome.runtime, 'lastError', { value: lastError, configurable: true, enumerable: true });
      defined = true;
    } catch { /* read-only here: the callback just gets undefined */ }
    try { cb(); } finally {
      if (defined) { try { delete chrome.runtime.lastError; } catch { /* leave it */ } }
    }
  };

  const plain = (v: any, depth: number): any => {
    if (depth > 8 || v === null || v === undefined) return v;
    if (typeof v === 'function') return undefined;
    if (typeof ImageData !== 'undefined' && v instanceof ImageData) {
      return { __imageData: true, width: v.width, height: v.height, data: new Uint8Array(v.data.buffer.slice(0)) };
    }
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
    if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
    if (typeof v === 'object') {
      const out: any = {};
      for (const k of Object.keys(v)) {
        const x = plain(v[k], depth + 1);
        if (x !== undefined) out[k] = x;
      }
      return out;
    }
    return v;
  };

  /** A Chrome-style method: returns a promise, or calls the trailing callback. */
  const method = (name: string, shape?: (args: any[]) => any[]) => function (this: any, ...raw: any[]) {
    const cb = typeof raw[raw.length - 1] === 'function' ? raw.pop() : null;
    const args = shape ? shape(raw) : raw;
    const p = call(name, args.map((a) => plain(a, 0))).catch((e: any) => { throw new Error(cleanMessage(e)); });
    if (!cb) return p;
    p.then((r: any) => cb(r), (e: any) => withLastError(e, cb));
    return undefined;
  };

  /** Optional first argument (e.g. tabs.update(tabId?, props)). */
  const optionalFirst = (isFirst: (a: any) => boolean) => (args: any[]) => (args.length && !isFirst(args[0]) ? [undefined, ...args] : args);

  // --- Events ----------------------------------------------------------------

  let nextListenerId = 1;
  const listeners: Record<string, Array<{ id: number; fn: (...a: any[]) => any; filter?: any }>> = {};

  const event = (name: string, filtered?: boolean): any => ({
    addListener(fn: (...a: any[]) => any, filter?: any, extra?: any) {
      if (typeof fn !== 'function') return;
      const list = listeners[name] || (listeners[name] = []);
      if (list.some((l) => l.fn === fn)) return;
      const id = nextListenerId++;
      list.push({ id, fn, filter });
      if (filtered) bridge.listen(name, { id, filter: plain(filter, 0), extra: plain(extra, 0) });
      else if (list.length === 1) bridge.listen(name, null);
    },
    removeListener(fn: (...a: any[]) => any) {
      const list = listeners[name] || [];
      const gone = list.find((l) => l.fn === fn);
      listeners[name] = list.filter((l) => l.fn !== fn);
      if (gone && filtered) bridge.unlisten(name, gone.id);
      else if (gone && listeners[name].length === 0) bridge.unlisten(name);
    },
    hasListener(fn: (...a: any[]) => any) { return (listeners[name] || []).some((l) => l.fn === fn); },
    hasListeners() { return (listeners[name] || []).length > 0; },
    // Declarative events (rare): accepted, never matched.
    addRules(_r: any, cb?: any) { if (typeof cb === 'function') cb([]); },
    removeRules(_i: any, cb?: any) { if (typeof cb === 'function') cb(); },
    getRules(_i: any, cb?: any) { if (typeof cb === 'function') cb([]); },
  });

  const define = (target: any, key: string, value: any): void => {
    try { target[key] = value; } catch { /* fall through */ }
    if (target[key] !== value) {
      try { Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: true }); } catch { /* keep native */ }
    }
  };

  const ns = (key: string): any => {
    let obj = chrome[key];
    if (!obj || typeof obj !== 'object') {
      obj = {};
      define(chrome, key, obj);
    }
    return obj;
  };

  const install = (key: string, members: Record<string, any>): any => {
    const obj = ns(key);
    for (const k of Object.keys(members)) define(obj, k, members[k]);
    return obj;
  };

  const events = (prefix: string, names: string[], filtered?: boolean): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const n of names) out[n] = event(`${prefix}.${n}`, filtered);
    return out;
  };

  const manifest: any = (() => { try { return chrome.runtime.getManifest(); } catch { return {}; } })();
  const declared = new Set<string>([...(manifest.permissions || []), ...(manifest.optional_permissions || [])].filter((p: any) => typeof p === 'string'));

  // --- tabs ------------------------------------------------------------------

  const isTabId = (a: any) => typeof a === 'number';
  install('tabs', {
    TAB_ID_NONE: -1,
    TAB_INDEX_NONE: -1,
    MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND: 2,
    TabStatus: { UNLOADED: 'unloaded', LOADING: 'loading', COMPLETE: 'complete' },
    WindowType: { NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel', APP: 'app', DEVTOOLS: 'devtools' },
    MutedInfoReason: { USER: 'user', CAPTURE: 'capture', EXTENSION: 'extension' },
    ZoomSettingsMode: { AUTOMATIC: 'automatic', MANUAL: 'manual', DISABLED: 'disabled' },
    ZoomSettingsScope: { PER_ORIGIN: 'per-origin', PER_TAB: 'per-tab' },
    query: method('tabs.query', (a) => [a[0] || {}]),
    get: method('tabs.get'),
    getCurrent: method('tabs.getCurrent'),
    create: method('tabs.create', (a) => [a[0] || {}]),
    update: method('tabs.update', optionalFirst(isTabId)),
    remove: method('tabs.remove'),
    duplicate: method('tabs.duplicate'),
    highlight: method('tabs.highlight'),
    move: method('tabs.move'),
    goBack: method('tabs.goBack', optionalFirst(isTabId)),
    goForward: method('tabs.goForward', optionalFirst(isTabId)),
    discard: method('tabs.discard'),
    captureVisibleTab: method('tabs.captureVisibleTab', optionalFirst((a) => typeof a === 'number' || a === null)),
    detectLanguage: method('tabs.detectLanguage', optionalFirst(isTabId)),
    group: method('tabs.group'),
    ungroup: method('tabs.ungroup'),
    getSelected: method('tabs.getCurrentActive', optionalFirst(isTabId)),
    getAllInWindow: method('tabs.getAllInWindow', optionalFirst(isTabId)),
    ...events('tabs', ['onCreated', 'onUpdated', 'onActivated', 'onRemoved', 'onMoved', 'onAttached', 'onDetached', 'onHighlighted', 'onReplaced', 'onZoomChange', 'onActiveChanged', 'onSelectionChanged', 'onHighlightChanged']),
  });

  // --- windows ---------------------------------------------------------------

  install('windows', {
    WINDOW_ID_NONE: -1,
    WINDOW_ID_CURRENT: -2,
    WindowType: { NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel', APP: 'app', DEVTOOLS: 'devtools' },
    WindowState: { NORMAL: 'normal', MINIMIZED: 'minimized', MAXIMIZED: 'maximized', FULLSCREEN: 'fullscreen', LOCKED_FULLSCREEN: 'locked-fullscreen' },
    CreateType: { NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel' },
    get: method('windows.get'),
    getCurrent: method('windows.getCurrent'),
    getLastFocused: method('windows.getLastFocused'),
    getAll: method('windows.getAll'),
    create: method('windows.create', (a) => [a[0] || {}]),
    update: method('windows.update'),
    remove: method('windows.remove'),
    ...events('windows', ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged']),
  });

  // --- action (and MV2's browserAction / pageAction) -------------------------

  // Icon paths are relative to the calling script or page (Dark Reader's
  // background passes "../icons/…"); send them as paths from the root.
  const fromRoot = (p: any): any => {
    if (typeof p !== 'string') return p;
    try { return new URL(p, location.href).pathname; } catch { return p; }
  };
  const iconArgs = (a: any[]) => {
    const d = a[0] && typeof a[0] === 'object' ? { ...a[0] } : {};
    if (typeof d.path === 'string') d.path = fromRoot(d.path);
    else if (d.path && typeof d.path === 'object') d.path = Object.fromEntries(Object.entries(d.path).map(([k, v]) => [k, fromRoot(v)]));
    return [d];
  };
  const actionMembers = (prefix: string) => ({
    setIcon: method(`${prefix}.setIcon`, iconArgs),
    setTitle: method(`${prefix}.setTitle`),
    getTitle: method(`${prefix}.getTitle`, (a) => [a[0] || {}]),
    setBadgeText: method(`${prefix}.setBadgeText`),
    getBadgeText: method(`${prefix}.getBadgeText`, (a) => [a[0] || {}]),
    setBadgeBackgroundColor: method(`${prefix}.setBadgeBackgroundColor`),
    getBadgeBackgroundColor: method(`${prefix}.getBadgeBackgroundColor`, (a) => [a[0] || {}]),
    setBadgeTextColor: method(`${prefix}.setBadgeTextColor`),
    getBadgeTextColor: method(`${prefix}.getBadgeTextColor`, (a) => [a[0] || {}]),
    setPopup: method(`${prefix}.setPopup`),
    getPopup: method(`${prefix}.getPopup`, (a) => [a[0] || {}]),
    enable: method(`${prefix}.enable`),
    disable: method(`${prefix}.disable`),
    isEnabled: method(`${prefix}.isEnabled`),
    openPopup: method(`${prefix}.openPopup`, (a) => [a[0] || {}]),
    getUserSettings: method(`${prefix}.getUserSettings`),
    show: method(`${prefix}.enable`),
    hide: method(`${prefix}.disable`),
    onClicked: event('action.onClicked'),
    onUserSettingsChanged: event('action.onUserSettingsChanged'),
  });
  if (manifest.action || (manifest.manifest_version || 2) >= 3) install('action', actionMembers('action'));
  if (manifest.browser_action) install('browserAction', actionMembers('action'));
  if (manifest.page_action) install('pageAction', actionMembers('action'));

  // --- contextMenus / menus ---------------------------------------------------

  let menuSeq = 1;
  const menuClicks: Record<string, (...a: any[]) => void> = {};
  const menuMembers = {
    ACTION_MENU_TOP_LEVEL_LIMIT: 6,
    ContextType: { ALL: 'all', PAGE: 'page', FRAME: 'frame', SELECTION: 'selection', LINK: 'link', EDITABLE: 'editable', IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', LAUNCHER: 'launcher', BROWSER_ACTION: 'browser_action', PAGE_ACTION: 'page_action', ACTION: 'action' },
    ItemType: { NORMAL: 'normal', CHECKBOX: 'checkbox', RADIO: 'radio', SEPARATOR: 'separator' },
    create(props: any, cb?: any) {
      const p = props || {};
      const id = p.id !== undefined ? String(p.id) : `dex-menu-${menuSeq++}`;
      if (typeof p.onclick === 'function') menuClicks[id] = p.onclick;
      const done = call('contextMenus.create', [plain({ ...p, id, generatedId: p.id === undefined }, 0)]);
      done.then(() => { if (typeof cb === 'function') cb(); }, (e: any) => { if (typeof cb === 'function') withLastError(e, cb); });
      return p.id !== undefined ? p.id : id;
    },
    update(id: any, props: any, cb?: any) {
      if (props && typeof props.onclick === 'function') menuClicks[String(id)] = props.onclick;
      return method('contextMenus.update')(String(id), props, ...(cb ? [cb] : []));
    },
    remove(id: any, cb?: any) {
      delete menuClicks[String(id)];
      return method('contextMenus.remove')(String(id), ...(cb ? [cb] : []));
    },
    removeAll: method('contextMenus.removeAll'),
    refresh: method('contextMenus.refresh'),
    onClicked: event('contextMenus.onClicked'),
    onShown: event('contextMenus.onShown'),
    onHidden: event('contextMenus.onHidden'),
  };
  if (declared.has('contextMenus') || declared.has('menus')) {
    install('contextMenus', menuMembers);
    if (declared.has('menus')) install('menus', menuMembers);
  }

  // --- notifications ---------------------------------------------------------

  let notificationSeq = 1;
  if (declared.has('notifications')) {
    install('notifications', {
      TemplateType: { BASIC: 'basic', IMAGE: 'image', LIST: 'list', PROGRESS: 'progress' },
      PermissionLevel: { GRANTED: 'granted', DENIED: 'denied' },
      create(...raw: any[]) {
        const cb = typeof raw[raw.length - 1] === 'function' ? raw.pop() : null;
        const id = typeof raw[0] === 'string' && raw[0] ? raw[0] : `dex-notification-${notificationSeq++}`;
        const options = typeof raw[0] === 'string' || raw[0] === undefined ? raw[1] : raw[0];
        const p = call('notifications.create', [id, plain(options || {}, 0)]).then(() => id).catch((e: any) => { throw new Error(cleanMessage(e)); });
        if (!cb) return p;
        p.then((r: any) => cb(r), (e: any) => withLastError(e, cb));
        return undefined;
      },
      update: method('notifications.update'),
      clear: method('notifications.clear'),
      getAll: method('notifications.getAll'),
      getPermissionLevel: method('notifications.getPermissionLevel'),
      ...events('notifications', ['onClicked', 'onClosed', 'onButtonClicked', 'onPermissionLevelChanged', 'onShowSettings']),
    });
  }

  // --- webNavigation (filtered by url in DEX's main process) -----------------

  if (declared.has('webNavigation')) {
    install('webNavigation', {
      TransitionType: { LINK: 'link', TYPED: 'typed', AUTO_BOOKMARK: 'auto_bookmark', AUTO_SUBFRAME: 'auto_subframe', MANUAL_SUBFRAME: 'manual_subframe', GENERATED: 'generated', START_PAGE: 'start_page', FORM_SUBMIT: 'form_submit', RELOAD: 'reload', KEYWORD: 'keyword', KEYWORD_GENERATED: 'keyword_generated' },
      getFrame: method('webNavigation.getFrame'),
      getAllFrames: method('webNavigation.getAllFrames'),
      ...events('webNavigation', ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated', 'onHistoryStateUpdated', 'onTabReplaced'], true),
    });
  }

  // --- webRequest (Electron's own never fires in extensions) -----------------

  if (declared.has('webRequest')) {
    install('webRequest', {
      MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES: 20,
      ResourceType: { MAIN_FRAME: 'main_frame', SUB_FRAME: 'sub_frame', STYLESHEET: 'stylesheet', SCRIPT: 'script', IMAGE: 'image', FONT: 'font', OBJECT: 'object', XMLHTTPREQUEST: 'xmlhttprequest', PING: 'ping', CSP_REPORT: 'csp_report', MEDIA: 'media', WEBSOCKET: 'websocket', WEBTRANSPORT: 'webtransport', WEBBUNDLE: 'webbundle', OTHER: 'other' },
      OnBeforeRequestOptions: { BLOCKING: 'blocking', REQUEST_BODY: 'requestBody', EXTRA_HEADERS: 'extraHeaders' },
      OnAuthRequiredOptions: { RESPONSE_HEADERS: 'responseHeaders', BLOCKING: 'blocking', ASYNC_BLOCKING: 'asyncBlocking', EXTRA_HEADERS: 'extraHeaders' },
      handlerBehaviorChanged: method('webRequest.handlerBehaviorChanged'),
      ...events('webRequest', ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onAuthRequired', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred', 'onActionIgnored'], true),
    });
  }

  // --- declarativeNetRequest (DEX's own rule engine) -------------------------

  if (declared.has('declarativeNetRequest') || declared.has('declarativeNetRequestWithHostAccess')) {
    install('declarativeNetRequest', {
      GUARANTEED_MINIMUM_STATIC_RULES: 30000,
      MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
      MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
      MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 30000,
      MAX_NUMBER_OF_SESSION_RULES: 5000,
      MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
      MAX_NUMBER_OF_REGEX_RULES: 1000,
      MAX_NUMBER_OF_STATIC_RULESETS: 100,
      MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
      MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: 20,
      GETMATCHEDRULES_QUOTA_INTERVAL: 10,
      DYNAMIC_RULESET_ID: '_dynamic',
      SESSION_RULESET_ID: '_session',
      RuleActionType: { BLOCK: 'block', REDIRECT: 'redirect', ALLOW: 'allow', UPGRADE_SCHEME: 'upgradeScheme', MODIFY_HEADERS: 'modifyHeaders', ALLOW_ALL_REQUESTS: 'allowAllRequests' },
      ResourceType: { MAIN_FRAME: 'main_frame', SUB_FRAME: 'sub_frame', STYLESHEET: 'stylesheet', SCRIPT: 'script', IMAGE: 'image', FONT: 'font', OBJECT: 'object', XMLHTTPREQUEST: 'xmlhttprequest', PING: 'ping', CSP_REPORT: 'csp_report', MEDIA: 'media', WEBSOCKET: 'websocket', WEBTRANSPORT: 'webtransport', WEBBUNDLE: 'webbundle', OTHER: 'other' },
      DomainType: { FIRST_PARTY: 'firstParty', THIRD_PARTY: 'thirdParty' },
      HeaderOperation: { APPEND: 'append', SET: 'set', REMOVE: 'remove' },
      RequestMethod: { CONNECT: 'connect', DELETE: 'delete', GET: 'get', HEAD: 'head', OPTIONS: 'options', PATCH: 'patch', POST: 'post', PUT: 'put', OTHER: 'other' },
      UnsupportedRegexReason: { SYNTAX_ERROR: 'syntaxError', MEMORY_LIMIT_EXCEEDED: 'memoryLimitExceeded' },
      updateDynamicRules: method('declarativeNetRequest.updateDynamicRules', (a) => [a[0] || {}]),
      getDynamicRules: method('declarativeNetRequest.getDynamicRules', (a) => [a[0] || {}]),
      updateSessionRules: method('declarativeNetRequest.updateSessionRules', (a) => [a[0] || {}]),
      getSessionRules: method('declarativeNetRequest.getSessionRules', (a) => [a[0] || {}]),
      updateEnabledRulesets: method('declarativeNetRequest.updateEnabledRulesets', (a) => [a[0] || {}]),
      getEnabledRulesets: method('declarativeNetRequest.getEnabledRulesets'),
      updateStaticRules: method('declarativeNetRequest.updateStaticRules', (a) => [a[0] || {}]),
      getDisabledRuleIds: method('declarativeNetRequest.getDisabledRuleIds', (a) => [a[0] || {}]),
      getAvailableStaticRuleCount: method('declarativeNetRequest.getAvailableStaticRuleCount'),
      isRegexSupported: method('declarativeNetRequest.isRegexSupported', (a) => [a[0] || {}]),
      setExtensionActionOptions: method('declarativeNetRequest.setExtensionActionOptions', (a) => [a[0] || {}]),
      getMatchedRules: method('declarativeNetRequest.getMatchedRules', (a) => [a[0] || {}]),
      testMatchOutcome: method('declarativeNetRequest.testMatchOutcome', (a) => [a[0] || {}]),
      onRuleMatchedDebug: event('declarativeNetRequest.onRuleMatchedDebug'),
    });
  }

  // --- proxy -------------------------------------------------------------------

  if (declared.has('proxy')) {
    install('proxy', {
      Mode: { DIRECT: 'direct', AUTO_DETECT: 'auto_detect', PAC_SCRIPT: 'pac_script', FIXED_SERVERS: 'fixed_servers', SYSTEM: 'system' },
      Scheme: { HTTP: 'http', HTTPS: 'https', QUIC: 'quic', SOCKS4: 'socks4', SOCKS5: 'socks5' },
      settings: {
        get: method('proxy.settings.get', (a) => [a[0] || {}]),
        set: method('proxy.settings.set', (a) => [a[0] || {}]),
        clear: method('proxy.settings.clear', (a) => [a[0] || {}]),
        onChange: event('proxy.settings.onChange'),
      },
      onProxyError: event('proxy.onProxyError'),
    });
  }

  // --- permissions ---------------------------------------------------------------

  install('permissions', {
    contains: method('permissions.contains', (a) => [a[0] || {}]),
    getAll: method('permissions.getAll'),
    request: method('permissions.request', (a) => [a[0] || {}]),
    remove: method('permissions.remove', (a) => [a[0] || {}]),
    addHostAccessRequest: method('permissions.addHostAccessRequest', (a) => [a[0] || {}]),
    removeHostAccessRequest: method('permissions.removeHostAccessRequest', (a) => [a[0] || {}]),
    ...events('permissions', ['onAdded', 'onRemoved']),
  });

  // --- cookies ---------------------------------------------------------------------

  if (declared.has('cookies')) {
    install('cookies', {
      SameSiteStatus: { NO_RESTRICTION: 'no_restriction', LAX: 'lax', STRICT: 'strict', UNSPECIFIED: 'unspecified' },
      OnChangedCause: { EVICTED: 'evicted', EXPIRED: 'expired', EXPLICIT: 'explicit', EXPIRED_OVERWRITE: 'expired_overwrite', OVERWRITE: 'overwrite' },
      get: method('cookies.get'),
      getAll: method('cookies.getAll', (a) => [a[0] || {}]),
      set: method('cookies.set'),
      remove: method('cookies.remove'),
      getAllCookieStores: method('cookies.getAllCookieStores'),
      getPartitionKey: method('cookies.getPartitionKey', (a) => [a[0] || {}]),
      onChanged: event('cookies.onChanged'),
    });
  }

  // --- downloads -------------------------------------------------------------------

  if (declared.has('downloads')) {
    install('downloads', {
      FilenameConflictAction: { UNIQUIFY: 'uniquify', OVERWRITE: 'overwrite', PROMPT: 'prompt' },
      State: { IN_PROGRESS: 'in_progress', INTERRUPTED: 'interrupted', COMPLETE: 'complete' },
      download: method('downloads.download'),
      search: method('downloads.search', (a) => [a[0] || {}]),
      pause: method('downloads.pause'),
      resume: method('downloads.resume'),
      cancel: method('downloads.cancel'),
      erase: method('downloads.erase', (a) => [a[0] || {}]),
      open: method('downloads.open'),
      show: method('downloads.show'),
      showDefaultFolder: method('downloads.showDefaultFolder'),
      getFileIcon: method('downloads.getFileIcon'),
      removeFile: method('downloads.removeFile'),
      acceptDanger: method('downloads.acceptDanger'),
      setShelfEnabled: (): void => undefined,
      setUiOptions: method('downloads.setUiOptions', (a) => [a[0] || {}]),
      ...events('downloads', ['onCreated', 'onChanged', 'onErased', 'onDeterminingFilename']),
    });
  }

  // --- idle --------------------------------------------------------------------------

  if (declared.has('idle')) {
    install('idle', {
      IdleState: { ACTIVE: 'active', IDLE: 'idle', LOCKED: 'locked' },
      queryState: method('idle.queryState'),
      setDetectionInterval: (seconds: number) => { void call('idle.setDetectionInterval', [seconds]); },
      getAutoLockDelay: method('idle.getAutoLockDelay'),
      onStateChanged: event('idle.onStateChanged'),
    });
  }

  // --- offscreen -----------------------------------------------------------------------

  if (declared.has('offscreen')) {
    install('offscreen', {
      Reason: { TESTING: 'TESTING', AUDIO_PLAYBACK: 'AUDIO_PLAYBACK', IFRAME_SCRIPTING: 'IFRAME_SCRIPTING', DOM_SCRAPING: 'DOM_SCRAPING', BLOBS: 'BLOBS', DOM_PARSER: 'DOM_PARSER', USER_MEDIA: 'USER_MEDIA', DISPLAY_MEDIA: 'DISPLAY_MEDIA', WEB_RTC: 'WEB_RTC', CLIPBOARD: 'CLIPBOARD', LOCAL_STORAGE: 'LOCAL_STORAGE', WORKERS: 'WORKERS', BATTERY_STATUS: 'BATTERY_STATUS', MATCH_MEDIA: 'MATCH_MEDIA', GEOLOCATION: 'GEOLOCATION' },
      createDocument: method('offscreen.createDocument'),
      closeDocument: method('offscreen.closeDocument'),
      hasDocument: method('offscreen.hasDocument'),
    });
  }

  // --- sidePanel: shown as a popup under the toolbar button ---------------------------

  if (declared.has('sidePanel') || manifest.side_panel) {
    install('sidePanel', {
      Side: { LEFT: 'left', RIGHT: 'right' },
      open: method('sidePanel.open', (a) => [a[0] || {}]),
      setOptions: method('sidePanel.setOptions', (a) => [a[0] || {}]),
      getOptions: method('sidePanel.getOptions', (a) => [a[0] || {}]),
      setPanelBehavior: method('sidePanel.setPanelBehavior', (a) => [a[0] || {}]),
      getPanelBehavior: method('sidePanel.getPanelBehavior'),
      setLayout: method('sidePanel.setLayout', (a) => [a[0] || {}]),
      getLayout: method('sidePanel.getLayout'),
      onOpened: event('sidePanel.onOpened'),
      onClosed: event('sidePanel.onClosed'),
    });
  }

  // --- identity ---------------------------------------------------------------------------

  if (declared.has('identity')) {
    const id = chrome.runtime.id;
    install('identity', {
      AccountStatus: { SYNC: 'SYNC', ANY: 'ANY' },
      getRedirectURL: (p?: string) => `https://${id}.chromiumapp.org/${String(p || '').replace(/^\//, '')}`,
      launchWebAuthFlow: method('identity.launchWebAuthFlow', (a) => [a[0] || {}]),
      getAuthToken: method('identity.getAuthToken', (a) => [a[0] || {}]),
      removeCachedAuthToken: method('identity.removeCachedAuthToken', (a) => [a[0] || {}]),
      clearAllCachedAuthTokens: method('identity.clearAllCachedAuthTokens'),
      getProfileUserInfo: method('identity.getProfileUserInfo', (a) => [a[0] || {}]),
      getAccounts: method('identity.getAccounts'),
      onSignInChanged: event('identity.onSignInChanged'),
    });
  }

  // --- commands, power, search, management -------------------------------------------

  install('commands', { getAll: method('commands.getAll'), onCommand: event('commands.onCommand') });
  if (declared.has('power')) {
    install('power', {
      Level: { SYSTEM: 'system', DISPLAY: 'display' },
      requestKeepAwake: (level: string) => { void call('power.requestKeepAwake', [level]); },
      releaseKeepAwake: () => { void call('power.releaseKeepAwake', []); },
    });
  }
  if (declared.has('search')) install('search', { query: method('search.query', (a) => [a[0] || {}]) });
  if (declared.has('fontSettings')) {
    install('fontSettings', {
      getFontList: method('fontSettings.getFontList'),
      getFont: method('fontSettings.getFont', (a) => [a[0] || {}]),
      setFont: method('fontSettings.setFont', (a) => [a[0] || {}]),
      clearFont: method('fontSettings.clearFont', (a) => [a[0] || {}]),
      getDefaultFontSize: method('fontSettings.getDefaultFontSize'),
      getDefaultFixedFontSize: method('fontSettings.getDefaultFixedFontSize'),
      getMinimumFontSize: method('fontSettings.getMinimumFontSize'),
      ...events('fontSettings', ['onFontChanged', 'onDefaultFontSizeChanged', 'onDefaultFixedFontSizeChanged', 'onMinimumFontSizeChanged']),
    });
  }
  if (!chrome.management || typeof chrome.management.getAll !== 'function') {
    install('management', {
      getAll: method('management.getAll'),
      get: method('management.get'),
      setEnabled: method('management.setEnabled'),
      uninstallSelf: method('management.uninstallSelf', (a) => [a[0] || {}]),
      ...events('management', ['onInstalled', 'onUninstalled', 'onEnabled', 'onDisabled']),
    });
  }

  // --- storage.sync (Electron's always fails) ------------------------------------------------

  if (chrome.storage) {
    const syncChanged = event('storage.sync.onChanged');
    const anyChanged = event('storage.onChanged.sync');
    define(chrome.storage, 'sync', {
      QUOTA_BYTES: 102400,
      QUOTA_BYTES_PER_ITEM: 8192,
      MAX_ITEMS: 512,
      MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
      MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
      get: method('storage.sync.get', (a) => [a.length ? a[0] : null]),
      getKeys: method('storage.sync.getKeys'),
      set: method('storage.sync.set', (a) => [a[0] || {}]),
      remove: method('storage.sync.remove'),
      clear: method('storage.sync.clear'),
      getBytesInUse: method('storage.sync.getBytesInUse', (a) => [a.length ? a[0] : null]),
      setAccessLevel: method('storage.sync.setAccessLevel', (a) => [a[0] || {}]),
      onChanged: syncChanged,
    });
    const native = chrome.storage.onChanged;
    define(chrome.storage, 'onChanged', {
      addListener(fn: any) { try { native?.addListener(fn); } catch { /* none */ } anyChanged.addListener(fn); },
      removeListener(fn: any) { try { native?.removeListener(fn); } catch { /* none */ } anyChanged.removeListener(fn); },
      hasListener(fn: any) { return Boolean(native?.hasListener?.(fn)) || anyChanged.hasListener(fn); },
      hasListeners() { return Boolean(native?.hasListeners?.()) || anyChanged.hasListeners(); },
    });
  }
  if (chrome.extension) {
    define(chrome.extension, 'isAllowedFileSchemeAccess', method('extension.isAllowedFileSchemeAccess'));
    define(chrome.extension, 'isAllowedIncognitoAccess', method('extension.isAllowedIncognitoAccess'));
  }

  // --- runtime extras ---------------------------------------------------------------------

  define(chrome.runtime, 'openOptionsPage', method('runtime.openOptionsPage'));
  define(chrome.runtime, 'getContexts', method('runtime.getContexts', (a) => [a[0] || {}]));
  define(chrome.runtime, 'setUninstallURL', method('runtime.setUninstallURL'));
  if (typeof chrome.runtime.connectNative !== 'function') {
    define(chrome.runtime, 'sendNativeMessage', method('runtime.sendNativeMessage'));
  }

  // --- what's left: present, so top-level code doesn't crash; each call says why ---------

  // Only for permissions the manifest *requires*: an optional one's API is
  // absent in Chrome until granted, and extensions feature-detect it (so is
  // userScripts, until you turn user scripts on — uBlock Origin Lite checks).
  const required = new Set<string>((manifest.permissions || []).filter((p: any) => typeof p === 'string'));
  const unsupported = ['history', 'bookmarks', 'topSites', 'tabGroups', 'sessions', 'browsingData', 'privacy', 'contentSettings', 'tts', 'ttsEngine', 'gcm', 'instanceID', 'tabCapture', 'desktopCapture', 'pageCapture', 'debugger', 'declarativeContent', 'readingList', 'printerProvider', 'webAuthenticationProxy', 'system.cpu', 'system.memory', 'system.storage', 'system.display'];
  for (const perm of unsupported) {
    if (!required.has(perm)) continue;
    const path = perm.split('.');
    let parent = chrome;
    for (let i = 0; i < path.length - 1; i++) parent = parent[path[i]] || (parent[path[i]] = {});
    const leaf = path[path.length - 1];
    if (parent[leaf]) continue;
    const label = perm;
    const stub = new Proxy({}, {
      get(_t, key) {
        if (typeof key !== 'string') return undefined;
        if (/^on[A-Z]/.test(key)) return event(`${label}.${key}`);
        if (/^[A-Z_]+$/.test(key)) return {};
        return method(`unsupported.${label}.${key}`);
      },
    });
    define(parent, leaf, stub);
  }

  // --- events from DEX ------------------------------------------------------------------

  const dispatch: ShimDispatch = (name, args, ids) => {
    if (name === 'contextMenus.onClicked') {
      const info: any = (args || [])[0];
      const own = info && menuClicks[String(info.menuItemId)];
      if (own) { try { own(...(args || [])); } catch (e) { console.error(e); } }
    }
    const list = (listeners[name] || []).filter((l) => !ids || ids.includes(l.id));
    // onAuthRequired may answer through its second argument (asyncBlocking),
    // or by returning the answer (or a promise of it).
    if (name === 'webRequest.onAuthRequired') {
      return Promise.all(list.map((l) => new Promise((resolve) => {
        try {
          const r = l.fn((args || [])[0], (answer: unknown) => resolve(plain(answer, 0)));
          if (r !== undefined) Promise.resolve(r).then((answer) => resolve(plain(answer, 0)), () => resolve(null));
        } catch (e) {
          console.error(e);
          resolve(null);
        }
      }))).then((answers) => answers.find((a) => a) ?? null);
    }
    let result: unknown;
    for (const l of list) {
      try {
        const r = l.fn(...(args || []));
        if (r !== undefined && result === undefined) result = r;
      } catch (e) {
        console.error(e);
      }
    }
    return result;
  };

  // A popup closing itself (most do, after a click) is DEX's view to remove.
  if (context === 'page' && typeof window !== 'undefined') {
    const closeWindow = window.close.bind(window);
    try {
      window.close = () => {
        void call('__closeWindow', []).catch(() => undefined);
        try { closeWindow(); } catch { /* not a window it may close */ }
      };
    } catch { /* leave it */ }
  }

  // Once the extension's own top-level code has run (and added its
  // listeners), tell DEX so events held while it was starting come through.
  setTimeout(() => { void call('__ready', []).catch(() => undefined); }, 0);
  return dispatch;
}
