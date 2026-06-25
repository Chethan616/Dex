import { Client, GatewayIntentBits } from 'discord.js';
import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { processOwnerGate } from './owner-gate.js';

const MODULE = 'CHANNEL_DISCORD';

export async function startDiscord(botToken: string, ownerDiscordId: string, gatewayUrl: string = 'ws://127.0.0.1:18789') {
  logger.info(MODULE, 'Starting Discord channel...');
  
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ]
  });

  client.on('ready', () => {
    logger.info(MODULE, `Discord bot logged in as ${client.user?.tag} successfully!`);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const senderId = message.author.id;
    const chatId = message.channel.id;
    const isGroup = message.guild !== null;
    const text = message.content || '';

    const inbound = {
      senderId,
      ownerId: ownerDiscordId,
      chatId,
      isGroup,
      text
    };

    const gate = processOwnerGate(inbound);
    if (gate.shouldRespond && gate.cleanText) {
      logger.info(MODULE, `Accepted gated message from owner: "${gate.cleanText}" in chat ${chatId}`);
      
      forwardToGateway(gatewayUrl, gate.cleanText, chatId, async (reply) => {
        await message.channel.send(reply);
      });
    }
  });

  await client.login(botToken);
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
      context: { channel: 'discord', chatId }
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
