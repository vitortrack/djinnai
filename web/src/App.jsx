import { Component, useEffect, useRef, useState } from 'react';
import LatticeLoader from './components/LatticeLoader.jsx';
import PromptBar from './components/PromptBar.jsx';
import RubberSegment from './components/RubberSegment.jsx';
import StatusMark from './components/StatusMark.jsx';
import ThoughtLine from './components/ThoughtLine.jsx';
import PermissionCard from './PermissionCard.jsx';
import UsageDialog, { PlanMeter } from './UsageDialog.jsx';
import { isNearLimit, limitLabel, relevantLimits, resetsAt } from './lib/limits.js';
import { toHtml } from './lib/markdown.js';
import { applyEvent, oneLine, toolTarget } from './lib/turns.js';

const TOKEN = new URLSearchParams(location.search).get('t');
const MODES = [
  { value: 'plan', label: 'Planejar' },
  { value: 'manual', label: 'Perguntar' },
  { value: 'acceptEdits', label: 'Editar' },
  { value: 'auto', label: 'Automático' },
];
const EFFORTS = { Baixo: 'low', Médio: 'medium', Alto: 'high', 'Muito alto': 'xhigh', Máximo: 'max' };
const EFFORT_LABELS = Object.keys(EFFORTS);
const CONTEXT_WARNING = 100000;
const PLAN_REFRESH_MS = 5 * 60 * 1000;
const LOST = 'A conexão com o DjinnAI caiu. Rode djinn de novo no terminal e use o endereço novo que ele mostrar.';

const thousands = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

async function api(route, body) {
  try {
    const response = await fetch(`/api/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-djinn-token': TOKEN, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? `O DjinnAI respondeu ${response.status}. Rode djinn de novo no terminal.`);
    return data;
  } catch (error) {
    throw new Error(error instanceof TypeError ? LOST : error.message);
  }
}

const readImage = (file) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ mediaType: file.type, data: String(reader.result).split(',')[1] });
  reader.readAsDataURL(file);
});

class TurnBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="turn">
        <div className="turn__prompt">{this.props.prompt}</div>
        <div className="turn__error">Não consegui mostrar esta resposta ({this.state.error.message}). O retorno bruto do agente está em .djinn/last-turn.ndjson (ou .detro/, em projetos antigos).</div>
      </section>
    );
  }
}

function Usage({ usage }) {
  if (!usage) return null;
  const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return (
    <div className="turn__usage">
      {thousands(input + (usage.output_tokens ?? 0))} tokens · entrada {thousands(input)} ({thousands(usage.cache_read_input_tokens ?? 0)} do cache) · saída {thousands(usage.output_tokens ?? 0)}
    </div>
  );
}

function Turn({ turn, root, onAnswer, onApprovePlan }) {
  const denials = turn.denials ?? [];
  const steps = [...turn.thinking, ...(turn.liveThinking ? [oneLine(turn.liveThinking)] : [])];
  return (
    <section className="turn">
      <div className="turn__prompt">
        {turn.images?.length ? <div className="turn__images">{turn.images.map((src, i) => <img key={i} src={src} alt="" />)}</div> : null}
        {turn.prompt}
      </div>
      {turn.thought ? (
        <ThoughtLine label="Pensando…" doneLabel="Pensou por" steps={steps} working={turn.status === 'working' && !turn.live && turn.items.length === 0} fontSize={14} />
      ) : null}
      {turn.items.map((item, i) => {
        if (item.kind === 'text') return <div key={i} className="turn__text" dangerouslySetInnerHTML={{ __html: toHtml(item.text) }} />;
        if (item.kind === 'prompt') {
          return (
            <div key={i} className="turn__prompt">
              {item.images.length ? <div className="turn__images">{item.images.map((src, j) => <img key={j} src={src} alt="" />)}</div> : null}
              {item.text}
            </div>
          );
        }
        if (item.kind === 'ask') return <PermissionCard key={i} item={item} root={root} onAnswer={onAnswer} onApprovePlan={onApprovePlan} />;
        return (
          <div key={i} className="turn__tool">
            <StatusMark status={item.status} size={16} />
            <div>
              <div><b>{item.name}</b> <span className="turn__target">{item.target}</span></div>
              {item.detail ? <div className={`turn__detail${item.status === 'failed' ? ' turn__detail--error' : ''}`}>{item.detail}</div> : null}
            </div>
          </div>
        );
      })}
      {turn.live ? <div className="turn__text" dangerouslySetInnerHTML={{ __html: toHtml(turn.live) }} /> : null}
      {turn.log ? <pre className="turn__log">{turn.log}</pre> : null}
      {denials.length > 0 ? (
        <div className="turn__warning">
          O modo atual bloqueou: {denials.map((d) => `${d.tool_name}(${toolTarget(d.tool_input, root)})`).join(', ')}. Troque o modo e peça de novo.
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
        <Usage usage={turn.usage} />
      </div>
    </section>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('acceptEdits');
  const [turns, setTurns] = useState([]);
  const [images, setImages] = useState([]);
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(true);
  const [usage, setUsage] = useState(null);
  const [plan, setPlan] = useState(null);
  const [modelName, setModelName] = useState('');
  const endRef = useRef(null);
  const agentBusy = turns.some((turn) => turn.kind === 'agent' && turn.status === 'working');
  const appBusy = turns.some((turn) => turn.kind === 'app' && turn.status === 'working');
  const context = turns.findLast((turn) => turn.context)?.context ?? 0;

  useEffect(() => {
    api('state')
      .then((data) => {
        setState(data);
        setMode(data.settings.mode);
        setModelName(data.models.find((m) => m.key === data.settings.model)?.name ?? '');
        if (data.agentError) setNotice(data.agentError);
      })
      .catch((error) => setLoadError(error.message === LOST ? 'Não foi possível falar com o DjinnAI. Abra o endereço que o terminal mostrou, com o ?t= no fim.' : error.message));
  }, []);

  useEffect(() => {
    if (!state) return undefined;
    const events = new EventSource(`/api/events?t=${TOKEN}`);
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      setTurns((current) => {
        try {
          return applyEvent(current, event, state.projectDir);
        } catch (error) {
          return [...current.slice(0, -1), { ...current.at(-1), error: `Não consegui mostrar um evento do agente (${error.message}).` }];
        }
      });
    };
    return () => events.close();
  }, [state]);

  useEffect(() => {
    const add = (files) => {
      const picked = [...files].filter((file) => file.type.startsWith('image/'));
      if (picked.length) setImages((list) => [...list, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    };
    const onPaste = (e) => add(e.clipboardData?.files ?? []);
    const onDrop = (e) => {
      e.preventDefault();
      add(e.dataTransfer?.files ?? []);
    };
    const onDragOver = (e) => e.preventDefault();
    window.addEventListener('paste', onPaste);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  useEffect(() => {
    if (!state) return undefined;
    const timer = setInterval(() => api('usage').then(setPlan, () => {}), PLAN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (state && !agentBusy) api('usage').then(setPlan, () => {});
  }, [state, agentBusy]);

  if (!state) return <main className="app app--empty">{loadError || 'Abrindo o agente…'}</main>;

  const run = (promise) => promise.then(() => setNotice(''), (error) => setNotice(error.message));

  const openUsage = () => {
    setUsage({});
    return api('usage').then(
      (data) => {
        setPlan(data);
        setUsage({ data });
      },
      (error) => setUsage({ error: error.message }),
    );
  };

  const limits = relevantLimits(plan?.limits, modelName);
  const nearLimits = limits.filter(isNearLimit);

  const send = async (text, { model, effort }) => {
    const [command, ...args] = text.split(/\s+/);
    const name = command.slice(1);
    if (command === '/novo') return run(api('new', {}));
    if (command === '/usage') return openUsage();
    if (command.startsWith('/') && state.appCommands.includes(name)) return run(api('app', { args: [name, ...args] }));
    const settings = { model: model.key, effort: EFFORTS[effort], mode };
    const pending = images;
    setImages([]);
    return run(api('settings', settings).then(async () => api('send', { text, images: await Promise.all(pending.map(({ file }) => readImage(file))) })));
  };

  const changeMode = (value) => {
    setMode(value);
    run(api('settings', { mode: value }));
  };

  const answer = (requestId, decision) => run(api('permission', { requestId, ...decision }));
  const effortLabel = Object.entries(EFFORTS).find(([, value]) => value === state.settings.effort)?.[0] ?? 'Alto';

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <div className="app__title">DjinnAI</div>
          <div className="app__meta">{state.project}{state.branch ? ` · ${state.branch}` : ''} · v{state.version}</div>
        </div>
        <div className="app__controls">
          <PlanMeter limits={limits} onOpen={openUsage} />
          {context ? <span className="app__context" data-warn={context > CONTEXT_WARNING ? '' : undefined} title="Tokens que o agente relê a cada passo desta conversa">contexto {thousands(context)}</span> : null}
          <button type="button" className="app__new" disabled={agentBusy} onClick={() => run(api('new', {}))}>Nova conversa</button>
          <RubberSegment items={MODES} value={mode} onChange={changeMode} size="sm" aria-label="Modo de permissão" />
        </div>
      </header>

      <div className="app__turns">
        {turns.length === 0 ? (
          <div className="app__hint">
            Converse com o agente como no Claude Code: ele pede permissão aqui, faz perguntas e mostra o plano para você aprovar.
            Cole prints com Ctrl+V. Use <b>/</b> para skills e comandos do ambiente (start, restart, logs…).
          </div>
        ) : null}
        {turns.map((turn, i) => (
          <TurnBoundary key={i} prompt={turn.prompt}>
            <Turn turn={turn} root={state.projectDir} onAnswer={answer} onApprovePlan={() => changeMode('acceptEdits')} />
          </TurnBoundary>
        ))}
        <div ref={endRef} />
      </div>

      <div className="app__composer">
        {!connected ? <div className="turn__error">{LOST}</div> : null}
        {notice ? <div className="turn__warning">{notice}</div> : null}
        {nearLimits.map((limit) => (
          <div key={`${limit.kind}-${limit.percent}`} className="turn__warning">
            {limitLabel(limit)}: você já usou {limit.percent}% do limite do plano{limit.resets_at ? `, que renova ${resetsAt(limit.resets_at)}` : ''}. Guarde o restante para o essencial ou troque para um modelo do Ollama até lá.
          </div>
        ))}
        {context > CONTEXT_WARNING && !agentBusy ? (
          <div className="turn__warning">
            Esta conversa já carrega {thousands(context)} tokens de contexto, relidos a cada passo. Se o próximo pedido é outro assunto, comece uma <b>Nova conversa</b>.
          </div>
        ) : null}
        {images.length ? (
          <div className="app__attachments">
            {images.map(({ url }, i) => (
              <button key={url} type="button" className="app__attachment" title="Remover" onClick={() => setImages((list) => list.filter((_, j) => j !== i))}>
                <img src={url} alt="" />
                <span>×</span>
              </button>
            ))}
          </div>
        ) : null}
        <PromptBar
          placeholder={agentBusy ? 'Mande mais instruções; o agente lê assim que puder' : 'Peça algo ao agente ou digite / para comandos'}
          sources={[]}
          commands={state.commands}
          models={state.models}
          defaultModel={state.settings.model}
          efforts={EFFORT_LABELS}
          defaultEffort={effortLabel}
          busy={agentBusy || appBusy}
          onSend={send}
          onModelChange={(row) => setModelName(row.name)}
          onStop={() => run(api(appBusy ? 'stop' : 'interrupt', {}))}
          width={820}
          maxRows={10}
        />
      </div>
      {usage ? <UsageDialog data={usage.data} error={usage.error} onClose={() => setUsage(null)} /> : null}
    </main>
  );
}
