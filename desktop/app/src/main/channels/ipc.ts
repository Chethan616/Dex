import { ipcMain } from 'electron';
import { mainLogger } from '../logger';
import type { ChannelRouter } from './ChannelRouter';
import type { TelegramAdapter } from './TelegramAdapter';
import type { WhatsAppAdapter } from './WhatsAppAdapter';

const CH_WA_CONNECT = 'channels:whatsapp:connect';
const CH_WA_DISCONNECT = 'channels:whatsapp:disconnect';
const CH_WA_STATUS = 'channels:whatsapp:status';
const CH_WA_CLEAR_AUTH = 'channels:whatsapp:clear-auth';
const CH_TG_CONNECT = 'channels:telegram:connect';
const CH_TG_STATUS = 'channels:telegram:status';
const CH_TG_REMOVE = 'channels:telegram:remove';

export function registerChannelHandlers(
  _router: ChannelRouter,
  adapter: WhatsAppAdapter,
  telegram: TelegramAdapter,
): void {
  mainLogger.info('channels.ipc.register');

  ipcMain.handle(CH_WA_CONNECT, async () => {
    mainLogger.info('channels.whatsapp.connect');
    await adapter.connect();
    return { status: adapter.status };
  });

  ipcMain.handle(CH_WA_DISCONNECT, async () => {
    mainLogger.info('channels.whatsapp.disconnect');
    await adapter.disconnect();
    return { status: adapter.status };
  });

  ipcMain.handle(CH_WA_STATUS, () => {
    return {
      status: adapter.status,
      identity: adapter.getIdentity(),
    };
  });

  ipcMain.handle(CH_WA_CLEAR_AUTH, async () => {
    mainLogger.info('channels.whatsapp.clearAuth');
    await adapter.clearAuth();
    return { status: adapter.status };
  });

  // Telegram: the token goes in once, from Settings, and never comes back out.
  ipcMain.handle(CH_TG_CONNECT, async (_e, token: unknown) => {
    mainLogger.info('channels.telegram.connect');
    if (typeof token !== 'string' || token.length > 200) return { ok: false, error: 'Paste the token @BotFather sent you.' };
    try {
      return { ok: true, info: await telegram.connect(token) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(CH_TG_STATUS, () => telegram.info());

  ipcMain.handle(CH_TG_REMOVE, async () => {
    mainLogger.info('channels.telegram.remove');
    await telegram.remove();
    return telegram.info();
  });
}

export function unregisterChannelHandlers(): void {
  mainLogger.info('channels.ipc.unregister');
  ipcMain.removeHandler(CH_WA_CONNECT);
  ipcMain.removeHandler(CH_WA_DISCONNECT);
  ipcMain.removeHandler(CH_WA_STATUS);
  ipcMain.removeHandler(CH_WA_CLEAR_AUTH);
  ipcMain.removeHandler(CH_TG_CONNECT);
  ipcMain.removeHandler(CH_TG_STATUS);
  ipcMain.removeHandler(CH_TG_REMOVE);
}
