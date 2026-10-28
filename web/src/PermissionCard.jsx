import { useState } from 'react';
import { toHtml } from './lib/markdown.js';
import { toolTarget } from './lib/turns.js';

const STATUS_LABELS = { allow: 'Permitido', deny: 'Recusado', cancelled: 'Cancelado' };
const stripAnsi = (text) => String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const head = (text, lines = 30) => {
  const all = String(text ?? '').split('\n');
  return all.length > lines ? `${all.slice(0, lines).join('\n')}\n… (+${all.length - lines} linhas)` : all.join('\n');
};

function ToolPreview({ name, input }) {
  if (name === 'Bash') return <pre className="ask__code">{input.command}</pre>;
  if (name === 'Edit') {
    return (
      <pre className="ask__code">
        {head(input.old_string, 15).split('\n').map((line, i) => <div key={`o${i}`} className="ask__del">- {line}</div>)}
        {head(input.new_string, 15).split('\n').map((line, i) => <div key={`n${i}`} className="ask__add">+ {line}</div>)}
      </pre>
    );
  }
  if (name === 'Write') return <pre className="ask__code">{head(input.content)}</pre>;
  return <pre className="ask__code">{head(JSON.stringify(input, null, 2), 20)}</pre>;
}

function Questions({ input, onAnswer }) {
  const [picked, setPicked] = useState({});
  const [other, setOther] = useState({});
  const toggle = (q, label) => setPicked((all) => {
    const current = all[q.question] ?? [];
    if (!q.multiSelect) return { ...all, [q.question]: [label] };
    return { ...all, [q.question]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label] };
  });
  const answers = Object.fromEntries(input.questions.map((q) => [q.question, other[q.question]?.trim() || (picked[q.question] ?? []).join(', ')]));
  const complete = Object.values(answers).every(Boolean);

  return (
    <>
      {input.questions.map((q) => (
        <div key={q.question} className="ask__question">
          <div className="ask__question-text">{q.question}</div>
          <div className="ask__options">
            {q.options.map((option) => (
              <button
                key={option.label}
                type="button"
                className="ask__option"
                data-on={(picked[q.question] ?? []).includes(option.label) ? '' : undefined}
                onClick={() => toggle(q, option.label)}
              >
                <b>{option.label}</b>
                {option.description ? <span>{option.description}</span> : null}
              </button>
            ))}
          </div>
          <input
            className="ask__other"
            placeholder="Outra resposta"
            value={other[q.question] ?? ''}
            onChange={(e) => setOther((all) => ({ ...all, [q.question]: e.target.value }))}
          />
        </div>
      ))}
      <div className="ask__actions">
        <button type="button" className="ask__primary" disabled={!complete} onClick={() => onAnswer({ behavior: 'allow', updatedInput: { ...input, answers } })}>Responder</button>
        <button type="button" onClick={() => onAnswer({ behavior: 'deny', message: 'O usuário preferiu não responder.' })}>Pular</button>
      </div>
    </>
  );
}

export default function PermissionCard({ item, root, onAnswer, onApprovePlan }) {
  const { tool_name: name, input = {}, decision_reason: reason, permission_suggestions: suggestions = [], suppress_always_allow_rule: noAlways } = item.request;
  const answered = item.status !== 'pending';
  const answer = (decision) => onAnswer(item.requestId, decision);

  if (answered) {
    return <div className="ask ask--done">{name === 'AskUserQuestion' ? 'Pergunta' : name}: {STATUS_LABELS[item.status] ?? item.status}</div>;
  }

  if (name === 'AskUserQuestion') {
    return (
      <div className="ask">
        <div className="ask__title">O agente tem uma pergunta</div>
        <Questions input={input} onAnswer={answer} />
      </div>
    );
  }

  if (name === 'ExitPlanMode') {
    return (
      <div className="ask">
        <div className="ask__title">Plano pronto para aprovação</div>
        <div className="turn__text ask__plan" dangerouslySetInnerHTML={{ __html: toHtml(input.plan ?? '') }} />
        <div className="ask__actions">
          <button type="button" className="ask__primary" onClick={() => { onApprovePlan(); answer({ behavior: 'allow', updatedInput: input }); }}>Aprovar e editar</button>
          <button type="button" onClick={() => answer({ behavior: 'deny', message: 'O usuário quer continuar planejando. Pergunte o que ajustar.' })}>Continuar planejando</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ask">
      <div className="ask__title">Permitir <b>{name}</b> <span className="turn__target">{toolTarget(input, root)}</span>?</div>
      {reason ? <div className="ask__reason">{stripAnsi(reason)}</div> : null}
      <ToolPreview name={name} input={input} />
      <div className="ask__actions">
        <button type="button" className="ask__primary" onClick={() => answer({ behavior: 'allow', updatedInput: input })}>Permitir</button>
        {suggestions.length > 0 && !noAlways ? (
          <button type="button" onClick={() => answer({ behavior: 'allow', updatedInput: input, updatedPermissions: suggestions })}>Permitir e não perguntar de novo</button>
        ) : null}
        <button type="button" onClick={() => answer({ behavior: 'deny' })}>Recusar</button>
      </div>
    </div>
  );
}
