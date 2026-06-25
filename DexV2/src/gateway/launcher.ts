import { ensureAdmin } from '../utils/elevate.js';
import { runMigrations } from '../db/migrations.js';
import { logger } from '../utils/logger.js';
import { GatewayServer } from './server.js';
import { startWhatsApp } from '../channels/whatsapp.js';
import { startTelegram } from '../channels/telegram.js';
import { startDiscord } from '../channels/discord.js';

const MODULE = 'LAUNCHER';

async function main() {
  logger.info(MODULE, 'Bootstrapping Dex V2 Daemon Launcher...');
  
  // 1. Enforce admin privileges
  ensureAdmin();
  logger.info(MODULE, 'Verified Administrative Privileges.');

  // 2. Perform DB schema migrations
  await runMigrations();
  logger.info(MODULE, 'Database migrations completed.');

  // 3. Bind WebSocket gateway server
  const server = new GatewayServer(18789);
  await server.start();
  logger.info(MODULE, 'Gateway Server initialized on port 18789.');

  // 4. Load owner-gated adapters conditionally
  if (process.env.WHATSAPP_OWNER_PHONE) {
    logger.info(MODULE, 'WHATSAPP_OWNER_PHONE detected. Initializing WhatsApp adapter...');
    startWhatsApp(process.env.WHATSAPP_OWNER_PHONE).catch(err => {
      logger.error(MODULE, 'WhatsApp channel failed to start:', err);
    });
  }

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_ID) {
    logger.info(MODULE, 'TELEGRAM_BOT_TOKEN and OWNER detected. Initializing Telegram adapter...');
    startTelegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_OWNER_ID).catch(err => {
      logger.error(MODULE, 'Telegram channel failed to start:', err);
    });
  }

  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_OWNER_ID) {
    logger.info(MODULE, 'DISCORD_BOT_TOKEN and OWNER detected. Initializing Discord adapter...');
    startDiscord(process.env.DISCORD_BOT_TOKEN, process.env.DISCORD_OWNER_ID).catch(err => {
      logger.error(MODULE, 'Discord channel failed to start:', err);
    });
  }

  logger.info(MODULE, 'Launcher fully running. Awaiting connections.');
}

main().catch((err) => {
  logger.error(MODULE, 'Fatal error in Launcher bootstrap:', err);
  process.exit(1);
});
