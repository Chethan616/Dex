/**
 * `electronAPI.memory` — DEX's memory (main/memory/ipc.ts), for the hub's
 * Settings and for onboarding's "Let DEX get to know you", which share the
 * same questions.
 */
import { ipcRenderer } from 'electron';

export function memoryBridge() {
  return {
    list: (): Promise<unknown> => ipcRenderer.invoke('memory:list'),
    addNote: (text: string): Promise<unknown> => ipcRenderer.invoke('memory:add-note', text),
    forgetNote: (id: string): Promise<unknown> => ipcRenderer.invoke('memory:forget-note', id),
    forgetSite: (host: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('memory:forget-site', host),
    answers: (): Promise<Record<string, string>> => ipcRenderer.invoke('memory:answers'),
    answer: (qid: string, value: string): Promise<unknown> => ipcRenderer.invoke('memory:answer', qid, value),
    parseImport: (raw: string): Promise<{ facts: string[]; skipped: number }> => ipcRenderer.invoke('memory:parse-import', raw),
    importFacts: (facts: string[]): Promise<{ saved: number; skipped: number }> => ipcRenderer.invoke('memory:import', facts),
    openAssistant: (which: 'chatgpt' | 'claude'): Promise<{ opened: boolean }> => ipcRenderer.invoke('memory:open-assistant', which),
    graph: (): Promise<unknown> => ipcRenderer.invoke('memory:graph'),
    index: (opts?: { useModel?: boolean }): Promise<unknown> => ipcRenderer.invoke('memory:index', opts ?? {}),
    onChange: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('memory:changed', handler);
      return () => ipcRenderer.removeListener('memory:changed', handler);
    },
  };
}
