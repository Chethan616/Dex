/**
 * declarativeNetRequest rules: checking them, Chrome's defaults, and an index
 * that finds the few rules that could match a request among tens of
 * thousands (uBlock Origin Lite turns on ~19,000 at install).
 *
 * The index files each rule under its rarest 5-character piece of literal
 * text (most rules have a urlFilter), or under a domain it names
 * (requestDomains, then initiatorDomains). A request then looks up its own
 * URL's 5-grams and its host's domains, and checks only those rules in full.
 * Each rule's pattern becomes a RegExp the first time it's needed.
 */
import { literalRuns, ngramAt, ngramsOf, NGRAM, regexLiteralRuns, urlFilterToRegExp } from './urlFilter';

export type ActionType = 'block' | 'redirect' | 'allow' | 'upgradeScheme' | 'modifyHeaders' | 'allowAllRequests';
export type HeaderOp = { header: string; operation: 'append' | 'set' | 'remove'; value?: string };

export interface RawRule {
  id: number;
  priority?: number;
  action: {
    type: ActionType;
    redirect?: {
      url?: string;
      extensionPath?: string;
      regexSubstitution?: string;
      transform?: Record<string, unknown>;
    };
    requestHeaders?: HeaderOp[];
    responseHeaders?: HeaderOp[];
  };
  condition: Record<string, unknown>;
}

export const RESOURCE_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'] as const;
const RESOURCE_SET = new Set<string>(RESOURCE_TYPES);
const ACTIONS = new Set<string>(['block', 'redirect', 'allow', 'upgradeScheme', 'modifyHeaders', 'allowAllRequests']);
const METHODS = new Set(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other']);

/** A rule ready to match. */
export interface Rule {
  id: number;
  priority: number;
  rulesetId: string;
  extensionId: string;
  action: RawRule['action'];
  raw: RawRule;
  urlFilter?: string;
  regexFilter?: string;
  caseSensitive: boolean;
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  /** The same lists as sets: a few lookups per request however long the list. */
  sets: { initiator?: Set<string>; notInitiator?: Set<string>; request?: Set<string>; notRequest?: Set<string> };
  resourceTypes?: Set<string>;
  excludedResourceTypes?: Set<string>;
  requestMethods?: Set<string>;
  excludedRequestMethods?: Set<string>;
  domainType?: 'firstParty' | 'thirdParty';
  tabIds?: Set<number>;
  excludedTabIds?: Set<number>;
  /** Response-header conditions aren't evaluated; such rules never match. */
  unsupported: boolean;
  /** The compiled pattern, made on first use. */
  pattern?: RegExp | null;
  /** Dedupes candidates within one lookup. */
  seen: number;
}

/** What a request looks like to the rules. */
export interface DnrRequest {
  url: string;
  host: string;
  method: string;
  type: string;
  tabId: number;
  initiatorHost: string | null;
  /** Filled in on first use: the registrable domains, for domainType. */
  sites?: { request: string; initiator: string | null };
}

export class RuleError extends Error {}

const strList = (v: unknown): string[] | undefined =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.toLowerCase()) : undefined);

/** Check one rule the way Chrome does, and fill in its defaults. */
export function prepareRule(raw: RawRule, rulesetId: string, extensionId: string, opts: { allowTabIds: boolean }): Rule {
  if (!raw || typeof raw !== 'object') throw new RuleError('A rule must be an object.');
  if (!Number.isInteger(raw.id) || raw.id < 1) throw new RuleError(`Rule with id ${String(raw.id)}: the id must be a positive integer.`);
  const prefix = `Rule with id ${raw.id}`;
  const action = raw.action;
  if (!action || !ACTIONS.has(action.type)) throw new RuleError(`${prefix} does not specify a valid action type.`);
  const priority = raw.priority === undefined ? 1 : raw.priority;
  if (!Number.isInteger(priority) || priority < 1) throw new RuleError(`${prefix} must have a positive priority.`);
  const c = (raw.condition ?? {}) as Record<string, unknown>;
  if (typeof c !== 'object') throw new RuleError(`${prefix} has an invalid condition.`);
  if (c.urlFilter !== undefined && c.regexFilter !== undefined) throw new RuleError(`${prefix} specifies both "urlFilter" and "regexFilter".`);
  if (c.urlFilter !== undefined && (typeof c.urlFilter !== 'string' || c.urlFilter === '')) throw new RuleError(`${prefix} specifies an empty "urlFilter".`);
  if (typeof c.urlFilter === 'string' && /[^\x20-\x7e]/.test(c.urlFilter)) throw new RuleError(`${prefix} has a non-ASCII "urlFilter".`);
  if (c.regexFilter !== undefined) {
    if (typeof c.regexFilter !== 'string' || !c.regexFilter) throw new RuleError(`${prefix} specifies an empty "regexFilter".`);
    try { new RegExp(c.regexFilter); } catch { throw new RuleError(`${prefix} specifies an invalid "regexFilter".`); }
  }
  const types = (v: unknown, key: string): Set<string> | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((t) => typeof t !== 'string' || !RESOURCE_SET.has(t))) throw new RuleError(`${prefix} has an invalid "${key}".`);
    return new Set(v as string[]);
  };
  const methods = (v: unknown, key: string): Set<string> | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((t) => typeof t !== 'string' || !METHODS.has(t))) throw new RuleError(`${prefix} has an invalid "${key}".`);
    return new Set(v as string[]);
  };
  const tabs = (v: unknown, key: string): Set<number> | undefined => {
    if (v === undefined) return undefined;
    if (!opts.allowTabIds) throw new RuleError(`${prefix}: "${key}" is only allowed in session rules.`);
    if (!Array.isArray(v) || v.some((t) => !Number.isInteger(t))) throw new RuleError(`${prefix} has an invalid "${key}".`);
    return new Set(v as number[]);
  };

  if (action.type === 'redirect') {
    const r = action.redirect;
    if (!r || (r.url === undefined && r.extensionPath === undefined && r.regexSubstitution === undefined && r.transform === undefined)) {
      throw new RuleError(`${prefix} does not specify the redirect target.`);
    }
    if (r.extensionPath !== undefined && (typeof r.extensionPath !== 'string' || !r.extensionPath.startsWith('/'))) {
      throw new RuleError(`${prefix} has an "extensionPath" that doesn't start with "/".`);
    }
    if (r.regexSubstitution !== undefined && c.regexFilter === undefined) throw new RuleError(`${prefix} uses "regexSubstitution" without "regexFilter".`);
  }
  if (action.type === 'modifyHeaders') {
    const ops = [...(action.requestHeaders ?? []), ...(action.responseHeaders ?? [])];
    if (ops.length === 0) throw new RuleError(`${prefix} doesn't modify any headers.`);
    for (const op of ops) {
      if (!op || typeof op.header !== 'string' || !op.header || !['append', 'set', 'remove'].includes(op.operation)) {
        throw new RuleError(`${prefix} has an invalid header operation.`);
      }
      if (op.operation !== 'remove' && typeof op.value !== 'string') throw new RuleError(`${prefix} must give a value to set or append "${op.header}".`);
    }
  }
  const resourceTypes = types(c.resourceTypes, 'resourceTypes');
  const excludedResourceTypes = types(c.excludedResourceTypes, 'excludedResourceTypes');
  if (action.type === 'allowAllRequests' && (!resourceTypes || [...resourceTypes].some((t) => t !== 'main_frame' && t !== 'sub_frame'))) {
    throw new RuleError(`${prefix}: "allowAllRequests" rules may only match main_frame and sub_frame.`);
  }
  const domainType = c.domainType === 'firstParty' || c.domainType === 'thirdParty' ? c.domainType : undefined;
  const initiatorDomains = strList(c.initiatorDomains ?? c.domains);
  const excludedInitiatorDomains = strList(c.excludedInitiatorDomains ?? c.excludedDomains);
  const requestDomains = strList(c.requestDomains);
  const excludedRequestDomains = strList(c.excludedRequestDomains);
  const set = (l?: string[]) => (l ? new Set(l) : undefined);
  return {
    id: raw.id,
    priority,
    rulesetId,
    extensionId,
    action,
    raw,
    urlFilter: typeof c.urlFilter === 'string' ? c.urlFilter : undefined,
    regexFilter: typeof c.regexFilter === 'string' ? c.regexFilter : undefined,
    caseSensitive: c.isUrlFilterCaseSensitive === true,
    initiatorDomains,
    excludedInitiatorDomains,
    requestDomains,
    excludedRequestDomains,
    sets: { initiator: set(initiatorDomains), notInitiator: set(excludedInitiatorDomains), request: set(requestDomains), notRequest: set(excludedRequestDomains) },
    resourceTypes,
    excludedResourceTypes,
    requestMethods: methods(c.requestMethods, 'requestMethods'),
    excludedRequestMethods: methods(c.excludedRequestMethods, 'excludedRequestMethods'),
    domainType,
    tabIds: tabs(c.tabIds, 'tabIds'),
    excludedTabIds: tabs(c.excludedTabIds, 'excludedTabIds'),
    unsupported: c.responseHeaders !== undefined || c.excludedResponseHeaders !== undefined,
    seen: 0,
  };
}

/** `host` is one of `domains` or a subdomain of one: look up the host, then each parent. */
export function inDomains(host: string, domains: Set<string> | string[]): boolean {
  const has = Array.isArray(domains) ? (d: string) => domains.includes(d) : (d: string) => domains.has(d);
  let h = host;
  for (;;) {
    if (has(h)) return true;
    const dot = h.indexOf('.');
    if (dot < 0) return false;
    h = h.slice(dot + 1);
  }
}

// Multi-label public suffixes common enough to matter for "first party".
// Without the full Public Suffix List, everything else counts its last two labels.
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in', 'edu.in', 'res.in', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'com.br', 'net.br',
  'org.br', 'gov.br', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'com.mx', 'com.tr', 'com.tw', 'com.hk', 'com.sg', 'com.my',
  'co.za', 'co.nz', 'co.kr', 'or.kr', 'co.id', 'com.ar', 'com.co', 'com.pk', 'com.ph', 'com.vn', 'com.sa', 'com.eg', 'co.il',
  'com.ua', 'co.th', 'in.th', 'com.pe', 'com.ng', 'github.io', 'blogspot.com', 'appspot.com', 'herokuapp.com', 'vercel.app',
  'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
]);

/** "news.bbc.co.uk" → "bbc.co.uk"; an IP is its own. */
export function registrableDomain(host: string): string {
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/** Every condition except the URL pattern itself. */
export function conditionsMatch(rule: Rule, req: DnrRequest): boolean {
  if (rule.unsupported) return false;
  if (rule.resourceTypes) {
    if (!rule.resourceTypes.has(req.type)) return false;
  } else if (rule.excludedResourceTypes) {
    if (rule.excludedResourceTypes.has(req.type)) return false;
  } else if (req.type === 'main_frame') {
    // Neither given: every type but main_frame, as Chrome does.
    return false;
  }
  if (rule.requestMethods && !rule.requestMethods.has(req.method)) return false;
  if (rule.excludedRequestMethods?.has(req.method)) return false;
  const { sets } = rule;
  if (sets.request && !inDomains(req.host, sets.request)) return false;
  if (sets.notRequest && inDomains(req.host, sets.notRequest)) return false;
  if (sets.initiator && (!req.initiatorHost || !inDomains(req.initiatorHost, sets.initiator))) return false;
  if (sets.notInitiator && req.initiatorHost && inDomains(req.initiatorHost, sets.notInitiator)) return false;
  if (rule.domainType) {
    const sites = req.sites ?? (req.sites = { request: registrableDomain(req.host), initiator: req.initiatorHost ? registrableDomain(req.initiatorHost) : null });
    const third = sites.initiator !== null && sites.initiator !== sites.request;
    if (rule.domainType === 'thirdParty' ? !third : third) return false;
  }
  if (rule.tabIds && !rule.tabIds.has(req.tabId)) return false;
  if (rule.excludedTabIds?.has(req.tabId)) return false;
  return true;
}

/** The URL pattern, compiled the first time a request could match it. */
export function patternMatches(rule: Rule, url: string): RegExpExecArray | true | null {
  if (rule.urlFilter === undefined && rule.regexFilter === undefined) return true;
  if (rule.pattern === undefined) {
    try {
      rule.pattern = rule.regexFilter !== undefined
        ? new RegExp(rule.regexFilter, rule.caseSensitive ? '' : 'i')
        : urlFilterToRegExp(rule.urlFilter!, rule.caseSensitive);
    } catch {
      rule.pattern = null;
    }
  }
  if (!rule.pattern) return null;
  return rule.pattern.exec(url);
}

const MAX_URL = 4096;
let stamp = 0;

export class RuleIndex {
  private byNgram = new Map<number, Rule[]>();
  private byRequestDomain = new Map<string, Rule[]>();
  private byInitiatorDomain = new Map<string, Rule[]>();
  private everywhere: Rule[] = [];
  readonly size: number;
  readonly regexCount: number;

  constructor(rules: Rule[]) {
    this.size = rules.length;
    this.regexCount = rules.filter((r) => r.regexFilter !== undefined).length;
    const push = <K>(map: Map<K, Rule[]>, key: K, rule: Rule) => {
      const list = map.get(key);
      if (list) list.push(rule); else map.set(key, [rule]);
    };
    // Pass 1: each rule's candidate 5-grams, and how common each one is.
    const grams = new Map<Rule, number[]>();
    const counts = new Map<number, number>();
    for (const rule of rules) {
      const runs = rule.regexFilter !== undefined ? regexLiteralRuns(rule.regexFilter) : rule.urlFilter !== undefined ? literalRuns(rule.urlFilter) : [];
      const all: number[] = [];
      for (const run of runs) if (run.length >= NGRAM) all.push(...ngramsOf(run).slice(0, 64));
      if (all.length === 0) continue;
      grams.set(rule, all);
      for (const g of new Set(all)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    // Pass 2: file each rule under its rarest key.
    for (const rule of rules) {
      const g = grams.get(rule);
      if (g) {
        let best = g[0];
        for (const x of g) if ((counts.get(x) ?? 0) < (counts.get(best) ?? 0)) best = x;
        push(this.byNgram, best, rule);
      } else if (rule.requestDomains?.length) {
        for (const d of rule.requestDomains) push(this.byRequestDomain, d, rule);
      } else if (rule.initiatorDomains?.length) {
        for (const d of rule.initiatorDomains) push(this.byInitiatorDomain, d, rule);
      } else {
        this.everywhere.push(rule);
      }
    }
  }

  /** Call `visit` once for each rule that could match `req` (conditions and pattern still to check). */
  candidates(req: DnrRequest, visit: (rule: Rule) => void): void {
    const mark = ++stamp;
    const once = (list: Rule[] | undefined) => {
      if (!list) return;
      for (const rule of list) {
        if (rule.seen === mark) continue;
        rule.seen = mark;
        visit(rule);
      }
    };
    const url = req.url.length > MAX_URL ? req.url.slice(0, MAX_URL) : req.url;
    if (this.byNgram.size) for (let i = 0; i + NGRAM <= url.length; i++) once(this.byNgram.get(ngramAt(url, i)));
    if (this.byRequestDomain.size) this.domainLookups(req.host, (d) => once(this.byRequestDomain.get(d)));
    if (this.byInitiatorDomain.size && req.initiatorHost) this.domainLookups(req.initiatorHost, (d) => once(this.byInitiatorDomain.get(d)));
    once(this.everywhere);
  }

  private domainLookups(host: string, look: (domain: string) => void): void {
    let h = host;
    for (;;) {
      look(h);
      const dot = h.indexOf('.');
      if (dot < 0) return;
      h = h.slice(dot + 1);
    }
  }
}
