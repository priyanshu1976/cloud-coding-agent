import type { ChatSummary } from "@agent/shared";

const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const PLUS = "M12 5v14M5 12h14";
const TRASH = "M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v6M14 11v6";
const GEAR = "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z";

export function Sidebar(props: {
  chats: ChatSummary[];
  activeId?: string;
  busy: boolean; // a run is in progress: switching or deleting chats waits
  open: boolean; // mobile drawer
  modelLabel: string;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (chat: ChatSummary) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const { chats, activeId, busy, open } = props;
  return (
    <>
      {open && <div className="scrim" onClick={props.onClose} />}
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="brand">Cloud Agent</div>
        <button className="new-chat" onClick={props.onNew} disabled={busy}>
          <Icon d={PLUS} /> New chat
        </button>

        <nav className="chat-list" aria-label="Chats">
          {chats.length === 0 && <p className="empty">No chats yet</p>}
          {chats.map((c) => (
            <div key={c.id} className={`chat-row${c.id === activeId ? " active" : ""}`}>
              <button className="chat-title" disabled={busy && c.id !== activeId} onClick={() => props.onOpen(c.id)} title={c.title}>
                {c.title}
              </button>
              <button
                className="chat-delete"
                title="Delete chat"
                aria-label={`Delete ${c.title}`}
                disabled={busy && c.id === activeId}
                onClick={() => props.onDelete(c)}
              >
                <Icon d={TRASH} />
              </button>
            </div>
          ))}
        </nav>

        <button className="settings-btn" onClick={props.onSettings}>
          <Icon d={GEAR} />
          <span>
            Settings
            <small>{props.modelLabel}</small>
          </span>
        </button>
      </aside>
    </>
  );
}
