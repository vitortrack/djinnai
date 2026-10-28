export const oneLine = (text, max = 160) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function toolTarget(input, root) {
  input ??= {};
  const target = input.file_path ?? input.path ?? input.pattern ?? input.command ?? input.skill ?? input.url ?? input.query ?? input.description ?? '';
  return oneLine(String(target).replace(`${root}/`, ''), 120);
}

const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const addUsage = (total = {}, usage = {}) => Object.fromEntries(USAGE_KEYS.map((key) => [key, (total[key] ?? 0) + (usage[key] ?? 0)]));

const lastIndex = (turns, kind) => turns.findLastIndex((turn) => turn.kind === kind);

function patchLast(turns, kind, fn) {
  const i = lastIndex(turns, kind);
  if (i < 0) return turns;
  return turns.map((turn, j) => (j === i ? fn({ ...turn, items: [...turn.items], thinking: [...turn.thinking] }) : turn));
}

const closeWorking = (turns, fn) => turns.map((turn) => (turn.kind === 'agent' && turn.status === 'working' ? fn({ ...turn }) : turn));

const settleItems = (turn) => ({
  ...turn,
  live: '',
  liveThinking: '',
  items: turn.items.map((item) => {
    if (item.kind === 'tool' && item.status === 'running') return { ...item, status: 'cancelled' };
    if (item.kind === 'ask' && item.status === 'pending') return { ...item, status: 'cancelled' };
    return item;
  }),
});

function agentEvent(turn, event, root) {
  const parts = Array.isArray(event.message?.content) ? event.message.content : [];
  if (event.type === 'stream_event') {
    const delta = event.event?.delta;
    if (delta?.type === 'text_delta') turn.live += delta.text;
    if (delta?.type === 'thinking_delta') {
      turn.thought = true;
      turn.liveThinking += delta.thinking;
    }
    if (event.event?.type === 'content_block_start' && event.event.content_block?.type === 'thinking') turn.thought = true;
  } else if (event.type === 'assistant') {
    for (const part of parts) {
      if (part.type === 'thinking') {
        turn.thought = true;
        turn.liveThinking = '';
        if (part.thinking) turn.thinking.push(oneLine(part.thinking));
      }
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        turn.live = '';
        turn.items.push({ kind: 'text', text: part.text.trim() });
      }
      if (part.type === 'tool_use') turn.items.push({ kind: 'tool', id: part.id, name: part.name, target: toolTarget(part.input, root), status: 'running' });
    }
  } else if (event.type === 'user') {
    for (const part of parts.filter((p) => p.type === 'tool_result')) {
      const text = Array.isArray(part.content) ? part.content.map((c) => c?.text ?? '').join('\n') : String(part.content ?? '');
      turn.items = turn.items.map((item) => (item.id === part.tool_use_id
        ? { ...item, status: part.is_error ? 'failed' : 'done', detail: part.is_error ? oneLine(text, 200) : `${text.split('\n').length} linhas` }
        : item));
    }
  } else if (event.type === 'control_request') {
    turn.items.push({ kind: 'ask', requestId: event.request_id, request: event.request, status: 'pending' });
  }
  return turn;
}

export function applyEvent(turns, event, root) {
  if (event.type === 'reset') return [];
  if (event.type === 'user_prompt') {
    const working = turns.findLastIndex((turn) => turn.kind === 'agent' && turn.status === 'working');
    if (working >= 0) {
      return turns.map((turn, i) => (i === working
        ? { ...turn, live: '', items: [...turn.items, ...(turn.live ? [{ kind: 'text', text: turn.live }] : []), { kind: 'prompt', text: event.text, images: event.images ?? [] }] }
        : turn));
    }
    return [...turns, { kind: 'agent', prompt: event.text, images: event.images ?? [], thinking: [], items: [], live: '', liveThinking: '', thought: false, status: 'working' }];
  }
  if (event.type === 'app_start') return [...turns, { kind: 'app', prompt: event.command, log: '', thinking: [], items: [], status: 'working' }];
  if (event.type === 'app_out') return patchLast(turns, 'app', (turn) => ({ ...turn, log: turn.log + event.text }));
  if (event.type === 'app_exit') {
    return patchLast(turns, 'app', (turn) => ({ ...turn, status: event.code && !event.stopped ? 'error' : 'done', stopped: event.stopped, error: event.error }));
  }
  if (event.parent_tool_use_id) return turns;
  if (event.type === 'permission_answer' || event.type === 'control_cancel_request') {
    const id = event.requestId ?? event.request_id;
    const status = event.behavior ?? 'cancelled';
    return turns.map((turn) => (turn.items.some((item) => item.requestId === id)
      ? { ...turn, items: turn.items.map((item) => (item.requestId === id ? { ...item, status } : item)) }
      : turn));
  }
  if (event.type === 'interrupted') return patchLast(turns, 'agent', (turn) => ({ ...turn, stopped: true }));
  if (event.type === 'result') {
    return patchLast(turns, 'agent', (turn) => ({
      ...turn,
      usage: addUsage(turn.usage, event.usage),
      denials: [...(turn.denials ?? []), ...(event.permission_denials ?? [])],
      error: event.is_error && !turn.stopped ? oneLine(event.result ?? (event.errors ?? []).join(' '), 600) : turn.error,
    }));
  }
  if (event.subtype === 'session_state_changed' && event.state === 'idle') {
    return closeWorking(turns, (turn) => settleItems({ ...turn, status: turn.error && !turn.stopped ? 'error' : 'done' }));
  }
  if (event.type === 'session_end') return closeWorking(turns, (turn) => settleItems({ ...turn, status: 'error', error: event.error }));
  if (['assistant', 'user', 'stream_event', 'control_request'].includes(event.type)) {
    return patchLast(turns, 'agent', (turn) => agentEvent(turn, event, root));
  }
  return turns;
}
