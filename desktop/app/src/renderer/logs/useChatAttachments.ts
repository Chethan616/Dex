/**
 * Files for the chat's follow-up box: picked, dropped on the window, or
 * pasted (a screenshot straight from the clipboard). Same limits as the
 * hub's task input (shared/attachments.ts) so the engine never gets a file
 * it would reject.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  classifyAttachmentMime,
  formatBytes,
  maxBytesForAttachmentMime,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from '../../shared/attachments';

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** Object URL for an image preview; revoked when the chip goes. */
  preview?: string;
}

/** Guess a MIME type when the OS doesn't give one (common for .md, .csv…). */
function mimeFor(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ({
    md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

export function useChatAttachments() {
  const [items, setItems] = useState<ChatAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Previews are object URLs: free them when the window goes away.
  useEffect(() => () => itemsRef.current.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)), []);

  const add = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const next = [...itemsRef.current];
    let total = next.reduce((s, a) => s + a.bytes.byteLength, 0);
    for (const file of Array.from(files)) {
      if (next.length >= MAX_ATTACHMENTS_PER_MESSAGE) { setError(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`); break; }
      const mime = mimeFor(file);
      const max = maxBytesForAttachmentMime(mime);
      if (file.size === 0) { setError(`${file.name} is empty.`); continue; }
      if (file.size > max) { setError(`${file.name} is ${formatBytes(file.size)} — the limit for ${classifyAttachmentMime(mime)} files is ${formatBytes(max)}.`); continue; }
      if (total + file.size > MAX_TOTAL_ATTACHMENT_BYTES) { setError(`That would be more than ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} in one message.`); break; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const name = file.name || `pasted-${Date.now()}.${mime.split('/')[1] ?? 'bin'}`;
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        mime,
        bytes,
        preview: mime.startsWith('image/') ? URL.createObjectURL(new Blob([bytes], { type: mime })) : undefined,
      });
      total += file.size;
    }
    setItems(next);
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    itemsRef.current.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    setItems([]);
    setError(null);
  }, []);

  return { items, error, add, remove, clear };
}
