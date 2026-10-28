#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from './server.js';

const { version } = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'));

function findProjectRoot(start) {
  for (const marker of ['.detro', '.git', 'package.json']) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      if (existsSync(path.join(dir, marker))) return dir;
      if (path.dirname(dir) === dir) break;
    }
  }
  return start;
}

const projectDir = findProjectRoot(process.cwd());
const appScript = [process.env.DETRO_APP_SCRIPT, 'appDev', 'app']
  .filter(Boolean)
  .map((name) => path.resolve(projectDir, name))
  .find((file) => existsSync(file)) ?? path.join(projectDir, 'appDev');

const APP_BROWSERS = {
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: [
    [process.env.ProgramFiles, 'Google\\Chrome\\Application\\chrome.exe'],
    [process.env['ProgramFiles(x86)'], 'Google\\Chrome\\Application\\chrome.exe'],
    [process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'],
    [process.env['ProgramFiles(x86)'], 'Microsoft\\Edge\\Application\\msedge.exe'],
    [process.env.ProgramFiles, 'Microsoft\\Edge\\Application\\msedge.exe'],
  ].filter(([base]) => base).map((parts) => path.join(...parts)),
};
const QUICK_EXIT_MS = 3000;

function findAppBrowser() {
  const inPath = (name) => (process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, name)).find((file) => existsSync(file));
  return (APP_BROWSERS[process.platform] ?? []).map((name) => (path.isAbsolute(name) ? (existsSync(name) && name) : inPath(name))).find(Boolean);
}

function openDefaultBrowser(url) {
  const opener = { darwin: ['open'], win32: ['cmd', '/c', 'start', ''] }[process.platform] ?? ['xdg-open'];
  spawn(opener[0], [...opener.slice(1), url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

function openWindow(url, onClose) {
  const browser = findAppBrowser();
  if (!browser) return openDefaultBrowser(url);
  const profile = mkdtempSync(path.join(os.tmpdir(), 'detro-'));
  const startedAt = Date.now();
  const window = spawn(browser, [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1100,900'], { stdio: 'ignore' });
  const cleanup = () => rmSync(profile, { recursive: true, force: true });
  window.on('error', () => {
    cleanup();
    openDefaultBrowser(url);
  });
  window.on('exit', () => {
    cleanup();
    if (Date.now() - startedAt < QUICK_EXIT_MS) return openDefaultBrowser(url);
    onClose();
  });
  return window;
}

const args = process.argv.slice(2);

if (['version', '--version', '-v'].includes(args[0])) {
  console.log(`detro ${version}`);
} else if (args.length > 0) {
  spawn(appScript, args, { cwd: projectDir, stdio: 'inherit' })
    .on('error', (error) => {
      console.error(`Não foi possível executar ${appScript} (${error.message}). Confira se ele existe e é executável (chmod +x).`);
      process.exit(1);
    })
    .on('close', (code) => process.exit(code ?? 1));
} else {
  const { url, close } = await startServer({ projectDir, appScript, version, port: Number(process.env.DETRO_PORT) || 0 }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
  console.log(`detro ${version} — ${projectDir}\n\n  ${url}\n\nFeche a janela ou use Ctrl+C para encerrar.`);
  const quit = () => {
    close();
    process.exit(0);
  };
  const window = openWindow(url, quit);
  process.on('SIGINT', () => {
    window?.kill();
    quit();
  });
}
