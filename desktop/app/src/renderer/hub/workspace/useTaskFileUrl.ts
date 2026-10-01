/**
 * A blob: URL for a file this task recorded (a screenshot, a picture it
 * made), read through `sessions.readFile` — the hub can't load file:// URLs,
 * and main only hands over files the task itself produced.
 */
import { useEffect, useState } from 'react';
import { mimeFor } from './docs/kinds';

export function useTaskFileUrl(sessionId: string, path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const api = window.electronAPI?.sessions;
    setUrl(null);
    if (!api?.readFile || !path) return;
    let live = true;
    let made: string | null = null;
    api.readFile(sessionId, path)
      .then(({ bytes }) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes.slice()], { type: mimeFor(path) }));
        setUrl(made);
      })
      .catch(() => { /* not shown */ });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [sessionId, path]);
  return url;
}
