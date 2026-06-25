import { getAppShortcuts } from '../brain/shortcuts.js';

export async function initCommand() {
  console.log('\x1b[36mScanning local applications for zero-token launching...\x1b[0m');
  
  const shortcuts = getAppShortcuts();
  const size = shortcuts.size;

  if (size === 0) {
    console.log('\x1b[33mNo application shortcuts indexed. Are you on a non-Windows platform?\x1b[0m');
    return;
  }

  console.log(`\x1b[32m✔ Indexed ${size} application names/aliases successfully!\x1b[0m`);
  console.log('\n\x1b[1mApp Index Preview (First 10):\x1b[0m');
  
  const entries = Array.from(shortcuts.entries()).slice(0, 10);
  for (const [name, path] of entries) {
    console.log(`  - \x1b[33m${name}\x1b[0m -> \x1b[90m${path}\x1b[0m`);
  }

  if (size > 10) {
    console.log(`  ... and ${size - 10} more apps/aliases.`);
  }

  console.log('\nYou can now run offline commands like: \x1b[36mdex chat "open <app_name>"\x1b[0m');
}
