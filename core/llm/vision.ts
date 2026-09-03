/**
 * Asking a model what is in a picture.
 *
 * Separate from `LlmProvider` on purpose. That interface does exactly one
 * thing — hand over a tool schema and get structured arguments back — and it
 * is narrow because narrow is what makes swapping providers a config change.
 * Describing an image is the opposite shape: free text in, free text out, and
 * only some providers can do it at all. Widening `callTool` to carry images
 * would put an optional field on every provider for the benefit of one.
 *
 * The route is the Claude Code CLI's streaming input. `--print` takes a prompt
 * as an argument and an argument cannot carry a megabyte of PNG; but
 * `--input-format stream-json` reads Anthropic message blocks on stdin, and
 * those take base64 images the same way the API does.
 *
 * What this is for: "explain this image", "what does this say", "read the
 * error in this screenshot". A file search that finds `UI.png` and stops is
 * only half of what was asked when the owner said "find it and explain it".
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { resolveCommand } from '../settings/which';
import { Cancelled } from './provider';
import { cliEnvironment } from './providers';

/** What the CLI will accept, by extension. */
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Five megabytes.
 *
 * Above this the base64 alone is seven megabytes of stdin, and the answer is
 * no better: a model reading a screenshot does not need the original at full
 * resolution. Refusing with the size is more useful than a truncated image.
 */
const MAX_BYTES = 5 * 1024 * 1024;

const TIMEOUT_MS = 120_000;

export function canDescribe(file: string): boolean {
  return path.extname(file).toLowerCase() in MEDIA_TYPES;
}

export interface Described {
  description: string;
  model: string;
  bytes: number;
}

/**
 * Describe an image with the Claude Code CLI.
 *
 * `question` is what the owner actually asked, passed through rather than
 * replaced by a generic "describe this image". "What is the error in this
 * screenshot" and "what colours are in this mockup" want very different
 * answers about the same file.
 */
export function describeImage(
  file: string,
  question: string,
  { model = 'sonnet', cliPath = 'claude', signal }: {
    model?: string;
    cliPath?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Described> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Cancelled());
      return;
    }

    const extension = path.extname(file).toLowerCase();
    const mediaType = MEDIA_TYPES[extension];
    if (!mediaType) {
      reject(new Error(
        `${extension || 'that file'} is not an image this can read — ` +
        `it handles ${Object.keys(MEDIA_TYPES).join(', ')}`,
      ));
      return;
    }

    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(file);
    } catch (err) {
      reject(new Error(`Could not read ${file}: ${err instanceof Error ? err.message : err}`));
      return;
    }
    if (bytes.byteLength > MAX_BYTES) {
      reject(new Error(
        `${path.basename(file)} is ${Math.round(bytes.byteLength / 1024 / 1024)} MB, ` +
        `over the ${MAX_BYTES / 1024 / 1024} MB limit for describing an image`,
      ));
      return;
    }

    const invocation = resolveCommand(cliPath, [
      '--print',
      // Both, together. The CLI refuses `--input-format=stream-json` without
      // it: "requires output-format=stream-json". So streaming the image in
      // means parsing an event stream on the way out, which is what
      // `lastAssistantText` below is for.
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', model,
      // No tools. The model is looking at a picture, not working on the
      // machine, and this is the property that makes that true.
      '--allowedTools', '',
    ]);
    if (!invocation) {
      reject(new Error(`Could not find the Claude Code CLI (${cliPath})`));
      return;
    }

    const child = spawn(invocation.file, invocation.args, {
      windowsHide: true,
      env: cliEnvironment(),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(
        `Describing ${path.basename(file)} took longer than ${TIMEOUT_MS / 1000}s`,
      )));
    }, TIMEOUT_MS);

    const onAbort = (): void => {
      child.kill();
      finish(() => reject(new Cancelled()));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });

    child.on('error', (err) => finish(() => reject(err)));

    child.on('close', (code) => finish(() => {
      if (code !== 0) {
        reject(new Error(
          `${cliPath} exited ${code}${stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ''}`,
        ));
        return;
      }
      const text = lastAssistantText(stdout);
      if (!text) {
        reject(new Error(
          `The model returned nothing about the image${stderr.trim() ? `: ${stderr.trim().slice(-200)}` : ''}`,
        ));
        return;
      }
      resolve({ description: text, model, bytes: bytes.byteLength });
    }));

    // One user message: the picture, then the question. Image first, because
    // the question is usually about what is in it and reads better after.
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: bytes.toString('base64'),
            },
          },
          { type: 'text', text: question },
        ],
      },
    };

    child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}


/**
 * The answer, pulled out of the CLI's event stream.
 *
 * `--output-format stream-json` emits one JSON object per line: a `system`
 * init line, `assistant` lines carrying content blocks, and a final `result`.
 * The `result` line is the one to want; the assistant lines are the fallback
 * for a stream that ended without one, which is better than reporting that
 * nothing came back when the text is sitting in the output.
 */
export function lastAssistantText(stream: string): string {
  let fromResult = '';
  const fromAssistant: string[] = [];

  for (const line of stream.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (event.type === 'result' && typeof event.result === 'string') {
      fromResult = event.result;
      continue;
    }

    if (event.type === 'assistant') {
      const message = event.message as { content?: unknown } | undefined;
      const blocks = Array.isArray(message?.content) ? message.content : [];
      for (const block of blocks) {
        const part = block as { type?: unknown; text?: unknown };
        if (part.type === 'text' && typeof part.text === 'string') {
          fromAssistant.push(part.text);
        }
      }
    }
  }

  return (fromResult || fromAssistant.join('')).trim();
}
