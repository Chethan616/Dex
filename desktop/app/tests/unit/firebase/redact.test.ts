import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../../src/main/firebase/redact';

describe('redactSecrets — nothing secret reaches the phone bridge', () => {
  it.each([
    ['anthropic key', 'export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'],
    ['openai key', 'using sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX1234'],
    ['google api key', 'key=AIzaSyA1234567890abcdefghijklmnopqrstu'],
    ['google access token', 'Authorization: Bearer ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxx'],
    ['github token', 'git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/x/y'],
    ['slack token', 'SLACK_BOT_TOKEN xoxb-1234567890-abcdefghijkl'],
    ['aws key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['jwt', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ])('masks a %s', (_name, input) => {
    const out = redactSecrets(input)!;
    expect(out).toContain('••••••');
    expect(out).not.toMatch(/sk-(ant|proj)|AIza|ya29\.|ghp_|xoxb-|AKIA|eyJhbGci/);
  });

  it('masks the value of fields named like secrets, keeping the name', () => {
    const out = redactSecrets('{"password": "hunter22", "apiKey": "abcd1234", "user": "chethan"}')!;
    expect(out).toContain('"password": "••••••"');
    expect(out).toContain('"apiKey": "••••••"');
    expect(out).toContain('"user": "chethan"');
  });

  it('masks private key blocks', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
    expect(redactSecrets(pem)).toBe('••••••');
  });

  it('leaves ordinary text alone', () => {
    const text = 'Searched the web for "best laptops 2026" and found 12 results.';
    expect(redactSecrets(text)).toBe(text);
  });
});
