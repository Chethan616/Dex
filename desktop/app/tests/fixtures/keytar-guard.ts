/**
 * No test ever reaches the real OS credential store.
 *
 * The stores load keytar with a plain `require('keytar')` (it's a native
 * module, kept out of the bundle), and `vi.mock('keytar')` only intercepts
 * imports — so tests that "mocked" it were writing to the developer's real
 * keychain. One run replaced the owner's saved sites with test fixtures.
 *
 * Every `require('keytar')` under vitest gets this in-memory one instead, a
 * fresh one per test file. Tests read and seed it through `testKeytar()`.
 */
import Module from 'node:module';

const store = new Map<string, string>();
const key = (service: string, account: string): string => `${service}:${account}`;

const fake = {
  getPassword: async (service: string, account: string) => store.get(key(service, account)) ?? null,
  setPassword: async (service: string, account: string, password: string) => { store.set(key(service, account), password); },
  deletePassword: async (service: string, account: string) => store.delete(key(service, account)),
  findCredentials: async (service: string) => [...store]
    .filter(([k]) => k.startsWith(`${service}:`))
    .map(([k, password]) => ({ account: k.slice(service.length + 1), password })),
  findPassword: async (service: string) => [...store].find(([k]) => k.startsWith(`${service}:`))?.[1] ?? null,
};

(globalThis as { __dexTestKeytar?: { store: Map<string, string>; fake: typeof fake } }).__dexTestKeytar = { store, fake };

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = M._load;
M._load = function guardedLoad(this: unknown, request: string, ...rest: unknown[]) {
  if (request === 'keytar') return fake;
  return load.call(this, request, ...rest);
};
