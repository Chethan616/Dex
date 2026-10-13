/**
 * declarativeNetRequest for DEX's browser (Electron has none). This is what
 * lets an ad blocker like uBlock Origin Lite actually block.
 *
 * Each extension has static rulesets (files its manifest lists, on or off),
 * dynamic rules (kept across restarts) and session rules (until DEX quits).
 * A request is checked the way Chrome documents it:
 * - within an extension, the matching rule with the highest priority wins;
 *   on a tie: allow, allowAllRequests, block, upgradeScheme, redirect;
 * - across extensions, a block from any of them wins; otherwise the
 *   newest-installed extension's redirect or upgrade;
 * - allowAllRequests on a page or frame lets everything in it through, for
 *   that extension, up to its priority;
 * - modifyHeaders rules above an extension's allow are all applied.
 * Redirects and header changes need host access to the URL, as in Chrome.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  conditionsMatch, patternMatches, prepareRule, RuleError, RuleIndex,
  type DnrRequest, type HeaderOp, type RawRule, type Rule,
} from './rules';

export const LIMITS = {
  dynamic: 30000,
  session: 5000,
  regex: 1000,
  enabledRulesets: 50,
  staticTotal: 330000,
};

const ACTION_RANK: Record<string, number> = { allow: 5, allowAllRequests: 4, block: 3, upgradeScheme: 2, redirect: 1, modifyHeaders: 0 };

interface Ruleset { id: string; path: string; enabledByDefault: boolean }

interface Stored {
  enabledRulesets?: string[] | null;
  disabledStatic?: Record<string, number[]>;
  dynamicRules?: RawRule[];
  displayActionCount?: boolean;
}

interface ExtensionRules {
  id: string;
  rulesets: Ruleset[];
  staticIndexes: Map<string, RuleIndex>;
  staticCounts: Map<string, number>;
  disabledStatic: Map<string, Set<number>>;
  enabledRulesets: Set<string>;
  dynamic: RawRule[];
  dynamicIndex: RuleIndex;
  session: RawRule[];
  sessionIndex: RuleIndex;
  displayActionCount: boolean;
  /** Matches per tab, newest last, for getMatchedRules. */
  matched: Map<number, Array<{ ruleId: number; rulesetId: string; timeStamp: number }>>;
  actionCounts: Map<number, number>;
}

/** What DEX does with a request. */
export interface Decision {
  cancel?: boolean;
  redirectUrl?: string;
  /** modifyHeaders rules to apply, in order. */
  headerRules: Rule[];
  /** The rules that acted (blocked, redirected), for feedback. */
  acted: Rule[];
}

export interface EngineDeps {
  dir: string;
  extensionDir(id: string): string | null;
  manifest(id: string): Record<string, unknown> | null;
  /** Newest-installed first. */
  installOrder(): string[];
  hasHostAccess(id: string, url: string): boolean;
  hasPermission(id: string, permission: string): boolean;
  /** Extensions' request ids whose blocked count shows as their badge. */
  setBadge(id: string, tabId: number, text: string): void;
  log?(event: string, data: Record<string, unknown>): void;
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}

/** Apply a redirect's transform to `url` (Chrome's URLTransform). */
export function transformUrl(url: string, t: Record<string, unknown>): string {
  const u = new URL(url);
  if (typeof t.scheme === 'string') u.protocol = `${t.scheme}:`;
  if (typeof t.host === 'string') u.hostname = t.host;
  if (typeof t.port === 'string') u.port = t.port;
  if (typeof t.path === 'string') u.pathname = t.path || '/';
  if (typeof t.query === 'string') u.search = t.query;
  const qt = t.queryTransform as { removeParams?: string[]; addOrReplaceParams?: Array<{ key: string; value: string; replaceOnly?: boolean }> } | undefined;
  if (qt) {
    for (const p of qt.removeParams ?? []) u.searchParams.delete(p);
    for (const p of qt.addOrReplaceParams ?? []) {
      if (p.replaceOnly && !u.searchParams.has(p.key)) continue;
      u.searchParams.set(p.key, p.value);
    }
  }
  if (typeof t.fragment === 'string') u.hash = t.fragment;
  if (typeof t.username === 'string') u.username = t.username;
  if (typeof t.password === 'string') u.password = t.password;
  return u.href;
}

/** Where a redirect rule sends `url`, or null. */
export function redirectTarget(rule: Rule, url: string): string | null {
  const r = rule.action.redirect;
  if (!r) return null;
  try {
    if (r.extensionPath) return `chrome-extension://${rule.extensionId}${r.extensionPath}`;
    if (r.transform) return transformUrl(url, r.transform);
    if (r.regexSubstitution !== undefined && rule.regexFilter) {
      const m = new RegExp(rule.regexFilter, rule.caseSensitive ? '' : 'i').exec(url);
      if (!m) return null;
      const sub = r.regexSubstitution.replace(/\\(\d)/g, (_s, d: string) => (d === '0' ? m[0] : m[Number(d)] ?? ''));
      return url.slice(0, m.index) + sub + url.slice(m.index + m[0].length);
    }
    if (r.url) return new URL(r.url).href;
  } catch {
    return null;
  }
  return null;
}

export function upgraded(url: string): string | null {
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  if (url.startsWith('ws://')) return `wss://${url.slice(5)}`;
  return null;
}

/** Apply modifyHeaders operations, Chrome's way: a higher rule's set/remove wins; appends add up. */
export function applyRequestHeaders(headers: Record<string, string>, rules: Rule[]): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  const keyOf = (name: string) => Object.keys(out).find((k) => k.toLowerCase() === name.toLowerCase());
  const settled = new Set<string>();
  for (const rule of rules) {
    for (const op of rule.action.requestHeaders ?? []) {
      const name = op.header.toLowerCase();
      if (settled.has(name) && op.operation !== 'append') continue;
      const key = keyOf(name);
      if (op.operation === 'remove') { if (key) delete out[key]; settled.add(name); }
      else if (op.operation === 'set') { if (key) delete out[key]; out[op.header] = op.value ?? ''; settled.add(name); }
      else {
        const sep = name === 'cookie' ? '; ' : ', ';
        if (key) out[key] = `${out[key]}${sep}${op.value ?? ''}`; else out[op.header] = op.value ?? '';
      }
    }
  }
  return out;
}

export function applyResponseHeaders(headers: Record<string, string[]>, rules: Rule[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = [...v];
  const keyOf = (name: string) => Object.keys(out).find((k) => k.toLowerCase() === name.toLowerCase());
  const settled = new Set<string>();
  for (const rule of rules) {
    for (const op of rule.action.responseHeaders ?? []) {
      const name = op.header.toLowerCase();
      if (settled.has(name) && op.operation !== 'append') continue;
      const key = keyOf(name);
      if (op.operation === 'remove') { if (key) delete out[key]; settled.add(name); }
      else if (op.operation === 'set') { if (key) delete out[key]; out[op.header] = [op.value ?? '']; settled.add(name); }
      else if (key) out[key].push(op.value ?? '');
      else out[op.header] = [op.value ?? ''];
    }
  }
  return out;
}

export class DnrEngine {
  private exts = new Map<string, ExtensionRules>();
  /** allowAllRequests a page or frame got: `${tabId}:${frameKey}` → extension → priority. */
  private frameAllows = new Map<string, Map<string, number>>();
  private changeListeners = new Set<() => void>();

  constructor(private readonly deps: EngineDeps) {}

  private stateFile(id: string): string { return path.join(this.deps.dir, `${id}.json`); }

  onChanged(listener: () => void): void { this.changeListeners.add(listener); }
  private changed(): void { for (const l of this.changeListeners) l(); }

  /** Rules anywhere: the request listeners are only installed while this is true. */
  hasRules(): boolean {
    for (const e of this.exts.values()) {
      if (e.dynamicIndex.size || e.sessionIndex.size) return true;
      for (const id of e.enabledRulesets) if ((e.staticIndexes.get(id)?.size ?? 0) > 0) return true;
    }
    return false;
  }

  /** An extension loaded: read its rulesets and saved state. */
  load(id: string): void {
    const manifest = this.deps.manifest(id);
    const dir = this.deps.extensionDir(id);
    const dnr = manifest?.declarative_net_request as { rule_resources?: Array<{ id?: unknown; path?: unknown; enabled?: unknown }> } | undefined;
    if (!manifest || !dir || (!this.deps.hasPermission(id, 'declarativeNetRequest') && !this.deps.hasPermission(id, 'declarativeNetRequestWithHostAccess'))) return;
    const rulesets: Ruleset[] = (dnr?.rule_resources ?? [])
      .filter((r) => typeof r.id === 'string' && typeof r.path === 'string')
      .map((r) => ({ id: r.id as string, path: r.path as string, enabledByDefault: r.enabled === true }));
    const stored = readJson<Stored>(this.stateFile(id)) ?? {};
    const enabled = new Set(stored.enabledRulesets ?? rulesets.filter((r) => r.enabledByDefault).map((r) => r.id));
    const ext: ExtensionRules = {
      id,
      rulesets,
      staticIndexes: new Map(),
      staticCounts: new Map(),
      disabledStatic: new Map(Object.entries(stored.disabledStatic ?? {}).map(([k, v]) => [k, new Set(v)])),
      enabledRulesets: new Set([...enabled].filter((r) => rulesets.some((x) => x.id === r))),
      dynamic: [],
      dynamicIndex: new RuleIndex([]),
      session: this.exts.get(id)?.session ?? [],
      sessionIndex: new RuleIndex([]),
      displayActionCount: stored.displayActionCount === true,
      matched: new Map(),
      actionCounts: new Map(),
    };
    this.exts.set(id, ext);
    const started = Date.now();
    for (const r of ext.enabledRulesets) this.loadRuleset(ext, r);
    ext.dynamic = (stored.dynamicRules ?? []).filter((r) => { try { prepareRule(r, '_dynamic', id, { allowTabIds: false }); return true; } catch { return false; } });
    ext.dynamicIndex = this.indexOf(ext.dynamic, '_dynamic', id, false);
    ext.sessionIndex = this.indexOf(ext.session, '_session', id, true);
    this.deps.log?.('extensions.dnr.loaded', {
      id, rulesets: [...ext.enabledRulesets], rules: [...ext.staticCounts.values()].reduce((a, b) => a + b, 0) + ext.dynamic.length, ms: Date.now() - started,
    });
    this.changed();
  }

  unload(id: string, removed: boolean): void {
    this.exts.delete(id);
    for (const m of this.frameAllows.values()) m.delete(id);
    if (removed) fs.rmSync(this.stateFile(id), { force: true });
    this.changed();
  }

  private loadRuleset(ext: ExtensionRules, rulesetId: string): void {
    const rs = ext.rulesets.find((r) => r.id === rulesetId);
    const dir = this.deps.extensionDir(ext.id);
    if (!rs || !dir) return;
    const file = path.resolve(dir, rs.path.replace(/^\/+/, ''));
    if (path.relative(dir, file).startsWith('..')) return;
    const raw = readJson<RawRule[]>(file);
    if (!Array.isArray(raw)) {
      this.deps.log?.('extensions.dnr.rulesetUnreadable', { id: ext.id, rulesetId });
      return;
    }
    ext.staticIndexes.set(rulesetId, this.indexOf(raw, rulesetId, ext.id, false));
    ext.staticCounts.set(rulesetId, raw.length);
  }

  /** Index the rules that check out; skip (and count) the rest, as Chrome does for static rulesets. */
  private indexOf(raw: RawRule[], rulesetId: string, extensionId: string, session: boolean): RuleIndex {
    const rules: Rule[] = [];
    let bad = 0;
    for (const r of raw) {
      try { rules.push(prepareRule(r, rulesetId, extensionId, { allowTabIds: session })); } catch { bad++; }
    }
    if (bad) this.deps.log?.('extensions.dnr.skippedRules', { extensionId, rulesetId, bad });
    return new RuleIndex(rules);
  }

  private save(ext: ExtensionRules): void {
    const stored: Stored = {
      enabledRulesets: [...ext.enabledRulesets],
      disabledStatic: Object.fromEntries([...ext.disabledStatic].map(([k, v]) => [k, [...v]])),
      dynamicRules: ext.dynamic,
      displayActionCount: ext.displayActionCount,
    };
    fs.mkdirSync(this.deps.dir, { recursive: true });
    fs.writeFileSync(this.stateFile(ext.id), JSON.stringify(stored));
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------

  /** The highest rule per extension (and its header rules), Chrome's order. */
  private evaluateExtension(ext: ExtensionRules, req: DnrRequest, frameAllow: number): { best: Rule | null; headers: Rule[]; allowPriority: number } {
    let best: Rule | null = null;
    const headers: Rule[] = [];
    const consider = (rule: Rule) => {
      if (!conditionsMatch(rule, req)) return;
      if (rule.rulesetId !== '_dynamic' && rule.rulesetId !== '_session' && ext.disabledStatic.get(rule.rulesetId)?.has(rule.id)) return;
      if (!patternMatches(rule, req.url)) return;
      if (rule.action.type === 'modifyHeaders') { headers.push(rule); return; }
      if (!best || rule.priority > best.priority || (rule.priority === best.priority && ACTION_RANK[rule.action.type] > ACTION_RANK[best.action.type])) best = rule;
    };
    for (const id of ext.enabledRulesets) ext.staticIndexes.get(id)?.candidates(req, consider);
    ext.dynamicIndex.candidates(req, consider);
    ext.sessionIndex.candidates(req, consider);
    let allowPriority = frameAllow;
    const top = best as Rule | null;
    if (top && (top.action.type === 'allow' || top.action.type === 'allowAllRequests')) allowPriority = Math.max(allowPriority, top.priority);
    const effective = top && top.priority > frameAllow ? top : null;
    return {
      best: effective,
      headers: headers.filter((h) => h.priority > allowPriority).sort((a, b) => b.priority - a.priority),
      allowPriority,
    };
  }

  /**
   * What happens to a request. `frameKeys` are the request's frame and its
   * ancestors (`${tabId}:${frameId}`), for allowAllRequests; `frameKey` is
   * the frame a main_frame/sub_frame request loads.
   */
  evaluate(req: DnrRequest, ctx: { frameKeys: string[]; frameKey?: string }): Decision {
    const decision: Decision = { headerRules: [], acted: [] };
    if (this.exts.size === 0) return decision;
    const isFrame = req.type === 'main_frame' || req.type === 'sub_frame';
    if (req.type === 'main_frame') this.resetTab(req.tabId);
    let redirect: { rule: Rule; url: string } | null = null;
    for (const id of this.deps.installOrder()) {
      const ext = this.exts.get(id);
      if (!ext) continue;
      let frameAllow = 0;
      for (const key of ctx.frameKeys) frameAllow = Math.max(frameAllow, this.frameAllows.get(key)?.get(id) ?? 0);
      const { best, headers } = this.evaluateExtension(ext, req, frameAllow);
      const hostAccess = this.deps.hasPermission(id, 'declarativeNetRequest') ? null : this.deps.hasHostAccess(id, req.url);
      decision.headerRules.push(...headers.filter(() => this.deps.hasHostAccess(id, req.url)));
      if (!best) continue;
      if (best.action.type === 'allowAllRequests') {
        if (isFrame && ctx.frameKey) {
          const m = this.frameAllows.get(ctx.frameKey) ?? new Map<string, number>();
          m.set(id, best.priority);
          this.frameAllows.set(ctx.frameKey, m);
        }
        continue;
      }
      if (best.action.type === 'allow') continue;
      if (best.action.type === 'block') {
        if (hostAccess === false) continue;
        decision.cancel = true;
        decision.acted = [best];
        this.recordMatch(ext, req.tabId, best);
        return decision;
      }
      if (redirect || !this.deps.hasHostAccess(id, req.url)) continue;
      const target = best.action.type === 'upgradeScheme' ? upgraded(req.url) : redirectTarget(best, req.url);
      if (target && target !== req.url) redirect = { rule: best, url: target };
    }
    if (redirect) {
      decision.redirectUrl = redirect.url;
      decision.acted = [redirect.rule];
      const ext = this.exts.get(redirect.rule.extensionId);
      if (ext) this.recordMatch(ext, req.tabId, redirect.rule);
    }
    return decision;
  }

  private resetTab(tabId: number): void {
    if (tabId < 0) return;
    const prefix = `${tabId}:`;
    for (const key of [...this.frameAllows.keys()]) if (key.startsWith(prefix)) this.frameAllows.delete(key);
    for (const ext of this.exts.values()) {
      ext.matched.delete(tabId);
      if (ext.actionCounts.delete(tabId) && ext.displayActionCount) this.deps.setBadge(ext.id, tabId, '');
    }
  }

  /** A tab closed. */
  forgetTab(tabId: number): void {
    this.resetTab(tabId);
  }

  private recordMatch(ext: ExtensionRules, tabId: number, rule: Rule): void {
    if (tabId < 0) return;
    const list = ext.matched.get(tabId) ?? [];
    list.push({ ruleId: rule.id, rulesetId: rule.rulesetId, timeStamp: Date.now() });
    if (list.length > 300) list.splice(0, list.length - 300);
    ext.matched.set(tabId, list);
    const count = (ext.actionCounts.get(tabId) ?? 0) + 1;
    ext.actionCounts.set(tabId, count);
    if (ext.displayActionCount) this.deps.setBadge(ext.id, tabId, count > 999 ? '999+' : String(count));
  }

  // ---------------------------------------------------------------------------
  // chrome.declarativeNetRequest
  // ---------------------------------------------------------------------------

  private need(id: string): ExtensionRules {
    const ext = this.exts.get(id);
    if (!ext) throw new RuleError("The extension doesn't have the declarativeNetRequest permission.");
    return ext;
  }

  private checkRules(raw: unknown, rulesetId: string, extensionId: string, session: boolean): RawRule[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new RuleError('Rules must be a list.');
    const seen = new Set<number>();
    for (const r of raw as RawRule[]) {
      prepareRule(r, rulesetId, extensionId, { allowTabIds: session });
      if (seen.has(r.id)) throw new RuleError(`Rule with id ${r.id} does not have a unique ID.`);
      seen.add(r.id);
    }
    return raw as RawRule[];
  }

  private updateRules(current: RawRule[], options: unknown, rulesetId: string, extensionId: string, session: boolean, limit: number): RawRule[] {
    const o = (options ?? {}) as { removeRuleIds?: unknown; addRules?: unknown };
    const remove = new Set(Array.isArray(o.removeRuleIds) ? o.removeRuleIds.filter((x): x is number => Number.isInteger(x)) : []);
    const add = this.checkRules(o.addRules, rulesetId, extensionId, session);
    const next = current.filter((r) => !remove.has(r.id));
    const ids = new Set(next.map((r) => r.id));
    for (const r of add) {
      if (ids.has(r.id)) throw new RuleError(`Rule with id ${r.id} does not have a unique ID.`);
      ids.add(r.id);
    }
    const all = [...next, ...add];
    if (all.length > limit) throw new RuleError(`The number of rules exceeds the ${limit} limit.`);
    const regexCount = all.filter((r) => typeof r.condition?.regexFilter === 'string').length;
    if (regexCount > LIMITS.regex) throw new RuleError(`The number of regex rules exceeds the ${LIMITS.regex} limit.`);
    return all;
  }

  handlers(): Record<string, (ctx: { extensionId: string }, args: unknown[]) => unknown> {
    const filterIds = (rules: RawRule[], opts: unknown) => {
      const ids = (opts as { ruleIds?: unknown } | undefined)?.ruleIds;
      return Array.isArray(ids) ? rules.filter((r) => ids.includes(r.id)) : rules;
    };
    return {
      'declarativeNetRequest.updateDynamicRules': (ctx, [opts]) => {
        const ext = this.need(ctx.extensionId);
        ext.dynamic = this.updateRules(ext.dynamic, opts, '_dynamic', ext.id, false, LIMITS.dynamic);
        ext.dynamicIndex = this.indexOf(ext.dynamic, '_dynamic', ext.id, false);
        this.save(ext);
        this.changed();
      },
      'declarativeNetRequest.getDynamicRules': (ctx, [opts]) => filterIds(this.need(ctx.extensionId).dynamic, opts),
      'declarativeNetRequest.updateSessionRules': (ctx, [opts]) => {
        const ext = this.need(ctx.extensionId);
        ext.session = this.updateRules(ext.session, opts, '_session', ext.id, true, LIMITS.session);
        ext.sessionIndex = this.indexOf(ext.session, '_session', ext.id, true);
        this.changed();
      },
      'declarativeNetRequest.getSessionRules': (ctx, [opts]) => filterIds(this.need(ctx.extensionId).session, opts),
      'declarativeNetRequest.updateEnabledRulesets': (ctx, [opts]) => {
        const ext = this.need(ctx.extensionId);
        const o = (opts ?? {}) as { enableRulesetIds?: unknown; disableRulesetIds?: unknown };
        const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        const enable = list(o.enableRulesetIds);
        const disable = list(o.disableRulesetIds);
        for (const id of [...enable, ...disable]) {
          if (!ext.rulesets.some((r) => r.id === id)) throw new RuleError(`Invalid ruleset id: ${id}.`);
        }
        const next = new Set(ext.enabledRulesets);
        for (const id of disable) next.delete(id);
        for (const id of enable) next.add(id);
        if (next.size > LIMITS.enabledRulesets) throw new RuleError(`The number of enabled static rulesets exceeds the ${LIMITS.enabledRulesets} limit.`);
        for (const id of disable) { ext.staticIndexes.delete(id); ext.staticCounts.delete(id); }
        ext.enabledRulesets = next;
        for (const id of enable) if (!ext.staticIndexes.has(id)) this.loadRuleset(ext, id);
        this.save(ext);
        this.changed();
      },
      'declarativeNetRequest.getEnabledRulesets': (ctx) => [...this.need(ctx.extensionId).enabledRulesets],
      'declarativeNetRequest.updateStaticRules': (ctx, [opts]) => {
        const ext = this.need(ctx.extensionId);
        const o = (opts ?? {}) as { rulesetId?: unknown; disableRuleIds?: unknown; enableRuleIds?: unknown };
        if (typeof o.rulesetId !== 'string' || !ext.rulesets.some((r) => r.id === o.rulesetId)) throw new RuleError(`Invalid ruleset id: ${String(o.rulesetId)}.`);
        const set = ext.disabledStatic.get(o.rulesetId) ?? new Set<number>();
        for (const id of Array.isArray(o.disableRuleIds) ? o.disableRuleIds : []) if (Number.isInteger(id)) set.add(id as number);
        for (const id of Array.isArray(o.enableRuleIds) ? o.enableRuleIds : []) set.delete(id as number);
        ext.disabledStatic.set(o.rulesetId, set);
        this.save(ext);
      },
      'declarativeNetRequest.getDisabledRuleIds': (ctx, [opts]) => {
        const ext = this.need(ctx.extensionId);
        const id = (opts as { rulesetId?: string } | undefined)?.rulesetId ?? '';
        return [...(ext.disabledStatic.get(id) ?? [])];
      },
      'declarativeNetRequest.getAvailableStaticRuleCount': (ctx) => {
        const ext = this.need(ctx.extensionId);
        let used = 0;
        for (const id of ext.enabledRulesets) used += ext.staticCounts.get(id) ?? 0;
        return Math.max(0, LIMITS.staticTotal - used);
      },
      'declarativeNetRequest.isRegexSupported': (_ctx, [opts]) => {
        const regex = (opts as { regex?: unknown } | undefined)?.regex;
        if (typeof regex !== 'string') return { isSupported: false, reason: 'syntaxError' };
        try { new RegExp(regex); return { isSupported: true }; } catch { return { isSupported: false, reason: 'syntaxError' }; }
      },
      'declarativeNetRequest.setExtensionActionOptions': (ctx, [opts]) => {
        const ext = this.need(ctx.extensionId);
        const o = (opts ?? {}) as { displayActionCountAsBadgeText?: unknown; tabUpdate?: { tabId?: number; increment?: number } };
        if (typeof o.displayActionCountAsBadgeText === 'boolean') {
          ext.displayActionCount = o.displayActionCountAsBadgeText;
          this.save(ext);
          for (const [tabId, count] of ext.actionCounts) this.deps.setBadge(ext.id, tabId, ext.displayActionCount && count ? String(count) : '');
        }
        if (o.tabUpdate && Number.isInteger(o.tabUpdate.tabId) && Number.isInteger(o.tabUpdate.increment)) {
          const tabId = o.tabUpdate.tabId as number;
          const count = Math.max(0, (ext.actionCounts.get(tabId) ?? 0) + (o.tabUpdate.increment as number));
          ext.actionCounts.set(tabId, count);
          if (ext.displayActionCount) this.deps.setBadge(ext.id, tabId, count ? String(count) : '');
        }
      },
      'declarativeNetRequest.getMatchedRules': (ctx, [filter]) => {
        const ext = this.need(ctx.extensionId);
        if (!this.deps.hasPermission(ext.id, 'declarativeNetRequestFeedback') && !this.deps.hasPermission(ext.id, 'activeTab')) {
          throw new RuleError("The extension needs the 'declarativeNetRequestFeedback' permission.");
        }
        const f = (filter ?? {}) as { tabId?: number; minTimeStamp?: number };
        const out: Array<{ rule: { ruleId: number; rulesetId: string }; tabId: number; timeStamp: number }> = [];
        for (const [tabId, list] of ext.matched) {
          if (f.tabId !== undefined && f.tabId !== tabId) continue;
          for (const m of list) if (!f.minTimeStamp || m.timeStamp >= f.minTimeStamp) out.push({ rule: { ruleId: m.ruleId, rulesetId: m.rulesetId }, tabId, timeStamp: m.timeStamp });
        }
        return { rulesMatchedInfo: out };
      },
      'declarativeNetRequest.testMatchOutcome': (ctx, [request]) => {
        const ext = this.need(ctx.extensionId);
        const r = (request ?? {}) as { url?: string; type?: string; method?: string; tabId?: number; initiator?: string };
        if (typeof r.url !== 'string' || typeof r.type !== 'string') throw new RuleError('A url and a type are required.');
        const host = (() => { try { return new URL(r.url!).hostname.toLowerCase(); } catch { return ''; } })();
        const initiatorHost = (() => { try { return r.initiator ? new URL(r.initiator).hostname.toLowerCase() : null; } catch { return null; } })();
        const req: DnrRequest = { url: r.url, host, method: (r.method ?? 'get').toLowerCase(), type: r.type, tabId: r.tabId ?? -1, initiatorHost };
        const { best, headers } = this.evaluateExtension(ext, req, 0);
        const matched = [...(best ? [best] : []), ...headers];
        return { matchedRules: matched.map((m) => ({ ruleId: m.id, rulesetId: m.rulesetId })) };
      },
    };
  }

  /** A short summary, for the log and the Extensions page. */
  stats(id: string): { rules: number; rulesets: string[] } | null {
    const ext = this.exts.get(id);
    if (!ext) return null;
    let rules = ext.dynamic.length + ext.session.length;
    for (const r of ext.enabledRulesets) rules += ext.staticCounts.get(r) ?? 0;
    return { rules, rulesets: [...ext.enabledRulesets] };
  }
}

export type { HeaderOp };
