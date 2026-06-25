import { Bot } from 'grammy';
import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { processOwnerGate } from './owner-gate.js';

const MODULE = 'CHANNEL_TELEGRAM';

export async function startTelegram(botToken: string, ownerTelegramId: string, gatewayUrl: string = 'ws://127.0.0.1:18789') {
  logger.info(MODULE, 'Starting Telegram channel...');
  
  const bot = new Bot(botToken);

  bot.on('message:text', async (ctx) => {
    const senderId = String(ctx.from.id);
    const chatId = String(ctx.chat.id);
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const text = ctx.message.text || '';

    const inbound = {
      senderId,
      ownerId: ownerTelegramId,
      chatId,
      isGroup,
      text
    };

    const gate = processOwnerGate(inbound);
    if (gate.shouldRespond && gate.cleanText) {
      logger.info(MODULE, `Accepted gated message from owner: "${gate.cleanText}" in chat ${chatId}`);
      
      forwardToGateway(gatewayUrl, gate.cleanText, chatId, async (reply) => {
        await ctx.reply(reply);
      });
    }
  });

  bot.start({
    onStart: (info) => {
      logger.info(MODULE, `Telegram bot @${info.username} started successfully!`);
    }
  });
}

function forwardToGateway(
  gatewayUrl: string, 
  text: string, 
  chatId: string, 
  onReply: (text: string) => Promise<void>
) {
  const ws = new WebSocket(gatewayUrl);
  
  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'query',
      text: text,
      context: { channel: 'telegram', chatId }
    }));
  });

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      if (payload.type === 'reply') {
        await onReply(payload.text);
        ws.close();
      } else if (payload.type === 'error') {
        await onReply(`[Dex Error] ${payload.error}`);
        ws.close();
      }
    } catch (err) {
      logger.error(MODULE, 'Error parsing gateway response:', err);
    }
  });

  ws.on('error', (err) => {
    logger.error(MODULE, `Gateway WebSocket error: ${err.message}`);
    onReply('[Dex error] Connection to brain gateway failed. Is Dex running?');
  });
}
