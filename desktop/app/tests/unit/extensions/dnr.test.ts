import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { urlFilterToRegExp, regexLiteralRuns } from '../../../src/main/extensions/dnr/urlFilter';
import { prepareRule, registrableDomain, RuleError, type DnrRequest, type RawRule } from '../../../src/main/extensions/dnr/rules';
import { DnrEngine, applyRequestHeaders, applyResponseHeaders, transformUrl } from '../../../src/main/extensions/dnr/engine';
import { requestFilterMatches } from '../../../src/main/extensions/webRequestHub';

const matches = (filter: string, url: string, cs = false) => urlFilterToRegExp(filter, cs).test(url);

describe('urlFilter', () => {
  it('anchors || at the host or any subdomain, and nowhere else', () => {
    expect(matches('||ads.example.com^', 'https://ads.example.com/x.js')).toBe(true);
    expect(matches('||example.com^', 'https://cdn.example.com/x')).toBe(true);
    expect(matches('||example.com^', 'https://badexample.com/x')).toBe(false);
    expect(matches('||example.com^', 'https://other.org/?u=example.com')).toBe(false);
  });

  it('treats ^ as a separator or the end, and | as the start or end', () => {
    expect(matches('/ads^', 'https://a.example/ads?x=1')).toBe(true);
    expect(matches('/ads^', 'https://a.example/ads')).toBe(true);
    expect(matches('/ads^', 'https://a.example/adsl')).toBe(false);
    expect(matches('|https://a.example/', 'https://a.example/x')).toBe(true);
    expect(matches('|https://a.example/', 'http://b.example/https://a.example/')).toBe(false);
    expect(matches('.gif|', 'https://a.example/x.gif')).toBe(true);
    expect(matches('.gif|', 'https://a.example/x.gif?y')).toBe(false);
  });

  it('is case-insensitive unless the rule says otherwise', () => {
    expect(matches('/Banner/', 'https://a.example/banner/x')).toBe(true);
    expect(matches('/Banner/', 'https://a.example/banner/x', true)).toBe(false);
  });

  it('finds only the literals a regex truly requires', () => {
    expect(regexLiteralRuns('^https://example\\.com/ads/[0-9]+\\.js$')).toEqual(['https://example.com/ads/', '.js']);
    expect(regexLiteralRuns('(optional)?required')).toEqual(['required']);
    expect(regexLiteralRuns('ab|cd')).toEqual([]);
    expect(regexLiteralRuns('colou?r')).toEqual(['colo', 'r']);
  });
});

describe('rules', () => {
  it('checks rules the way Chrome does', () => {
    const bad = (r: unknown) => () => prepareRule(r as RawRule, 'x', 'e', { allowTabIds: false });
    expect(bad({ id: 0, action: { type: 'block' }, condition: {} })).toThrow(RuleError);
    expect(bad({ id: 1, action: { type: 'explode' }, condition: {} })).toThrow(/action type/);
    expect(bad({ id: 2, action: { type: 'block' }, condition: { urlFilter: 'a', regexFilter: 'b' } })).toThrow(/both/);
    expect(bad({ id: 3, action: { type: 'redirect' }, condition: {} })).toThrow(/redirect target/);
    expect(bad({ id: 4, action: { type: 'block' }, condition: { tabIds: [1] } })).toThrow(/session rules/);
    expect(bad({ id: 5, action: { type: 'allowAllRequests' }, condition: { resourceTypes: ['script'] } })).toThrow(/main_frame/);
    expect(bad({ id: 6, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'x', operation: 'set' }] }, condition: {} })).toThrow(/value/);
  });

  it('knows first and third parties', () => {
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('a.b.example.com')).toBe('example.com');
    expect(registrableDomain('192.168.1.4')).toBe('192.168.1.4');
  });
});

describe('DnrEngine', () => {
  let dir: string;
  let extDir: string;
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);
  let manifests: Record<string, Record<string, unknown>>;
  let order: string[];
  let badges: Array<[string, number, string]>;

  const req = (url: string, type = 'script', initiator: string | null = 'site.example', tabId = 1): DnrRequest => ({
    url, host: new URL(url).hostname, method: 'get', type, tabId, initiatorHost: initiator,
  });

  function engine(): DnrEngine {
    return new DnrEngine({
      dir,
      extensionDir: () => extDir,
      manifest: (id) => manifests[id] ?? null,
      installOrder: () => order,
      hasHostAccess: () => true,
      hasPermission: (id, p) => ((manifests[id]?.permissions as string[]) ?? []).includes(p),
      setBadge: (id, tabId, text) => badges.push([id, tabId, text]),
    });
  }

  function staticRules(id: string, rules: RawRule[], enabled = true): void {
    fs.writeFileSync(path.join(extDir, `${id}.json`), JSON.stringify(rules));
    manifests[id] = {
      permissions: ['declarativeNetRequest', 'declarativeNetRequestFeedback'],
      declarative_net_request: { rule_resources: [{ id: 'main', path: `${id}.json`, enabled }] },
    };
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-dnr-'));
    extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-dnr-ext-'));
    manifests = {};
    order = [A, B];
    badges = [];
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(extDir, { recursive: true, force: true });
  });

  it('blocks what a static rule says, and leaves the rest alone', () => {
    staticRules(A, [{ id: 1, action: { type: 'block' }, condition: { urlFilter: '||tracker.example^' } }]);
    const e = engine();
    e.load(A);
    expect(e.evaluate(req('https://tracker.example/t.js'), { frameKeys: ['1:0'] }).cancel).toBe(true);
    expect(e.evaluate(req('https://fine.example/app.js'), { frameKeys: ['1:0'] }).cancel).toBeUndefined();
  });

  it('never matches main_frame unless the rule says so', () => {
    staticRules(A, [{ id: 1, action: { type: 'block' }, condition: { urlFilter: '||blocked.example^' } }]);
    const e = engine();
    e.load(A);
    expect(e.evaluate(req('https://blocked.example/', 'main_frame', null), { frameKeys: [], frameKey: '1:0' }).cancel).toBeUndefined();
  });

  it('lets a higher-priority allow beat a block, and on a tie allow wins', () => {
    staticRules(A, [
      { id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||cdn.example^' } },
      { id: 2, priority: 2, action: { type: 'allow' }, condition: { urlFilter: '||cdn.example/ok' } },
      { id: 3, priority: 5, action: { type: 'block' }, condition: { urlFilter: '||cdn.example/tie' } },
      { id: 4, priority: 5, action: { type: 'allow' }, condition: { urlFilter: '||cdn.example/tie' } },
    ]);
    const e = engine();
    e.load(A);
    expect(e.evaluate(req('https://cdn.example/x.js'), { frameKeys: ['1:0'] }).cancel).toBe(true);
    expect(e.evaluate(req('https://cdn.example/ok.js'), { frameKeys: ['1:0'] }).cancel).toBeUndefined();
    expect(e.evaluate(req('https://cdn.example/tie.js'), { frameKeys: ['1:0'] }).cancel).toBeUndefined();
  });

  it('blocks when any extension blocks, else takes the newest extension\'s redirect', () => {
    staticRules(A, [{ id: 1, action: { type: 'redirect', redirect: { url: 'https://a-target.example/' } }, condition: { urlFilter: '||x.example^' } }]);
    staticRules(B, [{ id: 1, action: { type: 'redirect', redirect: { url: 'https://b-target.example/' } }, condition: { urlFilter: '||x.example^' } }]);
    const e = engine();
    e.load(A);
    e.load(B);
    expect(e.evaluate(req('https://x.example/s.js'), { frameKeys: ['1:0'] }).redirectUrl).toBe('https://a-target.example/');
    order = [B, A];
    expect(e.evaluate(req('https://x.example/s.js'), { frameKeys: ['1:0'] }).redirectUrl).toBe('https://b-target.example/');
  });

  it('honours allowAllRequests on a page for everything in it', () => {
    staticRules(A, [
      { id: 1, priority: 10, action: { type: 'allowAllRequests' }, condition: { urlFilter: '||trusted.example^', resourceTypes: ['main_frame'] } },
      { id: 2, priority: 5, action: { type: 'block' }, condition: { urlFilter: '||ads.example^' } },
    ]);
    const e = engine();
    e.load(A);
    expect(e.evaluate(req('https://trusted.example/', 'main_frame', null), { frameKeys: [], frameKey: '1:0' }).cancel).toBeUndefined();
    expect(e.evaluate(req('https://ads.example/a.js', 'script', 'trusted.example'), { frameKeys: ['1:0'] }).cancel).toBeUndefined();
    // Another page in the same tab: the allowance is gone.
    e.evaluate(req('https://other.example/', 'main_frame', null), { frameKeys: [], frameKey: '1:0' });
    expect(e.evaluate(req('https://ads.example/a.js', 'script', 'other.example'), { frameKeys: ['1:0'] }).cancel).toBe(true);
  });

  it('redirects to the extension\'s own files, by regex substitution, and by transform', () => {
    staticRules(A, [
      { id: 1, action: { type: 'redirect', redirect: { extensionPath: '/web_accessible_resources/noop.js' } }, condition: { urlFilter: '||ads.example/x.js' } },
      { id: 2, action: { type: 'redirect', redirect: { regexSubstitution: 'https://img.example/\\1.webp' } }, condition: { regexFilter: '^https://old\\.example/(\\w+)\\.png$' } },
      { id: 3, action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['utm_source'] } } } }, condition: { urlFilter: 'utm_source=' } },
      { id: 4, action: { type: 'upgradeScheme' }, condition: { urlFilter: '|http://plain.example/' } },
    ]);
    const e = engine();
    e.load(A);
    const at = (url: string) => e.evaluate(req(url), { frameKeys: ['1:0'] }).redirectUrl;
    expect(at('https://ads.example/x.js')).toBe(`chrome-extension://${A}/web_accessible_resources/noop.js`);
    expect(at('https://old.example/cat.png')).toBe('https://img.example/cat.webp');
    expect(at('https://shop.example/p?id=1&utm_source=mail')).toBe('https://shop.example/p?id=1');
    expect(at('http://plain.example/x')).toBe('https://plain.example/x');
  });

  it('honours domain conditions and first/third party', () => {
    staticRules(A, [
      { id: 1, action: { type: 'block' }, condition: { urlFilter: '/pixel.gif', domainType: 'thirdParty' } },
      { id: 2, action: { type: 'block' }, condition: { requestDomains: ['cdn.blocked.example'], initiatorDomains: ['news.example'] } },
    ]);
    const e = engine();
    e.load(A);
    expect(e.evaluate(req('https://a.example/pixel.gif', 'image', 'b.example'), { frameKeys: ['1:0'] }).cancel).toBe(true);
    expect(e.evaluate(req('https://a.example/pixel.gif', 'image', 'www.a.example'), { frameKeys: ['1:0'] }).cancel).toBeUndefined();
    expect(e.evaluate(req('https://x.cdn.blocked.example/a', 'script', 'm.news.example'), { frameKeys: ['1:0'] }).cancel).toBe(true);
    expect(e.evaluate(req('https://x.cdn.blocked.example/a', 'script', 'other.example'), { frameKeys: ['1:0'] }).cancel).toBeUndefined();
  });

  it('keeps dynamic rules across a restart, rejects duplicates, and forgets them when removed', async () => {
    manifests[A] = { permissions: ['declarativeNetRequest'] };
    const e = engine();
    e.load(A);
    const h = e.handlers();
    await h['declarativeNetRequest.updateDynamicRules']({ extensionId: A }, [{ addRules: [{ id: 7, action: { type: 'block' }, condition: { urlFilter: 'evil' } }] }]);
    expect(() => h['declarativeNetRequest.updateDynamicRules']({ extensionId: A }, [{ addRules: [{ id: 7, action: { type: 'block' }, condition: { urlFilter: 'x' } }] }])).toThrow(/unique/);
    const again = engine();
    again.load(A);
    expect(again.evaluate(req('https://evil.example/a.js'), { frameKeys: ['1:0'] }).cancel).toBe(true);
    expect(again.handlers()['declarativeNetRequest.getDynamicRules']({ extensionId: A }, [])).toHaveLength(1);
    again.unload(A, true);
    const third = engine();
    third.load(A);
    expect(third.evaluate(req('https://evil.example/a.js'), { frameKeys: ['1:0'] }).cancel).toBeUndefined();
  });

  it('turns rulesets on and off and remembers the choice', async () => {
    staticRules(A, [{ id: 1, action: { type: 'block' }, condition: { urlFilter: 'tracker' } }], false);
    const e = engine();
    e.load(A);
    expect(e.evaluate(req('https://tracker.example/'), { frameKeys: ['1:0'] }).cancel).toBeUndefined();
    await e.handlers()['declarativeNetRequest.updateEnabledRulesets']({ extensionId: A }, [{ enableRulesetIds: ['main'] }]);
    expect(e.evaluate(req('https://tracker.example/'), { frameKeys: ['1:0'] }).cancel).toBe(true);
    const again = engine();
    again.load(A);
    expect(again.handlers()['declarativeNetRequest.getEnabledRulesets']({ extensionId: A }, [])).toEqual(['main']);
    expect(() => e.handlers()['declarativeNetRequest.updateEnabledRulesets']({ extensionId: A }, [{ enableRulesetIds: ['nope'] }])).toThrow(/Invalid ruleset/);
  });

  it('shows the blocked count as the badge when asked, and resets it on a new page', async () => {
    staticRules(A, [{ id: 1, action: { type: 'block' }, condition: { urlFilter: 'ad' } }]);
    const e = engine();
    e.load(A);
    await e.handlers()['declarativeNetRequest.setExtensionActionOptions']({ extensionId: A }, [{ displayActionCountAsBadgeText: true }]);
    e.evaluate(req('https://x.example/ad1.js'), { frameKeys: ['1:0'] });
    e.evaluate(req('https://x.example/ad2.js'), { frameKeys: ['1:0'] });
    expect(badges.at(-1)).toEqual([A, 1, '2']);
    const matched = e.handlers()['declarativeNetRequest.getMatchedRules']({ extensionId: A }, [{ tabId: 1 }]) as { rulesMatchedInfo: unknown[] };
    expect(matched.rulesMatchedInfo).toHaveLength(2);
    e.evaluate(req('https://next.example/', 'main_frame', null), { frameKeys: [], frameKey: '1:0' });
    expect(badges.at(-1)).toEqual([A, 1, '']);
  });

  it('collects header changes, applying the higher rule first', () => {
    staticRules(A, [
      { id: 1, priority: 2, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: 'high' }] }, condition: { urlFilter: '||h.example^' } },
      { id: 2, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: 'low' }], responseHeaders: [{ header: 'content-security-policy', operation: 'append', value: "worker-src 'none'" }] }, condition: { urlFilter: '||h.example^' } },
    ]);
    const e = engine();
    e.load(A);
    const d = e.evaluate(req('https://h.example/x'), { frameKeys: ['1:0'] });
    expect(d.headerRules.map((r) => r.id)).toEqual([1, 2]);
    expect(applyRequestHeaders({ 'User-Agent': 'orig', Accept: '*/*' }, d.headerRules)).toEqual({ 'User-Agent': 'high', Accept: '*/*' });
    expect(applyResponseHeaders({ 'Content-Security-Policy': ["default-src 'self'"] }, d.headerRules)).toEqual({ 'Content-Security-Policy': ["default-src 'self'", "worker-src 'none'"] });
  });
});

describe('redirect transforms', () => {
  it('rebuilds a URL piece by piece', () => {
    expect(transformUrl('http://a.example:8080/p?q=1#f', { scheme: 'https', port: '', path: '/new', fragment: '' })).toBe('https://a.example/new?q=1');
    expect(transformUrl('https://a.example/?a=1', { queryTransform: { addOrReplaceParams: [{ key: 'a', value: '2' }, { key: 'b', value: '3', replaceOnly: true }] } })).toBe('https://a.example/?a=2');
  });
});

describe('webRequest filters', () => {
  it('matches urls, types, tab and window', () => {
    const d = { url: 'https://a.example/x', type: 'script', tabId: 3, windowId: 1 };
    expect(requestFilterMatches({ urls: ['<all_urls>'] }, d)).toBe(true);
    expect(requestFilterMatches({ urls: ['*://b.example/*'] }, d)).toBe(false);
    expect(requestFilterMatches({ urls: ['<all_urls>'], types: ['image'] }, d)).toBe(false);
    expect(requestFilterMatches({ urls: ['<all_urls>'], tabId: 3 }, d)).toBe(true);
    expect(requestFilterMatches({}, d)).toBe(false);
  });
});
