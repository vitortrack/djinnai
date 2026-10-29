export const CONTEXT_WARNING = 100000;

export const thousands = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const DAY_MS = 24 * 60 * 60 * 1000;

export function when(ms, now = Date.now()) {
  const date = new Date(ms);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (ms >= startOfToday) return `hoje ${time}`;
  if (ms >= startOfToday - DAY_MS) return `ontem ${time}`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
