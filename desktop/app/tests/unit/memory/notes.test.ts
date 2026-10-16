/**
 * DEX's notes about the user: one fact each, kept across tasks and engines,
 * never a secret — and findable by the words in them, since an agent asked to
 * "forget where I study" has words, not an id.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { setMemoryDir } from '../../../src/main/memory/files';
import * as notes from '../../../src/main/memory/notes';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-notes-'));
  setMemoryDir(dir);
  notes._resetNotes();
});

const ok = (r: notes.NoteResult) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('notes', () => {
  it('keeps a fact across a restart, newest first', () => {
    ok(notes.addNote('Studies CSE at VIT Chennai', 'dex', { now: 1 }));
    ok(notes.addNote('Likes window seats', 'user', { now: 2 }));
    notes._resetNotes();
    expect(notes.listNotes().map((n) => [n.text, n.by])).toEqual([['Likes window seats', 'user'], ['Studies CSE at VIT Chennai', 'dex']]);
  });

  it('keeps the same fact once, however it is written', () => {
    const a = ok(notes.addNote('Call me Chet.', 'dex', { now: 1 }));
    const b = ok(notes.addNote('call me   chet', 'dex', { now: 5 }));
    expect(b.note.id).toBe(a.note.id);
    expect(notes.listNotes()).toHaveLength(1);
    expect(notes.listNotes()[0].at).toBe(5);
  });

  it('swaps an outdated fact for the new one', () => {
    const old = ok(notes.addNote('Lives in Hyderabad', 'dex'));
    const next = ok(notes.addNote('Lives in Bangalore now', 'dex', old.note.id));
    expect(next.replaced?.id).toBe(old.note.id);
    expect(notes.listNotes().map((n) => n.text)).toEqual(['Lives in Bangalore now']);
    // By words too.
    ok(notes.addNote('Lives in Chennai', 'dex', 'bangalore'));
    expect(notes.listNotes().map((n) => n.text)).toEqual(['Lives in Chennai']);
  });

  it('forgets by id or by words, and says which when several match', () => {
    const vit = ok(notes.addNote('Studies at VIT Chennai', 'dex')).note;
    ok(notes.addNote('Works at a startup in Chennai', 'dex'));
    const many = notes.forgetNote('chennai');
    expect('error' in many && many.error).toMatch(/Several notes match .*\[m[0-9a-f]{4}\]/);
    expect(notes.forgetNote('vit')).toMatchObject({ forgotten: { id: vit.id } });
    expect(notes.forgetNote(notes.listNotes()[0].id)).toHaveProperty('forgotten');
    expect(notes.listNotes()).toEqual([]);
    expect(notes.forgetNote('anything')).toHaveProperty('error');
  });

  it('refuses a password, a key or a card number, and keeps nothing of it', () => {
    for (const secret of [
      'My VTOP password is Hunter2!',
      'pin: 4321',
      'OpenAI key sk-abcdefghijklmnopqrstuvwx',
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'Card 4111 1111 1111 1111 expires 09/29',
    ]) {
      expect(notes.addNote(secret, 'dex')).toHaveProperty('error');
    }
    expect(notes.listNotes()).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'notes.json'))).toBe(false);
    // Ordinary facts that merely mention these words are fine.
    ok(notes.addNote('Phone number +91 98765 43210', 'user'));
    ok(notes.addNote('Pin code 600127', 'user'));
    ok(notes.addNote('Uses a password manager, so never suggest saving passwords in the browser', 'user'));
  });

  it('turns away an empty note and an essay', () => {
    expect(notes.addNote('   ', 'dex')).toHaveProperty('error');
    expect(notes.addNote('x'.repeat(notes.MAX_NOTE_CHARS + 1), 'dex')).toHaveProperty('error');
  });

  it('files each note under a topic, from its words or as told', () => {
    expect(ok(notes.addNote('Studies CSE at some university', 'dex')).note.topic).toBe('study');
    expect(ok(notes.addNote('Prefers window seats on flights', 'dex')).note.topic).toBe('travel');
    expect(ok(notes.addNote('Has a cat named Miso', 'dex', { topic: 'people' })).note.topic).toBe('people');
    expect(ok(notes.addNote('Something unclassifiable entirely', 'dex')).note.topic).toBe('other');
  });

  it('keeps an About-you answer as one note, replaced when answered again and cleared when emptied', () => {
    ok(notes.answerQuestion('city', 'Pune', { text: 'Lives in Pune', topic: 'home', core: true }) as notes.NoteResult);
    ok(notes.answerQuestion('city', 'Leeds, UK', { text: 'Lives in Leeds, UK', topic: 'home', core: true }) as notes.NoteResult);
    expect(notes.listNotes().map((n) => [n.text, n.qid, n.core])).toEqual([['Lives in Leeds, UK', 'city', true]]);
    expect(notes.getAnswers()).toEqual({ city: 'Leeds, UK' });
    // Forgetting the note in Settings forgets the answer too.
    notes.forgetNote(notes.listNotes()[0].id);
    expect(notes.getAnswers()).toEqual({});
    ok(notes.answerQuestion('city', 'Leeds', { text: 'Lives in Leeds', topic: 'home' }) as notes.NoteResult);
    expect(notes.answerQuestion('city', '', null)).toEqual({ cleared: true });
    expect(notes.listNotes()).toEqual([]);
  });

  it('imports facts from another assistant as the user’s own, leaving secrets out', () => {
    expect(notes.importFacts(['Works night shifts at a hospital', 'My password is hunter2', 'Has two dogs'])).toEqual({ saved: 2, skipped: 1 });
    expect(notes.listNotes().map((n) => n.by)).toEqual(['user', 'user']);
  });

  it('survives a hand-edited file with a broken entry', () => {
    fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ version: 1, notes: [{ id: 'm0001', text: 'Kept', at: 1, by: 'user' }, { text: 42 }] }));
    expect(notes.listNotes().map((n) => n.text)).toEqual(['Kept']);
  });
});
