import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MAX_FOLDERS = 150;
const INIT_TIMEOUT_MS = 20000;
const USAGE_TIMEOUT_MS = 15000;
const PLAN_CACHE_MS = 60000;

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

const FALLBACK_MODELS = [{ key: 'claude:default', name: 'Padrão', tag: 'Claude' }];

const LEGACY_DIR = '.detro';
const DATA_DIR = '.djinn';

const dataDir = (projectDir) => path.join(projectDir, existsSync(path.join(projectDir, LEGACY_DIR)) && !existsSync(path.join(projectDir, DATA_DIR)) ? LEGACY_DIR : DATA_DIR);
const configPath = (projectDir) => path.join(dataDir(projectDir), 'config.json');

async function loadConfig(projectDir) {
  try {
    return JSON.parse(await readFile(configPath(projectDir), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`${path.relative(projectDir, configPath(projectDir))} não é um JSON válido: ${error.message}`);
  }
}

async function saveSettings(projectDir, settings) {
  const config = { ...(await loadConfig(projectDir)), ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) };
  await mkdir(path.dirname(configPath(projectDir)), { recursive: true });
  await writeFile(configPath(projectDir), `${JSON.stringify(config, null, 2)}\n`);
}

const ollamaUrlOf = (config) => (config.ollamaUrl ?? config.ai?.ollama?.baseUrl ?? OLLAMA_URL).replace(/\/$/, '');

async function settingsOf(projectDir) {
  const config = await loadConfig(projectDir);
  return {
    model: !config.model || config.model === 'claude:' ? 'claude:default' : config.model,
    effort: config.effort ?? '',
    mode: config.mode ?? 'acceptEdits',
    ollamaUrl: ollamaUrlOf(config),
  };
}

async function ollamaModels(url) {
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const { models = [] } = await response.json();
    return models.map(({ name }) => ({ key: `ollama:${name}`, name, tag: 'Ollama' }));
  } catch {
    return [];
  }
}

async function sessionContext(projectDir) {
  const git = (args) => promisify(execFile)('git', args, { cwd: projectDir, maxBuffer: 5e7 }).then(({ stdout }) => stdout.trim(), () => '');
  const [files, notes] = await Promise.all([
    git(['ls-files']),
    readFile(path.join(dataDir(projectDir), 'contexto.md'), 'utf8').then((text) => text.trim(), () => ''),
  ]);
  const folders = [...new Set(files.split('\n').map((file) => file.split('/').slice(0, -1).slice(0, 4).join('/')).filter(Boolean))].sort();
  return [
    folders.length > 0 && `Pastas do projeto (até 4 níveis):\n${folders.slice(0, MAX_FOLDERS).join('\n')}${folders.length > MAX_FOLDERS ? `\n(+${folders.length - MAX_FOLDERS} pastas)` : ''}`,
    notes && `NOTAS DO PROJETO (${path.basename(dataDir(projectDir))}/contexto.md), siga como instrução:\n${notes}`,
  ].filter(Boolean).join('\n\n');
}

function eachLine(stream, onLine) {
  let pending = '';
  stream.on('data', (chunk) => {
    const lines = (pending + chunk).split('\n');
    pending = lines.pop();
    for (const line of lines) if (line.trim()) onLine(line);
  });
  stream.on('end', () => pending.trim() && onLine(pending));
}

const killGroup = (child, signal = 'SIGTERM') => {
  try {
    process.kill(-child.pid, signal);
  } catch {}
};

function planUsage() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], { cwd: os.tmpdir(), env });
  return new Promise((resolve) => {
    const done = (value) => {
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(done, USAGE_TIMEOUT_MS, null);
    child.on('error', () => done(null));
    child.stdin.on('error', () => {});
    eachLine(child.stdout, (line) => {
      try {
        const event = JSON.parse(line);
        if (event.response?.request_id === 'usage') done(event.response.response ?? null);
      } catch {}
    });
    for (const [id, subtype] of [['init', 'initialize'], ['usage', 'get_usage']]) {
      child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: id, request: { subtype } })}\n`);
    }
  });
}

function totalUsage(usageByProcess) {
  const total = {};
  for (const { agent, models } of usageByProcess.values()) {
    for (const [model, usage] of Object.entries(models)) {
      const sum = (total[model] ??= { model, agent, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 });
      sum.input += usage.inputTokens ?? 0;
      sum.cacheRead += usage.cacheReadInputTokens ?? 0;
      sum.cacheWrite += usage.cacheCreationInputTokens ?? 0;
      sum.output += usage.outputTokens ?? 0;
      sum.cost += usage.costUSD ?? 0;
    }
  }
  return Object.values(total);
}

const readBody = async (request) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}');
};

export function startServer({ projectDir, appScript, version, port = 0 }) {
  const token = randomBytes(16).toString('hex');
  mkdirSync(dataDir(projectDir), { recursive: true });
  const clients = new Set();
  let history = [];
  let session = null;
  let sessionId = null;
  let busy = false;
  let app = null;
  let record = null;
  const usageByProcess = new Map();
  const plan = { at: 0, value: null, pending: null };

  async function currentPlan() {
    if (Date.now() - plan.at < PLAN_CACHE_MS) return plan.value;
    plan.pending ??= planUsage().finally(() => {
      plan.pending = null;
    });
    const fresh = await plan.pending;
    if (!fresh?.rate_limits) return plan.value ?? fresh;
    Object.assign(plan, { at: Date.now(), value: fresh });
    return fresh;
  }

  const broadcast = (event, keep = true) => {
    if (keep) history.push(event);
    for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const write = (target, message) => target.child.stdin.write(`${JSON.stringify(message)}\n`);
  const control = (target, request) => write(target, { type: 'control_request', request_id: randomBytes(6).toString('hex'), request });

  async function openSession(settings) {
    const [agent, name] = settings.model.split(/:(.*)/s);
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', settings.mode];
    const context = await sessionContext(projectDir);
    if (context) args.push('--append-system-prompt', context);
    if (name !== 'default') args.push('--model', name);
    if (settings.effort) args.push('--effort', settings.effort);
    if (sessionId) args.push('--resume', sessionId);

    const env = { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };
    delete env.ANTHROPIC_API_KEY;
    if (agent === 'ollama') Object.assign(env, { ANTHROPIC_BASE_URL: settings.ollamaUrl, ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '' });

    const child = spawn('claude', args, { cwd: projectDir, env, detached: true });
    const current = { child, agent, effort: settings.effort, model: settings.model, mode: settings.mode, closing: false };
    let resolveInit;
    current.init = new Promise((resolve) => { resolveInit = resolve; });
    const initId = randomBytes(6).toString('hex');
    let errors = '';
    let spawnError = '';

    eachLine(child.stdout, (line) => {
      record?.write(`${line}\n`);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.session_id) sessionId = event.session_id;
      if (event.type === 'control_response') {
        if (event.response?.request_id === initId) resolveInit(event.response.response ?? null);
        return;
      }
      if (event.type === 'control_request' && event.request?.subtype !== 'can_use_tool') {
        write(current, { type: 'control_response', response: { subtype: 'error', request_id: event.request_id, error: 'O DjinnAI não atende este pedido.' } });
        return;
      }
      if (event.subtype === 'session_state_changed') busy = event.state !== 'idle';
      if (event.type === 'result' && event.modelUsage) usageByProcess.set(current, { agent, models: event.modelUsage });
      broadcast(event, event.type !== 'stream_event');
    });
    child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-2000); });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      spawnError = `Não foi possível executar o claude (${error.message}). Confira se o Claude Code está instalado e logado.`;
    });
    child.on('close', (code) => {
      resolveInit(null);
      if (session === current) session = null;
      if (current.closing) return;
      busy = false;
      broadcast({ type: 'session_end', error: spawnError || errors.trim().slice(-600) || `O agente encerrou sozinho (código ${code}). Mande a mensagem de novo para retomar a conversa.` });
    });

    write(current, { type: 'control_request', request_id: initId, request: { subtype: 'initialize' } });
    return current;
  }

  let opening = null;

  async function ensureSession(settings) {
    while (opening) await opening;
    const [agent] = settings.model.split(':');
    if (session && session.agent === agent && session.effort === settings.effort) {
      if (session.mode !== settings.mode) control(session, { subtype: 'set_permission_mode', mode: settings.mode });
      if (session.model !== settings.model) {
        const name = settings.model.split(/:(.*)/s)[1];
        control(session, { subtype: 'set_model', ...(name !== 'default' && { model: name }) });
      }
      Object.assign(session, { mode: settings.mode, model: settings.model });
      return session;
    }
    if (session && busy) return session;
    closeSession();
    opening = openSession(settings);
    session = await opening;
    opening = null;
    return session;
  }

  function closeSession() {
    if (!session) return;
    session.closing = true;
    killGroup(session.child);
    session = null;
  }

  const routes = {
    'GET /api/state': async () => {
      const settings = await settingsOf(projectDir);
      const current = await ensureSession(settings);
      const init = await Promise.race([current.init, new Promise((resolve) => setTimeout(resolve, INIT_TIMEOUT_MS, null))]);
      const branch = await promisify(execFile)('git', ['branch', '--show-current'], { cwd: projectDir }).then(({ stdout }) => stdout.trim(), () => '');
      const appNames = new Set(['novo', 'usage', ...APP_COMMANDS.map(([name]) => name)]);
      const claudeModels = (init?.models ?? []).map((m) => ({ key: `claude:${m.value}`, name: m.value === 'default' ? 'Padrão' : m.displayName, tag: m.description?.split(' · ')[0] ?? 'Claude' }));
      return {
        project: path.basename(projectDir),
        projectDir,
        branch,
        version,
        agentError: init ? '' : 'O Claude Code não respondeu. Confira se o comando claude está instalado e logado e rode djinn de novo.',
        models: [...(claudeModels.length ? claudeModels : FALLBACK_MODELS), ...(await ollamaModels(settings.ollamaUrl))],
        appCommands: [...appNames],
        commands: [
          { key: 'novo', name: '/novo', description: 'Começa uma conversa nova' },
          { key: 'usage', name: '/usage', description: 'Limites do plano e uso por modelo' },
          ...APP_COMMANDS.map(([key, description]) => ({ key, name: `/${key}`, description })),
          ...(init?.commands ?? []).filter((c) => !appNames.has(c.name)).map((c) => ({ key: `claude-${c.name}`, name: `/${c.name}`, description: c.description.split(/(?<=\.)\s/)[0].slice(0, 110) })),
        ],
        settings: { model: settings.model, effort: settings.effort, mode: settings.mode },
      };
    },
    'GET /api/usage': async () => {
      const info = await currentPlan();
      return {
        subscription: info?.subscription_type ?? '',
        limits: info?.rate_limits?.limits ?? null,
        models: totalUsage(usageByProcess),
      };
    },
    'POST /api/settings': async (request) => {
      const { model, effort, mode } = await readBody(request);
      await saveSettings(projectDir, { model, effort, mode });
      await ensureSession(await settingsOf(projectDir));
      return {};
    },
    'POST /api/send': async (request) => {
      const { text, images = [] } = await readBody(request);
      const current = await ensureSession(await settingsOf(projectDir));
      if (!busy) {
        record?.end();
        record = createWriteStream(path.join(dataDir(projectDir), 'last-turn.ndjson')).on('error', () => {});
      }
      const content = images.length
        ? [...images.map(({ mediaType, data }) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })), { type: 'text', text }]
        : text;
      write(current, { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
      busy = true;
      broadcast({ type: 'user_prompt', text, images: images.map(({ mediaType, data }) => `data:${mediaType};base64,${data}`) });
      return {};
    },
    'POST /api/permission': async (request) => {
      const { requestId, behavior, updatedInput, updatedPermissions, message } = await readBody(request);
      if (!session) throw new Error('A conversa não está mais aberta. Mande a mensagem de novo.');
      const response = behavior === 'allow'
        ? { behavior, updatedInput, ...(updatedPermissions && { updatedPermissions }) }
        : { behavior, message: message || 'O usuário recusou.' };
      write(session, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
      broadcast({ type: 'permission_answer', requestId, behavior });
      return {};
    },
    'POST /api/interrupt': async () => {
      if (session && busy) {
        control(session, { subtype: 'interrupt' });
        broadcast({ type: 'interrupted' });
      }
      return {};
    },
    'POST /api/new': async () => {
      closeSession();
      sessionId = null;
      busy = false;
      history = [];
      broadcast({ type: 'reset' }, false);
      settingsOf(projectDir).then(ensureSession).catch(() => {});
      return {};
    },
    'POST /api/app': async (request) => {
      const { args } = await readBody(request);
      if (!APP_COMMANDS.some(([name]) => name === args[0])) throw new Error(`Comando desconhecido: ${args[0]}`);
      if (app) throw new Error('Já tem um comando do ambiente rodando. Pare ele antes de mandar outro.');
      const child = spawn(appScript, args, { cwd: projectDir, env: { ...process.env, FORCE_COLOR: '0' }, detached: true });
      app = { child, stopped: false, error: '' };
      const current = app;
      broadcast({ type: 'app_start', command: `/${args.join(' ')}` });
      const out = (line) => broadcast({ type: 'app_out', text: `${line}\n` });
      eachLine(child.stdout, out);
      eachLine(child.stderr, out);
      child.on('error', (error) => {
        current.error = `Não foi possível executar ${appScript} (${error.message}). Confira se ele existe e é executável.`;
      });
      child.on('close', (code, signal) => {
        app = null;
        broadcast({ type: 'app_exit', code: code ?? 1, stopped: current.stopped || Boolean(signal), error: current.error });
      });
      return {};
    },
    'POST /api/stop': async () => {
      if (app) {
        app.stopped = true;
        killGroup(app.child, 'SIGINT');
      }
      return {};
    },
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/events') {
      if (url.searchParams.get('t') !== token) return response.writeHead(403).end();
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      for (const event of [{ type: 'reset' }, ...history]) response.write(`data: ${JSON.stringify(event)}\n\n`);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    const route = routes[`${request.method} ${url.pathname}`];
    if (!route) {
      const file = path.join(DIST, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(DIST) || !existsSync(file)) return response.writeHead(404).end();
      response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      return createReadStream(file).pipe(response);
    }
    if (request.headers['x-djinn-token'] !== token) return response.writeHead(403).end();
    try {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await route(request)));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', (error) => reject(new Error(error.code === 'EADDRINUSE' ? `A porta ${port} já está em uso. Feche o outro djinn ou rode sem DJINN_PORT.` : error.message)));
    server.listen(port, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}/?t=${token}`,
      close: () => {
        closeSession();
        if (app) killGroup(app.child);
        server.close();
      },
    }));
  });
}
