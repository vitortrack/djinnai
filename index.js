#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from './server.js';

function findProjectRoot(start) {
  for (const marker of ['.djinn', '.detro', '.git', 'package.json']) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      if (existsSync(path.join(dir, marker))) return dir;
      if (path.dirname(dir) === dir) break;
    }
  }
  return start;
}

const projectDir = findProjectRoot(process.cwd());
const appScript = [process.env.DJINN_APP_SCRIPT ?? process.env.DETRO_APP_SCRIPT, 'appDev', 'app']
  .filter(Boolean)
  .map((name) => path.resolve(projectDir, name))
  .find((file) => existsSync(file)) ?? path.join(projectDir, 'appDev');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUICK_EXIT_MS = 3000;
const { version } = JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8'));

function openBrowser(url) {
  const opener = { darwin: ['open'], win32: ['cmd', '/c', 'start', ''] }[process.platform] ?? ['xdg-open'];
  spawn(opener[0], [...opener.slice(1), url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

function sandboxFlags(electron) {
  if (process.platform !== 'linux') return [];
  try {
    const { uid, mode } = statSync(path.join(path.dirname(electron), 'chrome-sandbox'));
    if (uid === 0 && mode & 0o4000) return [];
  } catch {}
  return ['--no-sandbox'];
}

async function openAppWindow(url, onClose) {
  const electron = await import('electron').then((module) => module.default, () => null);
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    console.log('Não consegui abrir a janela do aplicativo; abrindo no navegador.');
    openBrowser(url);
  };
  if (!electron) return fallback();
  const startedAt = Date.now();
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  const window = spawn(electron, [...sandboxFlags(electron), path.join(HERE, 'window.cjs'), url], { stdio: 'ignore', env });
  window.on('error', fallback);
  window.on('exit', () => (Date.now() - startedAt < QUICK_EXIT_MS ? fallback() : onClose()));
  return window;
}

const args = process.argv.slice(2);

if (['version', '--version', '-v'].includes(args[0])) {
  console.log(`DjinnAI ${version}`);
} else if (args.length > 0 && args[0] !== '--navegador') {
  spawn(appScript, args, { cwd: projectDir, stdio: 'inherit' })
    .on('error', (error) => {
      console.error(`Não foi possível executar ${appScript} (${error.message}). Confira se ele existe e é executável (chmod +x).`);
      process.exit(1);
    })
    .on('close', (code) => process.exit(code ?? 1));
} else {
  const { url, close } = await startServer({ projectDir, appScript, version, port: Number(process.env.DJINN_PORT ?? process.env.DETRO_PORT) || 0 }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
  console.log(`DjinnAI ${version} — ${projectDir}\n\n  ${url}\n\nAbra o endereço no navegador se quiser acompanhar por lá também. Feche a janela ou use Ctrl+C para encerrar.`);
  const quit = () => {
    close();
    process.exit(0);
  };
  const window = args[0] === '--navegador' ? openBrowser(url) : await openAppWindow(url, quit);
  process.on('SIGINT', () => {
    window?.kill();
    quit();
  });
}
