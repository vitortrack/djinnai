import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MAX_FOLDERS = 150;

const APP_COMMANDS = [
  ['start', 'Sobe o stack e builda só o que mudou'],
  ['restart', 'Reinicia só os serviços alterados (ex.: /restart api)'],
  ['rebuild', 'Build sem cache e recriação forçada'],
  ['logs', 'Logs dos containers (ex.: /logs --tail=100 api)'],
  ['status', 'Containers e uso do Docker'],
  ['stop', 'Para e remove os containers'],
  ['clean', 'Remove imagens órfãs e limita o cache'],
  ['hot-reload', 'Atualiza só o frontend'],
  ['worker', 'Builda o front atualizando a pasta dist'],
];

const CLAUDE_MODELS = [
  { key: 'claude:', name: 'Claude', tag: 'padrão' },
  { key: 'claude:fable', name: 'Fable', tag: 'Claude' },
  { key: 'claude:opus', name: 'Opus', tag: 'Claude' },
  { key: 'claude:sonnet', name: 'Sonnet', tag: 'Claude' },
  { key: 'claude:haiku', name: 'Haiku', tag: 'Claude' },
];

const configPath = (projectDir) => path.join(projectDir, '.detro', 'config.json');

async function loadConfig(projectDir) {
  try {
    return JSON.parse(await readFile(configPath(projectDir), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`.detro/config.json não é um JSON válido: ${error.message}`);
  }
}

async function saveSettings(projectDir, settings) {
  const config = { ...(await loadConfig(projectDir)), ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) };
  await mkdir(path.dirname(configPath(projectDir)), { recursive: true });
  await writeFile(configPath(projectDir), `${JSON.stringify(config, null, 2)}\n`);
}

const ollamaUrlOf = (config) => (config.ollamaUrl ?? config.ai?.ollama?.baseUrl ?? OLLAMA_URL).replace(/\/$/, '');

async function listModels(config) {
  try {
    const response = await fetch(`${ollamaUrlOf(config)}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const { models = [] } = await response.json();
    return [...CLAUDE_MODELS, ...models.map(({ name }) => ({ key: `ollama:${name}`, name, tag: 'Ollama' }))];
  } catch {
    return CLAUDE_MODELS;
  }
}

async function sessionContext(projectDir) {
  const git = (args) => promisify(execFile)('git', args, { cwd: projectDir, maxBuffer: 5e7 }).then(({ stdout }) => stdout.trim(), () => '');
  const [files, notes] = await Promise.all([
    git(['ls-files']),
    readFile(path.join(projectDir, '.detro', 'contexto.md'), 'utf8').then((text) => text.trim(), () => ''),
  ]);
  const folders = [...new Set(files.split('\n').map((file) => file.split('/').slice(0, -1).slice(0, 4).join('/')).filter(Boolean))].sort();
  return [
    folders.length > 0 && `Pastas do projeto (até 4 níveis):\n${folders.slice(0, MAX_FOLDERS).join('\n')}${folders.length > MAX_FOLDERS ? `\n(+${folders.length - MAX_FOLDERS} pastas)` : ''}`,
    notes && `NOTAS DO PROJETO (.detro/contexto.md), siga como instrução:\n${notes}`,
  ].filter(Boolean).join('\n\n');
}

async function agentProcess({ projectDir, config, prompt, model, effort, mode, sessionId }) {
  const [agent, name] = model.split(/:(.*)/s);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode];
  const context = await sessionContext(projectDir);
  if (context) args.push('--append-system-prompt', context);
  if (name) args.push('--model', name);
  if (effort) args.push('--effort', effort);
  if (sessionId) args.push('--resume', sessionId);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  if (agent === 'ollama') Object.assign(env, { ANTHROPIC_BASE_URL: ollamaUrlOf(config), ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '' });

  const child = spawn('claude', args, { cwd: projectDir, env, detached: true });
  child.stdin.end(prompt);
  return child;
}

const readBody = async (request) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}');
};

export function startServer({ projectDir, appScript, version, port = 0 }) {
  const token = randomBytes(16).toString('hex');
  let running = null;
  let sessionId = null;
  let stopped = false;
  const stopRunning = (signal) => {
    if (!running?.pid) return;
    stopped = true;
    try {
      process.kill(-running.pid, signal);
    } catch {}
  };

  function stream(response, child, onLine, isAgent) {
    running = child;
    stopped = false;
    response.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    const send = (event) => response.write(`${JSON.stringify(event)}\n`);
    let pending = '';
    let errors = '';
    let spawnError = '';
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line, send);
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
      if (!isAgent) send({ type: 'out', text: String(chunk) });
    });
    child.on('error', (error) => {
      spawnError = `Não foi possível executar ${child.spawnfile} (${error.message}). Confira se ele está instalado e no PATH.`;
    });
    child.on('close', (code, signal) => {
      running = null;
      if (pending.trim()) onLine(pending, send);
      const error = spawnError || (code && !stopped && isAgent ? errors.trim().slice(-600) : undefined);
      send({ type: 'exit', code: code ?? 1, stopped: stopped || Boolean(signal), error });
      response.end();
    });
  }

  const agentLine = (line, send) => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'result' && event.session_id) sessionId = event.session_id;
      send(event);
    } catch {
      send({ type: 'out', text: `${line}\n` });
    }
  };
  const appLine = (line, send) => send({ type: 'out', text: `${line}\n` });

  const routes = {
    'GET /api/state': async () => {
      const config = await loadConfig(projectDir);
      const branch = await promisify(execFile)('git', ['branch', '--show-current'], { cwd: projectDir }).then(({ stdout }) => stdout.trim(), () => '');
      return {
        project: path.basename(projectDir),
        projectDir,
        branch,
        version,
        models: await listModels(config),
        commands: [{ key: 'new', name: '/novo', description: 'Começa uma conversa nova' }, ...APP_COMMANDS.map(([key, description]) => ({ key, name: `/${key}`, description }))],
        settings: { model: config.model ?? 'claude:', effort: config.effort ?? '', mode: config.mode ?? 'acceptEdits' },
      };
    },
    'POST /api/settings': async (request) => {
      const { model, effort, mode } = await readBody(request);
      await saveSettings(projectDir, { model, effort, mode });
      return {};
    },
    'POST /api/new': async () => {
      sessionId = null;
      return {};
    },
    'POST /api/stop': async () => {
      stopRunning('SIGINT');
      return {};
    },
    'POST /api/agent': async (request, response) => {
      const body = await readBody(request);
      stream(response, await agentProcess({ projectDir, config: await loadConfig(projectDir), sessionId, ...body }), agentLine, true);
    },
    'POST /api/app': async (request, response) => {
      const { args } = await readBody(request);
      if (!APP_COMMANDS.some(([name]) => name === args[0])) throw new Error(`Comando desconhecido: ${args[0]}`);
      stream(response, spawn(appScript, args, { cwd: projectDir, env: { ...process.env, FORCE_COLOR: '0' }, detached: true }), appLine, false);
    },
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const route = routes[`${request.method} ${url.pathname}`];
    if (!route) {
      const file = path.join(DIST, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(DIST) || !existsSync(file)) return response.writeHead(404).end();
      response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      return createReadStream(file).pipe(response);
    }
    if (request.headers['x-detro-token'] !== token) return response.writeHead(403).end();
    if (running && /agent|app/.test(url.pathname)) return response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Já tem uma tarefa rodando. Pare ela antes de mandar outra.' }));
    try {
      const result = await route(request, response);
      if (result) response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      if (!response.headersSent) response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/?t=${token}`, close: () => { stopRunning('SIGTERM'); server.close(); } }));
  });
}
