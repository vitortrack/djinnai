import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
const MAX_SESSIONS = 100;
const MAX_TOOL_TEXT = 20000;
const IDLE = { type: 'system', subtype: 'session_state_changed', state: 'idle' };

const summaries = new Map();

export const sessionsDir = (projectDir) => path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects', projectDir.replace(/[^a-zA-Z0-9]/g, '-'));

export function promptText(content) {
  if (Array.isArray(content)) {
    if (content.some((part) => part?.type === 'tool_result')) return '';
    content = content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n');
  }
  const text = String(content ?? '').trim();
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text);
  if (command) return `${command[1]} ${/<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] ?? ''}`.trim();
  if (text.startsWith('Caveat:')) return '';
  return text.replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, '').trim();
}

const parseLines = (text) => text.split('\n').flatMap((line) => {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
});

async function readEnds(file, size) {
  const handle = await open(file, 'r');
  try {
    const read = async (position, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return buffer.subarray(0, bytesRead).toString('utf8');
    };
    const head = await read(0, Math.min(HEAD_BYTES, size));
    const tail = size > HEAD_BYTES ? await read(Math.max(0, size - TAIL_BYTES), Math.min(TAIL_BYTES, size)) : head;
    return { head: parseLines(head), tail: parseLines(tail) };
  } finally {
    await handle.close();
  }
}

const isPrompt = (entry) => entry.type === 'user' && !entry.isMeta && !entry.isSidechain && promptText(entry.message?.content);

export function summarize({ head, tail }) {
  const lastOf = (type, key) => tail.findLast((e) => e.type === type)?.[key] ?? head.findLast((e) => e.type === type)?.[key];
  const firstPrompt = head.find(isPrompt);
  if (!firstPrompt) return null;
  const usage = tail.findLast((e) => e.type === 'assistant' && !e.isSidechain && e.message?.usage)?.message.usage;
  return {
    title: (lastOf('custom-title', 'customTitle') ?? lastOf('ai-title', 'aiTitle') ?? promptText(firstPrompt.message.content)).slice(0, 120),
    context: usage ? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0,
  };
}

export async function listSessions(projectDir) {
  const dir = sessionsDir(projectDir);
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.jsonl'));
  const files = await Promise.all(names.map(async (name) => ({ name, info: await stat(path.join(dir, name)).catch(() => null) })));
  const recent = files.filter(({ info }) => info?.size).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs).slice(0, MAX_SESSIONS);
  const sessions = await Promise.all(recent.map(async ({ name, info }) => {
    const file = path.join(dir, name);
    const cached = summaries.get(file);
    if (cached?.mtimeMs !== info.mtimeMs) summaries.set(file, { mtimeMs: info.mtimeMs, summary: summarize(await readEnds(file, info.size)) });
    const { summary } = summaries.get(file);
    return summary && { id: name.slice(0, -'.jsonl'.length), updatedAt: info.mtimeMs, ...summary };
  }));
  return sessions.filter(Boolean);
}

const slimToolResult = (part) => {
  if (part?.type !== 'tool_result') return part;
  const text = Array.isArray(part.content) ? part.content.map((c) => c?.text ?? '').join('\n') : String(part.content ?? '');
  return { ...part, content: text.slice(0, MAX_TOOL_TEXT) };
};

export async function transcriptEvents(projectDir, id) {
  const events = [];
  const lines = createInterface({ input: createReadStream(path.join(sessionsDir(projectDir), `${path.basename(id)}.jsonl`)), crlfDelay: Infinity });
  for await (const line of lines) {
    const [entry] = parseLines(line);
    if (!entry || entry.isSidechain || entry.isMeta || entry.isCompactSummary) continue;
    if (entry.type === 'assistant') events.push({ type: 'assistant', message: { ...entry.message, content: (entry.message?.content ?? []).filter((part) => !String(part?.type).includes('thinking')) } });
    if (entry.type !== 'user') continue;
    const content = entry.message?.content;
    const prompt = promptText(content);
    if (prompt) events.push(...(events.length ? [IDLE] : []), { type: 'user_prompt', text: prompt, images: [], replayed: true });
    else if (Array.isArray(content)) events.push({ type: 'user', message: { content: content.map(slimToolResult) } });
  }
  return events.length ? [...events, IDLE] : events;
}
