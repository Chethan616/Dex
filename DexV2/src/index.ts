import { ensureAdmin } from './utils/elevate.js';
import { runMigrations } from './db/migrations.js';
import { logger } from './utils/logger.js';

const MODULE = 'BOOTSTRAP';

async function bootstrap() {
  logger.info(MODULE, 'Bootstrapping DexV2 Brain...');
  
  // 1. Native Administrator Elevation check
  ensureAdmin();
  logger.info(MODULE, 'Privilege verification: RUNNING AS ADMINISTRATOR.');

  // 2. Database schema migrations
  await runMigrations();
  
  logger.info(MODULE, 'DexV2 Brain successfully initialized.');
}

bootstrap().catch((err) => {
  logger.error(MODULE, 'Fatal error during bootstrapping:', err);
  process.exit(1);
});
