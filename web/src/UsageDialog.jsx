import { useEffect, useRef } from 'react';
import { isNearLimit, limitLabel, resetsAt, scopeName, shortLabel } from './lib/limits.js';

export function PlanMeter({ limits, onOpen, ...rest }) {
  return (
    <button type="button" className="app__plan" onClick={onOpen} {...rest}>
      {limits.map((limit) => (
        <span key={`${limit.kind}-${scopeName(limit)}`} data-warn={isNearLimit(limit) ? '' : undefined}>
          {shortLabel(limit)} {limit.percent}%
        </span>
      ))}
    </button>
  );
}

const tokens = (n) => n.toLocaleString('pt-BR');
const totalOf = (row) => row.input + row.cacheRead + row.cacheWrite + row.output;

function Limits({ data }) {
  if (data.limits === null) return <p className="usage__note">Não consegui ler os limites do plano agora. Confira se o Claude Code está logado e abra o /usage de novo.</p>;
  if (data.limits.length === 0) return <p className="usage__note">O seu plano não informa limites de uso.</p>;
  return data.limits.map((limit) => (
    <div key={`${limit.kind}-${scopeName(limit)}`} className="usage__limit">
      <div className="usage__row">
        <span>{limitLabel(limit)}</span>
        <b data-warn={isNearLimit(limit) ? '' : undefined}>{limit.percent}%</b>
      </div>
      <div className="usage__bar"><div style={{ width: `${Math.min(limit.percent, 100)}%` }} data-warn={isNearLimit(limit) ? '' : undefined} /></div>
      {limit.resets_at ? <div className="usage__note">Renova {resetsAt(limit.resets_at)}</div> : null}
    </div>
  ));
}

function Models({ models }) {
  if (models.length === 0) return <p className="usage__note">Nenhuma resposta do agente desde que o DjinnAI abriu.</p>;
  const sum = models.reduce((acc, row) => acc + totalOf(row), 0);
  return (
    <table className="usage__table">
      <thead>
        <tr><th>Modelo</th><th>% do uso</th><th>Entrada</th><th>Cache lido</th><th>Cache gravado</th><th>Saída</th><th>Custo equiv.</th></tr>
      </thead>
      <tbody>
        {[...models].sort((a, b) => totalOf(b) - totalOf(a)).map((row) => (
          <tr key={row.model}>
            <td>{row.model}{row.agent === 'ollama' ? <span className="usage__tag">Ollama</span> : null}</td>
            <td>{sum ? Math.round((totalOf(row) / sum) * 100) : 0}%</td>
            <td>{tokens(row.input)}</td>
            <td>{tokens(row.cacheRead)}</td>
            <td>{tokens(row.cacheWrite)}</td>
            <td>{tokens(row.output)}</td>
            <td>{row.agent === 'ollama' ? '—' : `US$ ${row.cost.toFixed(2)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function UsageDialog({ data, error, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="usage" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <div className="usage__head">
        <b>Uso{data?.subscription ? ` · plano ${data.subscription}` : ''}</b>
        <button type="button" className="app__new" onClick={() => ref.current.close()}>Fechar</button>
      </div>
      {error ? <div className="turn__error">{error}</div> : null}
      {!data && !error ? <p className="usage__note">Consultando o Claude Code…</p> : null}
      {data ? (
        <>
          <h3>Limites do plano</h3>
          <Limits data={data} />
          <h3>Por modelo, desde que o DjinnAI abriu</h3>
          <Models models={data.models} />
          <p className="usage__note">
            Na assinatura o que conta são os percentuais acima; o custo é só o equivalente em preço de API, para comparar os modelos.
            Modelos do Ollama não entram nos limites do Claude.
          </p>
        </>
      ) : null}
    </dialog>
  );
}
