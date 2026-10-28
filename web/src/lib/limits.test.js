import assert from 'node:assert';
import { isNearLimit, limitLabel, relevantLimits } from './limits.js';

const limit = (kind, percent, model, severity = 'normal') => ({ kind, percent, severity, scope: model ? { model: { display_name: model } } : null });
const limits = [limit('session', 20), limit('weekly_all', 44), limit('weekly_scoped', 70, 'Opus'), limit('weekly_scoped', 10, 'Sonnet')];
const names = (list) => list.map(limitLabel);

assert.deepEqual(names(relevantLimits(limits, 'Opus 4.7')), ['Sessão atual (5h)', 'Semana, todos os modelos', 'Semana, Opus']);
assert.deepEqual(names(relevantLimits(limits, 'Padrão')), ['Sessão atual (5h)', 'Semana, todos os modelos', 'Semana, Opus', 'Semana, Sonnet']);
assert.deepEqual(relevantLimits(null, 'Opus'), []);
assert.equal(isNearLimit(limit('session', 79)), false);
assert.equal(isNearLimit(limit('session', 80)), true);
assert.equal(isNearLimit(limit('session', 30, null, 'warning')), true);
console.log('ok');
