#!/usr/bin/env node

import { program } from 'commander';
import { startCommand } from './dist/cli/start.js';
import { chatCommand } from './dist/cli/chat.js';

program
  .name('dex')
  .description('Dex Agent CLI interface')
  .version('2.0.0');

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
