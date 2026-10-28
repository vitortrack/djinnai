const LIMIT_LABELS = { session: 'Sessão atual (5h)', weekly_all: 'Semana, todos os modelos' };
const SHORT_LABELS = { session: 'sessão', weekly_all: 'semana' };
const WARN_PERCENT = 80;

export const scopeName = (limit) => limit.scope?.model?.display_name ?? 'escopo do plano';

export const limitLabel = (limit) => {
  if (limit.kind === 'weekly_scoped') return `Semana, ${scopeName(limit)}`;
  return LIMIT_LABELS[limit.kind] ?? limit.kind;
};

export const shortLabel = (limit) => SHORT_LABELS[limit.kind] ?? scopeName(limit).toLowerCase();

export const isNearLimit = (limit) => limit.percent >= WARN_PERCENT || limit.severity !== 'normal';

export function relevantLimits(limits, modelName) {
  const scoped = (limits ?? []).filter((limit) => limit.kind === 'weekly_scoped');
  const matching = scoped.filter((limit) => modelName.toLowerCase().includes(scopeName(limit).toLowerCase()));
  return [...(limits ?? []).filter((limit) => limit.kind !== 'weekly_scoped'), ...(matching.length ? matching : scoped)];
}

export const resetsAt = (iso) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
