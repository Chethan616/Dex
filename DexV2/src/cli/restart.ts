import { stopCommand } from './stop.js';
import { startCommand } from './start.js';

export async function restartCommand() {
  console.log('Restarting Dex gateway daemon...');
  await stopCommand();
  
  // Wait 1.5 seconds to let the socket release the port completely
  await new Promise((resolve) => setTimeout(resolve, 1500));
  
  await startCommand();
}
