import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../../core/orchestrator/registry';
import { AgentContext, AgentResult } from '../../core/events/types';
import { delivery } from '../../core/delivery/registry';
import { profilePath } from '../files/profile_paths';

/**
 * Sending something back to the conversation the request came from.
 *
 * This is the second half of "download that zip and send it to me on
 * WhatsApp", and the reason it is an agent rather than a line in the channel
 * code: the plan decides *when* to deliver, and the plan is built before
 * anyone knows there will be a file.
 *
 * The rule it enforces, which is the whole reason to have it:
 *
 *   **A file goes to the conversation that asked for it, and nowhere else.**
 *
 * Not "the owner's WhatsApp" — the chat this request arrived in. Dex has one
 * owner and several open conversations, and a plan that says "send it to me"
 * must not be free to pick. The target is looked up by request id, registered
 * by the channel on the way in, and there is no way from here to address a
 * conversation that did not ask.
 */

/** Chat services reject large uploads; better to say so than to fail at the API. */
const MAX_UPLOAD_BYTES = 90 * 1024 * 1024;

export class DeliveryAgent implements Agent {
  name = 'DeliveryAgent';
  capabilities = ['can_deliver'];

  async execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    _stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    try {
      const signal = ctx?.signal?.();
      if (signal && !signal.shouldContinue) {
        return { success: false, error: signal.message, retryable: false };
      }

      switch (action) {
        case 'send_file':
          return await this.sendFile(params, requestId, ctx);
        case 'send_message':
          return await this.sendMessage(params, requestId);
        default:
          return {
            success: false,
            error: `DeliveryAgent: unknown action "${action}"`,
            retryable: false,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        retryable: false,
      };
    }
  }

  private async sendFile(
    params: Record<string, unknown>,
    requestId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    const file = profilePath(String(params.path ?? ''), true);
    const stat = fs.statSync(file);

    if (stat.isDirectory()) {
      return {
        success: false,
        error: `${file} is a folder. Compress it first, then send the archive.`,
        retryable: false,
      };
    }
    if (stat.size > MAX_UPLOAD_BYTES) {
      return {
        success: false,
        error:
          `${path.basename(file)} is ${mb(stat.size)}, above the ${mb(MAX_UPLOAD_BYTES)} ` +
          'chat services accept. The file is on this machine at ' + file,
        retryable: false,
      };
    }

    const target = delivery.get(requestId);
    const caption = String(params.caption ?? '') || path.basename(file);

    // No channel: this came from the desktop app or the CLI. Reporting where
    // the file is, is the truthful answer — the owner is at the machine it is
    // already on. Claiming to have sent it would be a lie, and failing would
    // be unhelpful when the task did in fact produce the file.
    if (!target) {
      return {
        success: true,
        data: {
          delivered: false,
          reason: 'this request did not come from a chat, so there is nowhere to send it',
          path: file,
          name: path.basename(file),
          size: mb(stat.size),
        },
      };
    }

    if (!target.sendFile) {
      await target.send(
        `${caption} is ready, but ${target.source} cannot receive files. ` +
          `It is on your PC at ${file}`,
      );
      return {
        success: true,
        data: {
          delivered: false,
          reason: `${target.source} cannot send files`,
          path: file,
        },
      };
    }

    ctx?.report?.(`Sending ${path.basename(file)} to ${target.source}…`);
    await target.sendFile(file, caption);

    return {
      success: true,
      data: {
        delivered: true,
        to: target.source,
        name: path.basename(file),
        size: mb(stat.size),
        path: file,
      },
    };
  }

  private async sendMessage(
    params: Record<string, unknown>,
    requestId: string,
  ): Promise<AgentResult> {
    const text = String(params.text ?? '').trim();
    if (!text) return { success: false, error: 'send_message needs text', retryable: false };

    const target = delivery.get(requestId);
    if (!target) {
      return {
        success: true,
        data: { delivered: false, reason: 'no chat to reply to', text },
      };
    }

    await target.send(text);
    return { success: true, data: { delivered: true, to: target.source } };
  }
}

function mb(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
