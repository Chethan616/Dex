/**
 * DEX's credential-safe launcher for reddit-mcp-server.
 *
 * npx installs the public package with no Reddit token in its environment.
 * Only after installation do we read the refresh token from keytar and start
 * the MCP package directly, avoiding both mcp.json and npx's process tree.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const service = 'com.chethan616.dex.mcp';
const account = 'connections';
const packageName = 'reddit-mcp-server';

export function cleanRedditInstallerEnvironment(source) {
  const env = { ...source };
  for (const name of ['REDDIT_REFRESH_TOKEN', 'DEX_REDDIT_REFRESH_TOKEN', 'REDDIT_CLIENT_SECRET', 'REDDIT_PASSWORD']) delete env[name];
  return env;
}

function npmCachePath(env) {
  if (env.npm_config_cache) return env.npm_config_cache;
  const local = env.LOCALAPPDATA;
  return process.platform === 'win32' && local
    ? path.join(local, 'npm-cache')
    : path.join(os.homedir(), '.npm');
}

function findPackage(cacheRoot) {
  const npxRoot = path.join(cacheRoot, '_npx');
  if (!fs.existsSync(npxRoot)) return null;
  const candidates = [];
  for (const hash of fs.readdirSync(npxRoot)) {
    const directory = path.join(npxRoot, hash, 'node_modules', packageName);
    const manifestPath = path.join(directory, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === packageName) candidates.push({ directory, manifest, modified: fs.statSync(manifestPath).mtimeMs });
    } catch {
      // Ignore incomplete entries left by an interrupted npm installation.
    }
  }
  candidates.sort((a, b) => b.modified - a.modified);
  return candidates[0] ?? null;
}

function entryPoint(candidate) {
  const bin = candidate.manifest.bin;
  const cli = typeof bin === 'string' ? bin : bin?.[packageName] ?? Object.values(bin ?? {})[0];
  const relative = cli ?? candidate.manifest.main ?? 'dist/index.js';
  const resolved = path.resolve(candidate.directory, relative);
  if (!resolved.startsWith(`${candidate.directory}${path.sep}`) || !fs.existsSync(resolved)) {
    throw new Error('The installed Reddit MCP package has no usable entry point.');
  }
  return resolved;
}

function installPackage(env) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, ['--yes', packageName, '--version'], {
    env: cleanRedditInstallerEnvironment(env),
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not prepare ${packageName} (exit code ${result.status ?? 'unknown'}).`);
}

async function readRedditAccount() {
  const keytar = require('keytar');
  const blob = await keytar.getPassword(service, account);
  if (!blob) throw new Error('Reddit is not connected in DEX. Connect the account again in Settings.');
  const connections = JSON.parse(blob);
  const reddit = connections.reddit;
  const token = reddit?.enabled && reddit.values?.REDDIT_REFRESH_TOKEN;
  if (!token) throw new Error('Reddit is not connected in DEX. Connect the account again in Settings.');
  return { token, username: reddit.values.REDDIT_USERNAME ?? '' };
}

export function redditMcpEnvironment(source, { token, username, bridgePath }) {
  const env = cleanRedditInstallerEnvironment(source);
  const clientId = source.DEX_REDDIT_CLIENT_ID ?? '';
  env.REDDIT_AUTH_MODE = 'authenticated';
  env.REDDIT_CLIENT_ID = clientId;
  // The upstream server requires a truthy client secret to enable OAuth. This
  // public installed-app flow has no secret; the bridge sends client_id:.
  env.REDDIT_CLIENT_SECRET = 'dex-installed-public-client';
  env.REDDIT_USERNAME = source.DEX_REDDIT_USERNAME || username;
  env.DEX_REDDIT_CLIENT_ID = clientId;
  env.DEX_REDDIT_REFRESH_TOKEN = token;
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${pathToFileURL(bridgePath).href}`].filter(Boolean).join(' ');
  return env;
}

async function run() {
  const installerEnv = cleanRedditInstallerEnvironment(process.env);
  installPackage(installerEnv);

  const cacheRoot = npmCachePath(installerEnv);
  const candidate = findPackage(cacheRoot);
  if (!candidate) throw new Error('The Reddit MCP package installed but could not be found in the npm cache.');

  const { token, username } = await readRedditAccount();
  const bridgePath = process.env.DEX_REDDIT_BRIDGE_PATH;
  if (!bridgePath || !fs.existsSync(bridgePath)) throw new Error('DEX could not find its Reddit OAuth adapter. Restart the app and try again.');
  const env = redditMcpEnvironment(process.env, { token, username, bridgePath });

  const child = spawn(process.execPath, [entryPoint(candidate)], { stdio: 'inherit', env, windowsHide: true });
  const forwardSignal = (signal) => child.kill(signal);
  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);
  child.on('error', (error) => {
    console.error(`Reddit MCP could not start: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().catch((error) => {
    // Do not print the environment or keytar contents in startup diagnostics.
    console.error(`Reddit MCP could not start: ${error.message}`);
    process.exitCode = 1;
  });
}
