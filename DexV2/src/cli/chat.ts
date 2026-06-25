import WebSocket from 'ws';
import readline from 'readline';
import { StepEvent } from '../brain/types.js';

class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private index = 0;

  constructor(private text: string) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const frame = this.frames[this.index];
      this.index = (this.index + 1) % this.frames.length;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`\x1b[36m${frame}\x1b[0m ${this.text}`);
    }, 80);
  }

  updateText(newText: string) {
    this.text = newText;
  }

  stop(finalLine?: string) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    if (finalLine) {
      process.stdout.write(`${finalLine}\n`);
    }
  }
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function chatCommand(queryText: string) {
  const gatewayUrl = 'ws://127.0.0.1:18789';
  const queryId = `cli_${Date.now()}`;

  const ws = new WebSocket(gatewayUrl);
  let spinner = new Spinner('Connecting to Dex agent...');

  ws.on('open', () => {
    spinner.stop();
    spinner = new Spinner('Submitting query...');
    spinner.start();
    
    ws.send(JSON.stringify({
      type: 'query',
      id: queryId,
      query: queryText
    }));
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'step_event' && msg.id === queryId) {
        const step: StepEvent = msg.step;
        if (step.status === 'acting' || step.status === 'queued') {
          spinner.updateText(`\x1b[1m${step.name}\x1b[0m - ${step.why || 'Running...'}`);
        } else if (step.status === 'done') {
          spinner.stop(`\x1b[32m✔\x1b[0m \x1b[1m${step.name}\x1b[0m: Completed.`);
          if (step.result) {
            console.log(`  \x1b[90mResult: ${step.result.replace(/\n/g, '\n  ')}\x1b[0m`);
          }
          // Resume general query progress spinner
          spinner = new Spinner('Processing next step...');
          spinner.start();
        } else if (step.status === 'failed') {
          spinner.stop(`\x1b[31m✖\x1b[0m \x1b[1m${step.name}\x1b[0m: Failed.`);
          if (step.error) {
            console.log(`  \x1b[31mError: ${step.error}\x1b[0m`);
          }
        }
      } 
      
      else if (msg.type === 'pending_action' && msg.id === queryId) {
        spinner.stop();
        console.log(`\n\x1b[33m⚠️  POTENTIALLY DESTRUCTIVE ACTION CONFIRMATION GATED\x1b[0m`);
        console.log(`   Tool:      ${msg.name}`);
        console.log(`   Arguments: ${JSON.stringify(msg.args)}`);
        console.log(`   Warning:   ${msg.message}\n`);
        
        const answer = await askQuestion('\x1b[33mDo you approve this action? (y/N):\x1b[0m ');
        const approved = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
        
        if (approved) {
          console.log('\x1b[32mSending approval token...\x1b[0m');
          ws.send(JSON.stringify({
            type: 'approve',
            id: queryId
          }));
          spinner = new Spinner('Executing approved action...');
          spinner.start();
        } else {
          console.log('\x1b[31mAction denied. Aborting execution.\x1b[0m');
          ws.send(JSON.stringify({
            type: 'deny',
            id: queryId
          }));
          ws.close();
          process.exit(0);
        }
      } 
      
      else if (msg.type === 'reply' && msg.id === queryId) {
        spinner.stop('\x1b[32m✔\x1b[0m Query processing finished.');
        console.log('\n\x1b[1mDex agent response:\x1b[0m');
        console.log(msg.text || JSON.stringify(msg.result, null, 2));
        ws.close();
        process.exit(0);
      } 
      
      else if (msg.type === 'error' && msg.id === queryId) {
        spinner.stop('\x1b[31m✖\x1b[0m Query error encountered.');
        console.error(`\x1b[31mError: ${msg.error}\x1b[0m`);
        ws.close();
        process.exit(1);
      }
    } catch (err: any) {
      spinner.stop();
      console.error('Error handling socket payload:', err);
    }
  });

  ws.on('error', (err) => {
    spinner.stop();
    console.error(`\x1b[31m✖ Connection failed: ${err.message}\x1b[0m`);
    console.error('Is the Dex gateway server running? Run "dex start" to launch it.');
    process.exit(1);
  });
}
