// The whole page (blueprint 12.7 to 12.9): the state demos, the top bar, the main area and the
// modals. The page holds the picked user in memory only (DD-08), changes the list only from a
// confirmed answer (DD-17), and never reads the list again except on a pick or a Retry.

import { useEffect, useRef, useState } from 'react';

import { CONFIRMED, INVALID, REFUSED, request } from './api.js';
import { Icon } from './icons.jsx';
import {
  NAME_MAX_LENGTH,
  NAME_REQUIRED,
  NAME_TOO_LONG,
  nameLength,
  nameProblem,
  trimName,
} from './names.js';

// The seeded users are a constant of the client (DD-03, DD-07): the switcher must list them
// before any identity exists to ask the API with.
const USERS = [
  { id: 1, name: 'Ada Admin', role: 'admin' },
  { id: 2, name: 'Mia Member', role: 'member' },
  { id: 3, name: 'Sam Member', role: 'member' },
];
const MEMBERS = USERS.filter((user) => user.role === 'member');

// How long Show loading shows the list indicator (D-21).
const LOADING_DEMO_MS = 900;

const STATUS = {
  available: { className: 'available', text: () => 'Available' },
  on_loan: { className: 'loan', text: (item) => `On loan – ${item.borrowerName}` },
  out_of_service: { className: 'out', text: () => 'Out of service' },
};

function IconButton({ testId, label, title = label, icon, tone, onClick }) {
  return (
    <button
      type="button"
      className={tone}
      data-testid={testId}
      title={title}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

/** One of the four modals. Focus moves to its first button when it opens (DD-19). */
function Modal({ testId, title, body, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current?.querySelector('button')?.focus();
  }, []);
  return (
    <div className="overlay">
      <div
        ref={dialog}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-body"
        data-testid={testId}
      >
        <h3 id="modal-title" data-testid="modal-title">
          {title}
        </h3>
        <p id="modal-body" data-testid="modal-body">
          {body}
        </p>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  // The real list: 'idle' before a pick, then 'loading', 'ready' or 'failed'.
  const [list, setList] = useState({ status: 'idle', items: [] });
  // What a state demo shows in its place: 'real', 'loading' or 'empty' (D-21).
  const [view, setView] = useState('real');
  // The ids of the rows whose action is in progress.
  const [busyRows, setBusyRows] = useState({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [addMessage, setAddMessage] = useState('');
  const [modal, setModal] = useState(null);

  // Every pick starts a new session of the page; an answer to a request made in an earlier one
  // is dropped, so a slow answer cannot change the list another user is looking at.
  const session = useRef(0);
  // The Show loading demo in force; a newer demo or a pick cancels the older one's timer.
  const demo = useRef(0);
  // Read before an Add, so that a second Enter in the same frame cannot send a second Add.
  const addInProgress = useRef(false);
  const modalCount = useRef(0);

  const openModal = (content) => {
    modalCount.current += 1;
    setModal({ ...content, key: modalCount.current });
  };
  const closeModal = () => setModal(null);
  const retryModal = () => {
    const retry = modal.retry;
    setModal(null);
    if (retry) retry();
  };

  /** Open the modal an unsuccessful answer calls for, with Retry repeating `again`. */
  const showFailure = (outcome, again) => {
    if (outcome === REFUSED) openModal({ kind: 'access-denied' });
    else openModal({ kind: 'api-failure', retry: again });
  };

  const fetchList = (actor) => {
    const mine = session.current;
    setList({ status: 'loading', items: [] });
    request(actor, 'GET', '/equipment').then(({ outcome, data }) => {
      if (mine !== session.current) return;
      if (outcome === CONFIRMED && Array.isArray(data)) {
        setList({ status: 'ready', items: data });
        return;
      }
      setList({ status: 'failed', items: [] });
      showFailure(outcome, () => fetchList(actor));
    });
  };

  const pick = (event) => {
    const picked = USERS.find((each) => String(each.id) === event.target.value);
    if (picked === undefined) return;
    session.current += 1;
    demo.current += 1;
    addInProgress.current = false;
    setUser(picked);
    setView('real');
    setBusyRows({});
    setAdding(false);
    setDraft('');
    setAddMessage('');
    setModal(null);
    fetchList(picked);
  };

  /** Borrow, Return, Delete, Mark out of service or Restore on one row (REQ-012). */
  const act = (item, method, route, body) => {
    const actor = user;
    const mine = session.current;
    setBusyRows((busy) => ({ ...busy, [item.id]: true }));
    request(actor, method, route, body).then(({ outcome, data }) => {
      if (mine !== session.current) return;
      // The loader goes in the same render that opens a modal, so no loader shows beside it.
      setBusyRows((busy) => {
        const still = { ...busy };
        delete still[item.id];
        return still;
      });
      if (outcome === CONFIRMED) {
        setList((now) => ({
          ...now,
          items:
            method === 'DELETE'
              ? now.items.filter((each) => each.id !== item.id)
              : now.items.map((each) => (each.id === item.id ? data : each)),
        }));
        return;
      }
      showFailure(outcome, () => act(item, method, route, body));
    });
  };

  // A member borrows for themselves and names nobody; an admin names the member chosen.
  const borrow = (item, member) => {
    const body = member === undefined ? undefined : { borrowerId: member.id };
    act(item, 'POST', `/equipment/${item.id}/borrow`, body);
  };
  const giveBack = (item) => act(item, 'POST', `/equipment/${item.id}/return`);
  const markOutOfService = (item) => act(item, 'POST', `/equipment/${item.id}/out-of-service`);
  const restore = (item) => act(item, 'POST', `/equipment/${item.id}/restore`);
  const remove = (item) => act(item, 'DELETE', `/equipment/${item.id}`);

  /** Send an Add of a name that has passed the check (blueprint 12.7, D-26). */
  const sendAdd = (name) => {
    const actor = user;
    const mine = session.current;
    addInProgress.current = true;
    setAdding(true);
    request(actor, 'POST', '/equipment', { name }).then(({ outcome, data }) => {
      if (mine !== session.current) return;
      addInProgress.current = false;
      setAdding(false);
      if (outcome === CONFIRMED) {
        setList((now) => ({ ...now, items: [...now.items, data] }));
        // A confirmed Add ends the Show empty list view and shows the real list.
        setView((now) => (now === 'empty' ? 'real' : now));
        setDraft('');
        return;
      }
      if (outcome === INVALID) {
        setAddMessage(nameLength(name) > NAME_MAX_LENGTH ? NAME_TOO_LONG : NAME_REQUIRED);
        return;
      }
      showFailure(outcome, () => sendAdd(name));
    });
  };

  const submitAdd = () => {
    // While an Add is in progress, Enter and the Add icon do nothing at all (D-20).
    if (addInProgress.current) return;
    const name = trimName(draft);
    const problem = nameProblem(name);
    setAddMessage(problem ?? '');
    if (problem === null) sendAdd(name);
  };

  const showLoadingDemo = () => {
    demo.current += 1;
    const mine = demo.current;
    setView('loading');
    globalThis.setTimeout(() => {
      if (mine === demo.current) setView('real');
    }, LOADING_DEMO_MS);
  };
  const showEmptyDemo = () => {
    demo.current += 1;
    setView('empty');
  };

  const isAdmin = user?.role === 'admin';

  const renderRow = (item) => {
    const status = STATUS[item.status];
    const controls = [];
    if (item.status === 'available') {
      controls.push(
        <IconButton
          key="borrow"
          testId="btn-borrow"
          label="Borrow"
          icon="borrow"
          tone="primary"
          onClick={() => (isAdmin ? openModal({ kind: 'borrower', item }) : borrow(item))}
        />,
      );
      if (isAdmin) {
        controls.push(
          <IconButton
            key="out-of-service"
            testId="btn-out-of-service"
            label="Mark out of service"
            icon="outOfService"
            onClick={() => markOutOfService(item)}
          />,
        );
      }
    }
    if (item.status === 'on_loan' && (isAdmin || item.borrowerId === user.id)) {
      controls.push(
        <IconButton
          key="return"
          testId="btn-return"
          label="Return"
          icon="return"
          tone="primary"
          onClick={() => giveBack(item)}
        />,
      );
    }
    if (item.status === 'out_of_service' && isAdmin) {
      controls.push(
        <IconButton
          key="restore"
          testId="btn-restore"
          label="Restore"
          icon="restore"
          tone="primary"
          onClick={() => restore(item)}
        />,
      );
    }
    if (item.status !== 'on_loan' && isAdmin) {
      controls.push(
        <IconButton
          key="delete"
          testId="btn-delete"
          label="Delete"
          icon="cross"
          tone="danger"
          onClick={() => openModal({ kind: 'confirm-delete', item })}
        />,
      );
    }
    return (
      <div key={item.id} className="card row" data-testid="row" data-item-id={item.id}>
        <span className="info">
          <span className="name" data-testid="row-name">
            {item.name}
          </span>
          <span className={`tag ${status?.className ?? ''}`} data-testid="row-status">
            {status ? status.text(item) : item.status}
          </span>
        </span>
        <span className="act">
          {busyRows[item.id] ? <span className="spin" data-testid="row-loader" /> : controls}
        </span>
      </div>
    );
  };

  const addPanel = (
    <>
      <h2>Add equipment</h2>
      <div className="card add" data-testid="add-card">
        <div className="line">
          <input
            type="text"
            data-testid="add-input"
            placeholder="Equipment name, then press Enter"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitAdd();
              }
            }}
          />
          {adding ? (
            <span className="spin" data-testid="add-loader" />
          ) : (
            <IconButton
              testId="btn-add"
              label="Add equipment"
              icon="plus"
              tone="primary"
              onClick={submitAdd}
            />
          )}
        </div>
        {addMessage !== '' && (
          <div className="note" role="alert" data-testid="add-validation">
            {addMessage}
          </div>
        )}
      </div>
    </>
  );

  let main = null;
  if (user !== null) {
    const fetching = view === 'real' && list.status === 'loading';
    if (view === 'loading' || fetching) {
      main = (
        <div className="card muted" data-testid="list-indicator">
          <span className="spin" />
          Loading equipment{'…'}
        </div>
      );
    } else if (view === 'empty' || list.status === 'ready') {
      const items = view === 'empty' ? [] : list.items;
      main = (
        <>
          {isAdmin && addPanel}
          {items.length > 0 ? (
            <section data-testid="equipment-list">
              <h2>Equipment</h2>
              {items.map(renderRow)}
            </section>
          ) : (
            <>
              <h2>Equipment</h2>
              <div className="card muted" data-testid="empty-state">
                No equipment yet
              </div>
            </>
          )}
        </>
      );
    }
    // A failed or refused list fetch shows nothing behind its modal (GAP-1 leaves this open).
  }

  const renderModal = () => {
    if (modal.kind === 'borrower') {
      return (
        <Modal
          key={modal.key}
          testId="modal-borrower"
          title="Who is borrowing?"
          body={`Choose a member for ${modal.item.name}.`}
        >
          <div className="buttons members">
            {MEMBERS.map((member) => (
              <button
                key={member.id}
                type="button"
                data-testid={`member-button-${member.id}`}
                title={`Borrow for ${member.name}`}
                aria-label={`Borrow for ${member.name}`}
                onClick={() => {
                  closeModal();
                  borrow(modal.item, member);
                }}
              >
                <Icon name="user" />
                {member.name}
              </button>
            ))}
          </div>
          <div className="buttons">
            <IconButton testId="btn-close" label="Close" icon="cross" onClick={closeModal} />
          </div>
        </Modal>
      );
    }
    if (modal.kind === 'confirm-delete') {
      return (
        <Modal
          key={modal.key}
          testId="modal-confirm-delete"
          title={`Delete ${modal.item.name}?`}
          body="This removes the equipment from the list."
        >
          <div className="buttons">
            <IconButton testId="btn-cancel" label="Cancel" icon="cross" onClick={closeModal} />
            <IconButton
              testId="btn-confirm"
              label="Confirm delete"
              icon="check"
              tone="primary"
              onClick={() => {
                closeModal();
                remove(modal.item);
              }}
            />
          </div>
        </Modal>
      );
    }
    if (modal.kind === 'api-failure') {
      return (
        <Modal
          key={modal.key}
          testId="modal-api-failure"
          title="Request failed"
          body="The server returned an error. Nothing was changed."
        >
          <div className="buttons">
            <IconButton testId="btn-close" label="Close" icon="cross" onClick={closeModal} />
            <IconButton
              testId="btn-retry"
              label="Retry"
              icon="retry"
              tone="primary"
              onClick={retryModal}
            />
          </div>
        </Modal>
      );
    }
    return (
      <Modal
        key={modal.key}
        testId="modal-access-denied"
        title="Access denied"
        body="You do not have permission"
      >
        <div className="buttons">
          <IconButton testId="btn-ok" label="OK" icon="check" tone="primary" onClick={closeModal} />
        </div>
      </Modal>
    );
  };

  return (
    <>
      {/* While a modal is open the page behind it can be neither reached nor operated. */}
      <div inert={modal === null ? undefined : ''}>
        {user !== null && (
          <div className="wrap">
            <div className="demo" data-testid="state-demos">
              <b>State demos:</b>
              <span className="label">Loading</span>
              <IconButton
                testId="demo-loading"
                title="Loading"
                label="Show loading"
                icon="loading"
                onClick={showLoadingDemo}
              />
              <span className="label">Empty</span>
              <IconButton
                testId="demo-empty"
                title="Empty list"
                label="Show empty list"
                icon="empty"
                onClick={showEmptyDemo}
              />
              <span className="label">API failure</span>
              <IconButton
                testId="demo-api-failure"
                title="API failure"
                label="Show API failure"
                icon="failure"
                onClick={() => openModal({ kind: 'api-failure', retry: null })}
              />
              <span className="label">Access denied</span>
              <IconButton
                testId="demo-access-denied"
                title="Access denied"
                label="Show access denied"
                icon="denied"
                onClick={() => openModal({ kind: 'access-denied' })}
              />
            </div>
          </div>
        )}
        <header data-testid="top-bar">
          <div className="wrap">
            <h1>Shared Equipment</h1>
            <label className="who">
              Acting as
              <select
                data-testid="switcher"
                value={user === null ? '' : String(user.id)}
                onChange={pick}
              >
                {user === null && (
                  <option value="" disabled data-testid="switcher-placeholder">
                    Choose a user
                  </option>
                )}
                {USERS.map((each) => (
                  <option key={each.id} value={each.id} data-testid={`switcher-option-${each.id}`}>
                    {`${each.name} (${each.role})`}
                  </option>
                ))}
              </select>
              {user !== null && (
                <span className="role" data-testid="role-badge">
                  {user.role}
                </span>
              )}
            </label>
          </div>
        </header>
        <main className="wrap">{main}</main>
      </div>
      {modal !== null && renderModal()}
    </>
  );
}
