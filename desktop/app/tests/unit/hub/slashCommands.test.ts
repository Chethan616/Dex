/**
 * Slash-command expansion.
 *
 * The whole design rests on one property: a leading `/command` becomes a full
 * prompt before it reaches the engine, and everything else is passed through
 * untouched. The risk worth testing is the false positive — an ordinary
 * message that happens to start with a slash being silently rewritten.
 */
import { describe, expect, it } from 'vitest';
import { expandSlashCommand, matchingCommands, SLASH_COMMANDS } from '../../../src/renderer/hub/slashCommands';

describe('expandSlashCommand', () => {
  it('leaves an ordinary prompt untouched', () => {
    const raw = 'summarise the open issues on my repo';
    expect(expandSlashCommand(raw)).toEqual({ prompt: raw });
  });

  it('passes an unknown slash through rather than rewriting it', () => {
    // Could be a path, a regex, a deliberate literal — never ours to mangle.
    const raw = '/etc/hosts needs an entry for the portal';
    expect(expandSlashCommand(raw)).toEqual({ prompt: raw });
  });

  it('expands /scrape into a prompt naming the site and the skill', () => {
    const result = expandSlashCommand('/scrape vit.ac.in');
    expect(result.command?.name).toBe('scrape');
    expect(result.error).toBeUndefined();
    expect(result.prompt).toContain('vit.ac.in');
    expect(result.prompt).toContain('scrape.md');
    // Memory file named by bare host.
    expect(result.prompt).toContain('vit.ac.in.md');
  });

  // The bug from the field: "/scrape <site> and log me in with these
  // credentials" expanded to the site alone, silently dropping the login.
  // The regression from the field: "/scrape go to vtop.vit.ac.in and log in"
  // mapped a site called "go" because the target was the first word.
  it('picks the URL as the target, not the first word', () => {
    const result = expandSlashCommand('/scrape go to vtop.vit.ac.in and login as student');
    expect(result.prompt).toContain('vtop.vit.ac.in.md');
    expect(result.prompt).not.toContain('site map of go');
    expect(result.prompt).not.toContain('site map of GO');
    // The words around the URL survive as instructions.
    expect(result.prompt).toContain('go to');
    expect(result.prompt).toContain('login as student');
  });

  it('keeps instructions the user added after the target', () => {
    const result = expandSlashCommand('/scrape vtop.vit.ac.in and log in with user X pass Y');
    expect(result.prompt).toContain('vtop.vit.ac.in');
    expect(result.prompt).toContain('log in with user X pass Y');
    // The target is just the first token, so the memory file is still the host.
    expect(result.prompt).toContain('vtop.vit.ac.in.md');
    expect(result.prompt).not.toContain('and log in with user X pass Y.md');
  });

  it('works with no extra instructions', () => {
    const result = expandSlashCommand('/scrape vtop.vit.ac.in');
    expect(result.prompt).toContain('vtop.vit.ac.in');
    expect(result.prompt).not.toContain('The user also said');
  });

  it('names the memory file by host even when given a full URL with www', () => {
    const result = expandSlashCommand('/scrape https://www.vit.ac.in/academics');
    expect(result.prompt).toContain('vit.ac.in.md');
    expect(result.prompt).not.toContain('www.vit.ac.in.md');
  });

  it('refuses a command that needs an argument and did not get one', () => {
    const result = expandSlashCommand('/scrape');
    expect(result.error).toMatch(/needs a target/);
    // The prompt is returned unchanged so nothing half-formed is submitted.
    expect(result.prompt).toBe('/scrape');
  });

  it('is case-insensitive on the command word', () => {
    expect(expandSlashCommand('/Scrape example.com').command?.name).toBe('scrape');
  });

  // The safety-critical one: the assessment is exploit-focused (it validates
  // real vulnerability classes, not just headers), but it must still carry
  // its own authorization gate and its absolute safety boundaries — those
  // don't get relaxed just because the investigation itself got more active.
  it('expands /bugbounty into an authorization-gated, exploit-focused prompt with safety boundaries intact', () => {
    const result = expandSlashCommand('/bugbounty example.com');
    expect(result.command?.name).toBe('bugbounty');
    expect(result.prompt).toContain('bugbounty.md');
    expect(result.prompt).toContain('authorization check');
    // Exploit-focused: it should name concrete vulnerability classes, not
    // just describe itself as a passive header/hardening scan.
    expect(result.prompt).toMatch(/IDOR/i);
    expect(result.prompt).toMatch(/CSRF|XSS|injection/i);
    // A missing header must not be treated as a vulnerability on its own.
    expect(result.prompt).toMatch(/never itself a vulnerability|Informational/i);
    // The non-negotiable safety boundaries must still be stated explicitly.
    expect(result.prompt).toMatch(/non-destructive/i);
    expect(result.prompt).toMatch(/another real user/i);
  });

  it('every command points at a skill file the harness ships', () => {
    for (const command of SLASH_COMMANDS) {
      const prompt = command.expand('example.com');
      expect(prompt).toMatch(/\.\/dex-tools\/\w+\.md/);
    }
  });
});

describe('matchingCommands', () => {
  it('suggests commands by prefix while the word is being typed', () => {
    expect(matchingCommands('/s').map((c) => c.name)).toContain('scrape');
    expect(matchingCommands('/bug').map((c) => c.name)).toEqual(['bugbounty']);
  });

  it('lists everything for a bare slash', () => {
    expect(matchingCommands('/').length).toBe(SLASH_COMMANDS.length);
  });

  it('stops suggesting once the argument has started', () => {
    // A space means the command is chosen; the rest is its target.
    expect(matchingCommands('/scrape vit')).toEqual([]);
  });

  it('suggests nothing for a non-slash input', () => {
    expect(matchingCommands('scrape this')).toEqual([]);
  });
});
