// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN, maskSecretFields, READS_PAGE, redactSecrets, secretValues } from '../../../src/main/workspace/secretFields';

/** A tab whose isolated world is this jsdom page: the scripts really run. */
function pageTab() {
  const worlds: number[] = [];
  return {
    worlds,
    wc: {
      isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: async (world: number, scripts: Array<{ code: string }>) => {
        worlds.push(world);
        // eslint-disable-next-line no-eval
        return (0, eval)(scripts[0].code);
      },
    },
  };
}

function field(html: string, value: string): HTMLInputElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const input = wrap.firstElementChild as HTMLInputElement;
  input.value = value;
  document.body.appendChild(input);
  return input;
}

describe('secret fields', () => {
  afterEach(() => { document.body.innerHTML = ''; delete (globalThis as { __dexMasked?: unknown }).__dexMasked; });

  it('reads the values of password, code and card fields — not the email or search box', async () => {
    field('<input type="password">', 'hunter22');
    field('<input type="text" autocomplete="cc-number">', '4242424242424242');
    field('<input type="text" name="user_pwd">', 'shown-pass');
    field('<input type="email" name="email">', 'me@example.com');
    field('<input type="search" id="q">', 'passport photo size');
    field('<input type="password">', 'ab');
    const { wc, worlds } = pageTab();
    expect(await secretValues(wc)).toEqual(['hunter22', '4242424242424242', 'shown-pass']);
    expect(worlds[0]).toBeGreaterThan(1000);
  });

  it('draws shown passwords and card numbers as dots for a screenshot, then puts them back', async () => {
    // jsdom drops -webkit-text-security, so watch the style calls themselves.
    const set = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
    const removed = vi.spyOn(CSSStyleDeclaration.prototype, 'removeProperty');
    field('<input type="text" autocomplete="cc-number">', '4242424242424242');
    field('<input type="text" autocomplete="current-password">', 'hunter22');
    field('<input type="password">', 'drawn-as-dots-already');
    field('<input type="email">', 'me@example.com');
    const { wc } = pageTab();
    await maskSecretFields(wc, true);
    expect(set.mock.calls).toEqual([
      ['-webkit-text-security', 'disc', 'important'],
      ['-webkit-text-security', 'disc', 'important'],
    ]);
    await maskSecretFields(wc, true);
    expect(set).toHaveBeenCalledTimes(2);
    await maskSecretFields(wc, false);
    expect(removed.mock.calls).toEqual([['-webkit-text-security'], ['-webkit-text-security']]);
    set.mockRestore();
    removed.mockRestore();
  });

  it('never throws on a page that is going away', async () => {
    const wc = { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async () => { throw new Error('navigated'); } };
    await expect(maskSecretFields(wc, true)).resolves.toBeUndefined();
    await expect(secretValues(wc)).resolves.toEqual([]);
    expect(await secretValues({ isDestroyed: () => true, executeJavaScriptInIsolatedWorld: async () => ['x'] })).toEqual([]);
  });

  it('hides secret values in what the agent reads back, leaving the rest as it was', () => {
    const reply = {
      result: { type: 'object', value: { email: 'me@example.com', password: 'hunter22', note: 'pw is hunter22!' } },
      nodes: [{ name: { value: 'Card' }, value: { value: '4242424242424242' } }, { role: 'button' }],
    };
    const { value, hits } = redactSecrets(reply, ['hunter22', '4242424242424242']);
    expect(hits).toBe(3);
    const out = value as typeof reply;
    expect(out.result.value).toEqual({ email: 'me@example.com', password: HIDDEN, note: `pw is ${HIDDEN}!` });
    expect(out.nodes[0].value).toEqual({ value: HIDDEN });
    expect(out.nodes[1]).toBe(reply.nodes[1]);
    expect(reply.result.value.password).toBe('hunter22');

    const plain = { result: { type: 'string', value: 'Example Domain' } };
    expect(redactSecrets(plain, ['hunter22']).value).toBe(plain);
    expect(redactSecrets(plain, []).value).toBe(plain);
  });

  it('checks what reads the page, not screenshots or input', () => {
    expect(READS_PAGE.has('Runtime.evaluate')).toBe(true);
    expect(READS_PAGE.has('Accessibility.getFullAXTree')).toBe(true);
    expect(READS_PAGE.has('Page.captureScreenshot')).toBe(false);
    expect(READS_PAGE.has('Input.dispatchKeyEvent')).toBe(false);
  });
});
