import fs from 'fs';
import path from 'path';
import os from 'os';

let cachedShortcuts: Map<string, string> | null = null;

function scanShortcutsDir(dir: string, map: Map<string, string>) {
  if (!fs.existsSync(dir)) return;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanShortcutsDir(fullPath, map);
        } else {
          const ext = path.extname(file).toLowerCase();
          if (ext === '.lnk' || ext === '.url') {
            const name = path.basename(file, ext).toLowerCase().trim();
            // Store the full path of the shortcut
            map.set(name, fullPath);
            
            // Also store simple variations, e.g. "google chrome" -> "chrome"
            if (name.includes(' ')) {
              const parts = name.split(' ');
              for (const part of parts) {
                if (part.length > 2 && !map.has(part)) {
                  map.set(part, fullPath);
                }
              }
            }
          }
        }
      } catch (e) {
        // Skip unreadable files
      }
    }
  } catch (e) {
    // Skip unreadable folders
  }
}

export function getAppShortcuts(): Map<string, string> {
  if (cachedShortcuts) {
    return cachedShortcuts;
  }

  const map = new Map<string, string>();
  if (os.platform() !== 'win32') {
    cachedShortcuts = map;
    return map;
  }

  const homeDir = os.homedir();
  const pathsToScan = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(homeDir, 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(homeDir, 'Desktop'),
    'C:\\Users\\Public\\Desktop'
  ];

  for (const p of pathsToScan) {
    scanShortcutsDir(p, map);
  }

  cachedShortcuts = map;
  return map;
}

/**
 * Rescans the shortcut list (e.g. if the user installs new apps)
 */
export function rescanShortcuts(): void {
  cachedShortcuts = null;
  getAppShortcuts();
}
