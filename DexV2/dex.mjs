#!/usr/bin/env node

import { program } from 'commander';
import { startCommand } from './dist/cli/start.js';
import { chatCommand } from './dist/cli/chat.js';
import { initCommand } from './dist/cli/init.js';
import { stopCommand } from './dist/cli/stop.js';
import { restartCommand } from './dist/cli/restart.js';

program
  .name('dex')
  .description('Dex Agent CLI interface')
  .version('2.0.0');

program
  .command('init')
  .description('Registers and indexes all local applications for offline zero-token execution.')
  .action(async () => {
    try {
      await initCommand();
    } catch (err) {
      console.error('Error during initialization:', err);
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Boots the gateway server and owner gated channels in the background.')
  .action(async () => {
    try {
      await startCommand();
    } catch (err) {
      console.error('Error starting Dex daemon:', err);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop the background Dex gateway daemon.')
  .action(async () => {
    try {
      await stopCommand();
    } catch (err) {
      console.error('Error stopping Dex daemon:', err);
      process.exit(1);
    }
  });

program
  .command('end')
  .description('Stop the background Dex gateway daemon. (Alias of stop)')
  .action(async () => {
    try {
      await stopCommand();
    } catch (err) {
      console.error('Error stopping Dex daemon:', err);
      process.exit(1);
    }
  });

program
  .command('restart')
  .description('Restarts the background Dex gateway daemon.')
  .action(async () => {
    try {
      await restartCommand();
    } catch (err) {
      console.error('Error restarting Dex daemon:', err);
      process.exit(1);
    }
  });

program
  .command('chat <query>')
  .description('Submits a task query to the gateway and renders live steps.')
  .action(async (query) => {
    try {
      await chatCommand(query);
    } catch (err) {
      console.error('Error executing query:', err);
      process.exit(1);
    }
  });

program.parse(process.argv);
