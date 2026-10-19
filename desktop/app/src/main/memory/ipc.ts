/**
 * What the hub and onboarding ask of DEX's memory: Settings › Memory (list,
 * add, forget), About you (the questions' answers), and the import from
 * another assistant. Registered early, with the other handlers onboarding
 * uses. Sites come without their passwords, as everywhere else.
 */
import { BrowserWindow, ipcMain, shell } from 'electron';
import { questionById } from '../../shared/aboutYou';
import { parseImported } from '../../shared/memoryTopics';
import { mainLogger } from '../logger';
import { memoryEvents } from './files';
import * as notes from './notes';
import * as sites from './siteStore';

const str = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('bad argument');
  return v;
};

/** The two places a user would ask what they've told before. */
const ASSISTANTS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
};

export function registerMemoryIpc(): void {
  ipcMain.handle('memory:list', async () => ({ notes: notes.listNotes(), sites: await sites.listSites() }));
  ipcMain.handle('memory:add-note', (_e, text: unknown) => notes.addNote(str(text, 2000), 'user'));
  ipcMain.handle('memory:forget-note', (_e, id: unknown) => notes.forgetNote(str(id, 40)));
  ipcMain.handle('memory:forget-site', async (_e, host: unknown) => {
    await sites.forgetSite(str(host, 300));
    return { ok: true };
  });

  ipcMain.handle('memory:answers', () => notes.getAnswers());
  ipcMain.handle('memory:answer', async (_e, qid: unknown, value: unknown) => {
    const q = questionById(str(qid, 40));
    if (!q) throw new Error('no such question');
    const answer = str(value, 600).trim();
    const result = notes.answerQuestion(q.id, answer, answer ? { text: q.note(answer), topic: q.topic, core: q.core } : null);
    // A portal or site they named: kept as a site too, under the words people use for it.
    if (answer && q.siteAliases && !('error' in result) && /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(answer.replace(/^https?:\/\//i, ''))) {
      await sites.rememberSite(/^https?:\/\//i.test(answer) ? answer : `https://${answer}`, q.siteAliases).catch((err) => {
        mainLogger.warn('memory.answer.site.failed', { error: (err as Error).message });
      });
    }
    return result;
  });

  ipcMain.handle('memory:parse-import', (_e, raw: unknown) => parseImported(str(raw, 100_000)));
  ipcMain.handle('memory:import', (_e, facts: unknown) => {
    const list = Array.isArray(facts) ? facts.filter((f): f is string => typeof f === 'string').slice(0, 300) : [];
    const result = notes.importFacts(list);
    mainLogger.info('memory.imported', result);
    return result;
  });
  ipcMain.handle('memory:open-assistant', async (_e, which: unknown) => {
    const url = ASSISTANTS[str(which, 20)];
    if (!url) return { opened: false };
    await shell.openExternal(url);
    return { opened: true };
  });

  // The memory graph (memory/graph.ts): read it, or build it now.
  ipcMain.handle('memory:graph', async () => {
    const { readGraph, isIndexing } = await import('./graph');
    const { hashNotes } = await import('../../shared/memoryGraph');
    const g = readGraph();
    const all = notes.listNotes();
    return { graph: g, indexing: isIndexing(), stale: g ? g.noteHash !== hashNotes(all) : all.length > 0, noteCount: all.length };
  });
  ipcMain.handle('memory:index', async (_e, opts: unknown) => {
    const { indexMemory } = await import('./graph');
    const useModel = !(opts && typeof opts === 'object' && (opts as { useModel?: unknown }).useModel === false);
    try {
      return { graph: await indexMemory(notes.listNotes(), { useModel }) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  memoryEvents.on('changed', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('memory:changed');
    }
  });
}
