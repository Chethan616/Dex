import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState 
} from '@whiskeysockets/baileys';
import WebSocket from 'ws';
import path from 'path';
import { getDexDir } from '../utils/platform.js';
import { logger } from '../utils/logger.js';
import { processOwnerGate } from './owner-gate.js';

const MODULE = 'CHANNEL_WHATSAPP';

export async function startWhatsApp(ownerPhone: string, gatewayUrl: string = 'ws://127.0.0.1:18789') {
  logger.info(MODULE, 'Starting WhatsApp channel...');
  
  const sessionDir = path.join(getDexDir(), 'sessions', 'whatsapp');
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  
  const initSocket = (makeWASocket as any).default || makeWASocket;
  const sock = initSocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update: any) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn(MODULE, `Connection closed. Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        startWhatsApp(ownerPhone, gatewayUrl);
      }
    } else if (connection === 'open') {
      logger.info(MODULE, 'WhatsApp connection opened successfully!');
    }
  });

  sock.ev.on('messages.upsert', async (m: any) => {
    if (m.type !== 'notify') return;
    for (const msg of m.messages) {
      if (!msg.message) continue;
      
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      const isGroup = remoteJid.endsWith('@g.us');
      const senderJid = isGroup ? msg.key.participant : remoteJid;
      if (!senderJid) continue;

      const senderPhone = senderJid.split('@')[0];
      const ownerPhoneClean = ownerPhone.split('@')[0];

      const text = msg.message.conversation || 
                   msg.message.extendedTextMessage?.text || 
                   '';

      const inbound = {
        senderId: senderPhone,
        ownerId: ownerPhoneClean,
        chatId: remoteJid,
        isGroup,
        text
      };

      const gate = processOwnerGate(inbound);
      if (gate.shouldRespond && gate.cleanText) {
        logger.info(MODULE, `Accepted gated message from owner: "${gate.cleanText}" in chat ${remoteJid}`);
        
        forwardToGateway(gatewayUrl, gate.cleanText, remoteJid, async (reply) => {
          await sock.sendMessage(remoteJid, { text: reply });
        });
      }
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
      context: { channel: 'whatsapp', chatId }
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
