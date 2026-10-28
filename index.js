#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  const { url, close } = await startServer({ projectDir, appScript, version, port: Number(process.env.DETRO_PORT) || 0 });
  console.log(`detro ${version} — ${projectDir}\n\n  ${url}\n\nCtrl+C encerra.`);
  const opener = { darwin: ['open'], win32: ['cmd', '/c', 'start', ''] }[process.platform] ?? ['xdg-open'];
  spawn(opener[0], [...opener.slice(1), url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  process.on('SIGINT', () => {
    close();
    process.exit(0);
  });
}
