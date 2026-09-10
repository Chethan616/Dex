/**
 * The user's real Desktop, Documents, Downloads and Pictures.
 *
 * This exists because of a bug that looked like a lying agent. Asked to
 * "create a folder on my Desktop", DEX reported success and the folder was
 * nowhere to be seen. It had in fact been created — at
 * `C:\Users\<name>\Desktop`, which on this machine is not the Desktop. The
 * real one is `C:\Users\<name>\OneDrive\Desktop`, because OneDrive redirects
 * the known folder and leaves the old path behind as an ordinary directory.
 *
 * Any agent reaching for `~/Desktop` or `%USERPROFILE%\Desktop` therefore
 * writes somewhere real, somewhere plausible, and somewhere the user will
 * never look. Nothing errors, so nothing surfaces.
 *
 * Electron's app.getPath resolves these through SHGetKnownFolderPath, which
 * honours redirection. Passing the answers to the agent as environment
 * variables removes the guesswork entirely.
 */
import { app } from 'electron';
import { mainLogger } from '../logger';

export interface KnownFolders {
  desktop?: string;
  documents?: string;
  downloads?: string;
  pictures?: string;
  home?: string;
}

let cached: KnownFolders | null = null;

export function knownFolders(): KnownFolders {
  if (cached) return cached;

  const resolve = (name: 'desktop' | 'documents' | 'downloads' | 'pictures' | 'home'): string | undefined => {
    try {
      const value = app.getPath(name);
      return value && value.length > 0 ? value : undefined;
    } catch {
      // Not every platform defines every one of these.
      return undefined;
    }
  };

  cached = {
    desktop: resolve('desktop'),
    documents: resolve('documents'),
    downloads: resolve('downloads'),
    pictures: resolve('pictures'),
    home: resolve('home'),
  };

  mainLogger.info('main.knownFolders', cached as unknown as Record<string, unknown>);
  return cached;
}

/**
 * Inject the folders into an engine's environment.
 *
 * Named DEX_* rather than overriding anything standard: the point is to give
 * the agent a correct answer it can trust, not to fight the shell over what
 * `~` means.
 */
export function applyKnownFolderEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const folders = knownFolders();
  if (folders.desktop) env.DEX_DESKTOP_DIR = folders.desktop;
  if (folders.documents) env.DEX_DOCUMENTS_DIR = folders.documents;
  if (folders.downloads) env.DEX_DOWNLOADS_DIR = folders.downloads;
  if (folders.pictures) env.DEX_PICTURES_DIR = folders.pictures;
  if (folders.home) env.DEX_HOME_DIR = folders.home;
  return env;
}
