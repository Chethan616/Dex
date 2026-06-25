import { expect, test, describe } from 'vitest';
import { TaskIntent } from '../../src/brain/types.js';
import { classifyClusterByRules, classifyCluster, getRelevantTools } from '../../src/tools/intent-router.js';

describe('intent router', () => {
  describe('rule-based routing', () => {
    test('routes messaging queries correctly', () => {
      expect(classifyClusterByRules('send a message to mom on whatsapp')).toBe('messaging-wa');
      expect(classifyClusterByRules('tg ping CEO')).toBe('messaging-tg');
      expect(classifyClusterByRules('slack check channel general')).toBe('messaging-slack');
      expect(classifyClusterByRules('teams say hello')).toBe('messaging-teams');
      expect(classifyClusterByRules('post to discord channel')).toBe('messaging-discord');
    });

    test('routes workspace queries correctly', () => {
      expect(classifyClusterByRules('check email inbox')).toBe('email');
      expect(classifyClusterByRules('schedule meeting for tomorrow')).toBe('calendar');
      expect(classifyClusterByRules('create a google doc')).toBe('docs');
      expect(classifyClusterByRules('update google sheet cell')).toBe('sheets');
    });

    test('routes database and dev ops queries correctly', () => {
      expect(classifyClusterByRules('git push origin branch')).toBe('vcs/git');
      expect(classifyClusterByRules('query sqlite table')).toBe('database');
    });

    test('routes desktop script authoring requests away from the code sandbox', () => {
      expect(classifyClusterByRules('write a py program in notepad save it in downloads and run it in cmd')).toBe('gui-automation');
      expect(classifyClusterByRules('open web')).toBe('web-browsing');
      expect(classifyClusterByRules('draw a circle in paint')).toBe('gui-automation');
      expect(classifyClusterByRules('disable wifi adapter')).toBe('system-config');
    });
  });

  describe('semantic routing fallback', () => {
    test('routes queries to closest semantic clusters', async () => {
      // These queries do not match any rules directly, but should fall back to semantic centroids
      const cluster1 = await classifyCluster('where is my files');
      expect(cluster1).toBe('file-ops');

      const cluster2 = await classifyCluster('is the player paused');
      expect(cluster2).toBe('productivity-spotify');
    });
  });

  describe('getRelevantTools', () => {
    test('retrieves tools and handles voice/notify injection', async () => {
      const intent: TaskIntent = {
        raw: 'notify me when git status is clean',
        normalized: 'notify me when git status is clean',
        kind: 'single-shot',
        tier: 1
      };

      const tools = await getRelevantTools(intent);
      // git cluster is ['git', 'exec'], notify should be appended, total 3 tools
      const names = tools.map(t => t.name);
      expect(names).toContain('git');
      expect(names).toContain('exec');
      expect(names).toContain('notify');
      expect(names.length).toBeLessThanOrEqual(5);
    });

    test('does not exceed 5 tools', async () => {
      // If a cluster has 3 tools, and we ask for notify and voice
      const intent: TaskIntent = {
        raw: 'tell me and speak to notify: check website in chrome',
        normalized: 'tell me and speak to notify: check website in chrome',
        kind: 'single-shot',
        tier: 1
      };
      
      const tools = await getRelevantTools(intent);
      expect(tools.length).toBeLessThanOrEqual(5);
    });

    test('falls back to browser automation for workspace tasks without native connectors', async () => {
      const intent: TaskIntent = {
        raw: 'send this file by email',
        normalized: 'send this file by email',
        kind: 'single-shot',
        tier: 1
      };

      const tools = await getRelevantTools(intent);
      const names = tools.map(t => t.name);
      expect(names).toContain('browser');
      expect(names).toContain('exec');
      expect(names).not.toContain('gmail');
    });
  });
});
