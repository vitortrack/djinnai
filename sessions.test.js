import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(path.join(os.tmpdir(), 'djinn-'));
const { listSessions, promptText, sessionsDir, transcriptEvents } = await import('./sessions.js');

assert.equal(promptText('oi'), 'oi');
assert.equal(promptText('<command-message>x</command-message>\n<command-name>/ponytail</command-name>\n<command-args>full</command-args>'), '/ponytail full');
assert.equal(promptText([{ type: 'text', text: '<ide_opened_file>a.ts</ide_opened_file>' }, { type: 'text', text: 'corrige' }]), 'corrige');
assert.equal(promptText([{ type: 'tool_result', content: 'x' }]), '');
assert.equal(promptText('<local-command-stdout>ok</local-command-stdout>'), '');

const dir = sessionsDir('/p/meu-projeto');
mkdirSync(dir, { recursive: true });
const line = (entry) => JSON.stringify(entry);
writeFileSync(path.join(dir, 'abc.jsonl'), [
  line({ type: 'user', message: { content: 'primeira pergunta' } }),
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/p/a.js' } }], usage: { input_tokens: 5 } } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb' }] } }),
  line({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagente' }] } }),
  line({ type: 'assistant', message: { content: [{ type: 'text', text: 'resposta' }], usage: { input_tokens: 10, cache_read_input_tokens: 90 } } }),
  line({ type: 'user', isMeta: true, message: { content: 'meta' } }),
  line({ type: 'user', message: { content: 'segunda' } }),
  'linha quebrada',
  line({ type: 'ai-title', aiTitle: 'Título gerado' }),
].join('\n'));
writeFileSync(path.join(dir, 'vazia.jsonl'), line({ type: 'queue-operation' }));

const sessions = await listSessions('/p/meu-projeto');
assert.deepEqual(sessions.map(({ id, title, context }) => ({ id, title, context })), [{ id: 'abc', title: 'Título gerado', context: 100 }]);

const events = await transcriptEvents('/p/meu-projeto', 'abc');
assert.deepEqual(events.map((e) => e.text ?? e.state ?? e.type), ['primeira pergunta', 'assistant', 'user', 'assistant', 'idle', 'segunda', 'idle']);
assert.equal(events[0].replayed, true);
console.log('ok');
