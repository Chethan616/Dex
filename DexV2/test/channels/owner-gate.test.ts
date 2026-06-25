import { expect, test, describe } from 'vitest';
import { processOwnerGate, InboundMessage } from '../../src/channels/owner-gate.js';

describe('owner-gate channels gatekeeper', () => {
  test('rejects messages from non-owner', () => {
    const msg: InboundMessage = {
      senderId: 'someone_else',
      ownerId: 'owner_123',
      chatId: 'group_456',
      isGroup: true,
      text: '@dex hi'
    };
    const res = processOwnerGate(msg);
    expect(res.shouldRespond).toBe(false);
  });

  test('rejects messages from owner without @dex prefix', () => {
    const msg1: InboundMessage = {
      senderId: 'owner_123',
      ownerId: 'owner_123',
      chatId: 'owner_123',
      isGroup: false,
      text: 'hi'
    };
    const res1 = processOwnerGate(msg1);
    expect(res1.shouldRespond).toBe(false);

    const msg2: InboundMessage = {
      senderId: 'owner_123',
      ownerId: 'owner_123',
      chatId: 'owner_123',
      isGroup: false,
      text: 'dex hi'
    };
    const res2 = processOwnerGate(msg2);
    expect(res2.shouldRespond).toBe(false);
  });

  test('rejects @dexter prefix to avoid partial word match', () => {
    const msg: InboundMessage = {
      senderId: 'owner_123',
      ownerId: 'owner_123',
      chatId: 'owner_123',
      isGroup: false,
      text: '@dexter grab files'
    };
    const res = processOwnerGate(msg);
    expect(res.shouldRespond).toBe(false);
  });

  test('approves @dex messages and cleans prefix (case-insensitive)', () => {
    const msg1: InboundMessage = {
      senderId: 'owner_123',
      ownerId: 'owner_123',
      chatId: 'group_abc',
      isGroup: true,
      text: '@dex grab the file from computer'
    };
    const res1 = processOwnerGate(msg1);
    expect(res1.shouldRespond).toBe(true);
    expect(res1.cleanText).toBe('grab the file from computer');

    const msg2: InboundMessage = {
      senderId: 'owner_123',
      ownerId: 'owner_123',
      chatId: 'owner_123',
      isGroup: false,
      text: '@DEX      hi'
    };
    const res2 = processOwnerGate(msg2);
    expect(res2.shouldRespond).toBe(true);
    expect(res2.cleanText).toBe('hi');
  });

  test('handles multi-line messages starting with @dex', () => {
    const msg: InboundMessage = {
      senderId: 'owner_123',
      ownerId: 'owner_123',
      chatId: 'owner_123',
      isGroup: false,
      text: '@dex\nrun script:\nconst a = 1;'
    };
    const res = processOwnerGate(msg);
    expect(res.shouldRespond).toBe(true);
    expect(res.cleanText).toBe('run script:\nconst a = 1;');
  });
});
