import assert from 'node:assert';
import { applyEvent } from './turns.js';

const run = (events) => events.reduce((turns, event) => applyEvent(turns, event, '/p'), []);
const A = (content, extra) => ({ type: 'assistant', message: { content }, ...extra });

let turns = run([
  { type: 'user_prompt', text: 'oi' },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ol' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'á' } } },
]);
assert.equal(turns[0].live, 'Olá');

turns = run([
  { type: 'user_prompt', text: 'oi' },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Olá' } } },
  A([{ type: 'text', text: 'Olá' }]),
  A([{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/p/a.txt' } }]),
  { type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: {} } },
  { type: 'permission_answer', requestId: 'r1', behavior: 'allow' },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  A([{ type: 'text', text: 'sub' }], { parent_tool_use_id: 't9' }),
  A([{ type: 'tool_use', id: 't2', name: 'Bash', input: null }]),
  { type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } },
  { type: 'result', usage: { output_tokens: 1 } },
  { type: 'system', subtype: 'session_state_changed', state: 'idle' },
]);
const [turn] = turns;
assert.equal(turn.live, '');
assert.deepEqual(turn.items.map((i) => `${i.kind}:${i.status ?? i.text}`), ['text:Olá', 'tool:done', 'ask:allow', 'tool:cancelled', 'ask:cancelled']);
assert.equal(turn.items[1].target, 'a.txt');
assert.equal(turn.status, 'done');

turns = run([{ type: 'user_prompt', text: 'a' }, { type: 'interrupted' }, { type: 'result', is_error: true, result: 'x' }, { type: 'system', subtype: 'session_state_changed', state: 'idle' }]);
assert.equal(turns[0].status, 'done');
assert.equal(turns[0].stopped, true);

turns = run([{ type: 'user_prompt', text: 'a' }, { type: 'app_start', command: '/status' }, { type: 'app_out', text: 'linha\n' }, { type: 'session_end', error: 'caiu' }, { type: 'app_exit', code: 0 }]);
assert.equal(turns[0].status, 'error');
assert.equal(turns[0].error, 'caiu');
assert.equal(turns[1].log, 'linha\n');
assert.equal(turns[1].status, 'done');

assert.deepEqual(run([{ type: 'user_prompt', text: 'a' }, { type: 'reset' }]), []);

turns = run([{ type: 'user_prompt', text: 'a' }, { type: 'user_prompt', text: 'b' }, A([{ type: 'text', text: 'ok' }]), { type: 'result', usage: { output_tokens: 2 } }, A([{ type: 'text', text: 'b ok' }]), { type: 'result', usage: { output_tokens: 3 } }, { type: 'system', subtype: 'session_state_changed', state: 'idle' }, { type: 'user_prompt', text: 'c' }]);
assert.equal(turns.length, 2);
assert.deepEqual(turns[0].items.map((i) => i.kind), ['prompt', 'text', 'text']);
assert.equal(turns[0].usage.output_tokens, 5);
assert.equal(turns[0].status, 'done');

turns = run([{ type: 'user_prompt', text: 'a' }, { type: 'result', is_error: true, result: 'boom' }, { type: 'system', subtype: 'session_state_changed', state: 'idle' }]);
assert.equal(turns[0].status, 'error');
assert.equal(turns[0].error, 'boom');
turns = run([{ type: 'user_prompt', text: 'a' }, A([{ type: 'text', text: 'x' }], {}), { type: 'assistant', message: { content: [], usage: { input_tokens: 10, cache_read_input_tokens: 90000 } } }]);
assert.equal(turns[0].context, 90010);
console.log('ok');
