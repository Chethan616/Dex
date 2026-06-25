import { expect, test, describe } from 'vitest';
import { encrypt, decrypt } from '../../src/utils/dpapi.js';

describe('dpapi cryptographic operations', () => {
  test('encrypt and decrypt roundtrip matches original string', () => {
    const plainText = 'super-secret-oauth-token-12345!@#';
    const cipherText = encrypt(plainText);
    expect(cipherText).toBeDefined();
    expect(cipherText).not.toBe(plainText);

    const decrypted = decrypt(cipherText);
    expect(decrypted).toBe(plainText);
  });

  test('can encrypt empty string or special characters', () => {
    const specialText = '{"access_token": "abc", "expires_in": 3600, "refresh_token": "xyz\n\t"}';
    const cipherText = encrypt(specialText);
    const decrypted = decrypt(cipherText);
    expect(decrypted).toBe(specialText);
  });
});
