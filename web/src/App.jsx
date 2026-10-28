import { useEffect, useRef, useState } from 'react';
import LatticeLoader from './components/LatticeLoader.jsx';
import PromptBar from './components/PromptBar.jsx';
import RubberSegment from './components/RubberSegment.jsx';
import StatusMark from './components/StatusMark.jsx';
import ThoughtLine from './components/ThoughtLine.jsx';
import { toHtml } from './lib/markdown.js';

const TOKEN = new URLSearchParams(location.search).get('t');
const MODES = [
  { value: 'plan', label: 'Planejar' },
  { value: 'manual', label: 'Só leitura' },
  { value: 'acceptEdits', label: 'Editar' },
  { value: 'auto', label: 'Automático' },
];
const EFFORTS = { Baixo: 'low', Médio: 'medium', Alto: 'high', 'Muito alto': 'xhigh', Máximo: 'max' };
const EFFORT_LABELS = Object.keys(EFFORTS);

const thousands = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const oneLine = (text, max = 160) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function api(route, body) {
  return fetch(`/api/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-detro-token': TOKEN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readStream(response, onEvent) {
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    onEvent({ type: 'exit', code: 1, error: error ?? `O detro respondeu ${response.status}. Reinicie o detro no terminal.` });
    return;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const lines = (pending + value).split('\n');
    pending = lines.pop();
    for (const line of lines) if (line) onEvent(JSON.parse(line));
  }
}

function toolTarget(input = {}, root) {
  const target = input.file_path ?? input.path ?? input.pattern ?? input.command ?? input.skill ?? input.url ?? input.query ?? input.description ?? '';
  return oneLine(String(target).replace(`${root}/`, ''), 120);
}

function reduce(turn, event, root) {
  const parts = Array.isArray(event.message?.content) ? event.message.content : [];
  const next = { ...turn, thinking: [...turn.thinking], items: [...turn.items] };
  if (event.type === 'assistant') {
    for (const part of parts) {
      if (part.type === 'thinking' && part.thinking) next.thinking.push(oneLine(part.thinking));
      if (part.type === 'text' && part.text.trim()) next.items.push({ kind: 'text', text: part.text.trim() });
      if (part.type === 'tool_use') next.items.push({ kind: 'tool', id: part.id, name: part.name, target: toolTarget(part.input, root), status: 'running' });
    }
  } else if (event.type === 'user') {
    for (const part of parts.filter((p) => p.type === 'tool_result')) {
      const text = Array.isArray(part.content) ? part.content.map((c) => c.text ?? '').join('\n') : String(part.content ?? '');
      next.items = next.items.map((item) => (item.id === part.tool_use_id
        ? { ...item, status: part.is_error ? 'failed' : 'done', detail: part.is_error ? oneLine(text, 200) : `${text.split('\n').length} linhas` }
        : item));
    }
  } else if (event.type === 'out') {
    next.log = (next.log ?? '') + event.text;
  } else if (event.type === 'result') {
    next.result = event;
  } else if (event.type === 'exit') {
    next.status = event.code && !event.stopped ? 'error' : 'done';
    next.stopped = event.stopped;
    next.error = event.error ?? (next.result?.is_error ? oneLine(next.result.result, 600) : undefined);
    next.items = next.items.map((item) => (item.status === 'running' ? { ...item, status: 'cancelled' } : item));
  }
  return next;
}

function Usage({ result }) {
  const usage = result?.usage;
  if (!usage) return null;
  const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return (
    <div className="turn__usage">
      {thousands(input + (usage.output_tokens ?? 0))} tokens · entrada {thousands(input)} ({thousands(usage.cache_read_input_tokens ?? 0)} do cache) · saída {thousands(usage.output_tokens ?? 0)}
    </div>
  );
}

function Turn({ turn }) {
  const denials = turn.result?.permission_denials ?? [];
  return (
    <section className="turn">
      <div className="turn__prompt">{turn.prompt}</div>
      {turn.thinking.length > 0 ? (
        <ThoughtLine label="Pensando…" doneLabel="Pensou por" steps={turn.thinking} working={turn.status === 'working'} fontSize={14} />
      ) : null}
      {turn.items.map((item, i) => (item.kind === 'text' ? (
        <div key={i} className="turn__text" dangerouslySetInnerHTML={{ __html: toHtml(item.text) }} />
      ) : (
        <div key={i} className="turn__tool">
          <StatusMark status={item.status} size={16} />
          <div>
            <div><b>{item.name}</b> <span className="turn__target">{item.target}</span></div>
            {item.detail ? <div className={`turn__detail${item.status === 'failed' ? ' turn__detail--error' : ''}`}>{item.detail}</div> : null}
          </div>
        </div>
      )))}
      {turn.log ? <pre className="turn__log">{turn.log}</pre> : null}
      {denials.length > 0 ? (
        <div className="turn__warning">
          O modo atual bloqueou: {denials.map((d) => `${d.tool_name}(${toolTarget(d.tool_input)})`).join(', ')}. Troque para Editar ou Automático e peça de novo.
        </div>
      ) : null}
      {turn.error ? <div className="turn__error">{turn.error}</div> : null}
      <div className="turn__footer">
        <LatticeLoader
          label="Trabalhando"
          doneLabel={turn.stopped ? 'Interrompido em' : 'Concluído em'}
          errorLabel="Falhou após"
          status={turn.status}
          fontSize={13}
        />
        <Usage result={turn.result} />
      </div>
    </section>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('acceptEdits');
  const [turns, setTurns] = useState([]);
  const endRef = useRef(null);
  const busy = turns.at(-1)?.status === 'working';

  useEffect(() => {
    api('state')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((data) => {
        setState(data);
        setMode(data.settings.mode);
      })
      .catch(() => setLoadError('Não foi possível falar com o detro. Abra o endereço que o terminal mostrou, com o ?t= no fim.'));
  }, []);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [turns]);

  if (!state) return <main className="app app--empty">{loadError || 'Carregando…'}</main>;

  const update = (fn) => setTurns((list) => [...list.slice(0, -1), fn(list.at(-1))]);
  const start = (prompt) => setTurns((list) => [...list, { prompt, thinking: [], items: [], status: 'working' }]);

  const send = async (text, { model, effort }) => {
    const settings = { model: model.key, effort: EFFORTS[effort], mode };
    api('settings', settings);
    const [command, ...args] = text.split(/\s+/);
    if (command === '/novo') {
      await api('new', {});
      setTurns([]);
      return;
    }
    start(text);
    const onEvent = (event) => update((turn) => reduce(turn, event, state.projectDir));
    if (state.commands.some((c) => c.name === command)) {
      await readStream(await api('app', { args: [command.slice(1), ...args] }), onEvent);
    } else {
      await readStream(await api('agent', { prompt: text, ...settings }), onEvent);
    }
  };

  const changeMode = (value) => {
    setMode(value);
    api('settings', { mode: value });
  };

  const effortLabel = Object.entries(EFFORTS).find(([, value]) => value === state.settings.effort)?.[0] ?? 'Alto';

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <div className="app__title">detro</div>
          <div className="app__meta">{state.project}{state.branch ? ` · ${state.branch}` : ''} · v{state.version}</div>
        </div>
        <RubberSegment items={MODES} value={mode} onChange={changeMode} size="sm" aria-label="Modo de permissão" />
      </header>

      <div className="app__turns">
        {turns.length === 0 ? (
          <div className="app__hint">
            Escreva um pedido para o agente ou use <b>/</b> para os comandos do ambiente (start, restart, logs…).
            O modelo escolhido abaixo define quem atende: Claude ou um modelo do Ollama rodando dentro do Claude Code.
          </div>
        ) : null}
        {turns.map((turn, i) => <Turn key={i} turn={turn} />)}
        <div ref={endRef} />
      </div>

      <div className="app__composer">
        <PromptBar
          placeholder="Peça algo ao agente ou digite / para comandos"
          sources={[]}
          commands={state.commands}
          models={state.models}
          defaultModel={state.settings.model}
          efforts={EFFORT_LABELS}
          defaultEffort={effortLabel}
          busy={busy}
          onSend={send}
          onStop={() => api('stop', {})}
          width={820}
          maxRows={10}
        />
      </div>
    </main>
  );
}
