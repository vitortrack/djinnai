import LineSidebar from './components/LineSidebar.jsx';
import { CONTEXT_WARNING, thousands, when } from './lib/format.js';

function Meta({ session }) {
  return (
    <>
      {when(session.updatedAt)} · <span data-warn={session.context > CONTEXT_WARNING ? '' : undefined}>{thousands(session.context)} tokens</span>
      {session.inUse ? ' · aberta em outro lugar' : ''}
    </>
  );
}

export default function Sidebar({ sessions, version, busy, onNew, onResume }) {
  const items = sessions.map((session) => ({ key: session.id, title: session.title, label: session.title, meta: <Meta session={session} /> }));
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        DjinnAI <span>v{version}</span>
      </div>
      <button type="button" className="sidebar__new" disabled={busy} onClick={onNew}>+ Nova conversa</button>
      <div className="sidebar__label">Conversas deste projeto</div>
      <div className="sidebar__list" data-busy={busy ? '' : undefined}>
        {sessions.length === 0 ? <p className="sidebar__hint">As conversas aparecem aqui depois da primeira mensagem.</p> : null}
        <LineSidebar
          items={items}
          activeIndex={sessions.findIndex((session) => session.current)}
          onItemClick={(_, item) => onResume(item.key)}
          showIndex={false}
          showMarker={false}
          maxShift={6}
          itemGap={14}
          fontSize={0.86}
          accentColor="#b39dff"
          textColor="#e4e4e7"
          markerColor="#8b8b94"
        />
      </div>
      <p className="sidebar__hint">Cada mensagem relê a conversa inteira. Mudou de assunto? Comece uma nova; as antigas continuam aqui.</p>
    </aside>
  );
}
