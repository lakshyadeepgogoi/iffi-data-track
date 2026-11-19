import { useEffect, useState } from 'react';
import { useDesk } from '../state/DeskContext.jsx';
import { SHEET_ACTORS, shortDept } from '../lib/guests.js';
import { ago, cn } from '../lib/utils.js';
import { Spinner } from './ui.jsx';

const KINDS = [['all', 'Everything'], ['desk', 'Desk actions'], ['sheet', 'Sheet2 changes']];

const ICONS = [
  [/^COLUMN MISSING$/, '!', 'bg-bad'],
  [/^WIPE LOOP$/, '!', 'bg-bad'],
  [/^RESYNCED$/, '⟳', 'bg-pri'],
  [/^BACKUP$/, '⛁', 'bg-noid'],
  [/^UNDO/, '↺', 'bg-noid'],
  [/DELIVER/, '✓', 'bg-del'],
  [/PRINT/, 'P', 'bg-pri'],
  [/NEW GUEST|BACK IN SHEET/, '+', 'bg-gold'],
  [/ID ASSIGNED/, '#', 'bg-ready'],
  [/UPDATED/, '✎', 'bg-[#6b5e4f]'],
  [/REMOVED/, '−', 'bg-bad'],
  [/RESTORED/, '⟲', 'bg-brand'],
  [/NOTE/, '✎', 'bg-gold'],
  [/EXPORT/, '⇩', 'bg-brand'],
];
const iconFor = (action) => {
  const hit = ICONS.find(([re]) => re.test(action));
  return hit ? [hit[1], hit[2]] : ['•', 'bg-noid'];
};
const sentence = (action) =>
  ({
    PRINTED: 'marked printed', DELIVERED: 'handed over', 'UNDO PRINTED': 'undid printed', 'UNDO DELIVERED': 'undid delivery',
    'NEW GUEST': 'new registration', 'ID ASSIGNED': 'User ID assigned to', UPDATED: 'details changed for', REMOVED: 'row removed for',
    'BACK IN SHEET': 'row back for', NOTE: 'noted on', EXPORT: 'exported', RESTORED: 'restored', 'TRACKING STARTED': 'started tracking',
    'COLUMN MISSING': 'can’t find the', RESYNCED: 're-read Sheet2:', 'WIPE LOOP': 'stopped a wipe loop:', BACKUP: 'backed up',
  })[action] || action.toLowerCase();

export default function Activity({ onOpen }) {
  const { api, statusTick, byKey } = useDesk();
  const [kind, setKind] = useState('all');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api('apiActivity', 100, kind)
      .then((r) => { if (alive) { setRows(r); setErr(''); } })
      .catch((e) => alive && setErr(String(e.message || e)));
    return () => { alive = false; };
  }, [api, statusTick, kind]);

  return (
    <section className="lg:mx-auto lg:max-w-4xl">
      <div className="mb-2.5 flex rounded-xl bg-[#e9e3da] p-[3px] lg:max-w-md">
        {KINDS.map(([k, t]) => (
          <button
            key={k}
            onClick={() => { setKind(k); setRows(null); }}
            className={cn('flex-1 rounded-[9px] py-2 text-[13px] font-bold', kind === k ? 'bg-white text-ink shadow-card' : 'text-mute')}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl bg-white shadow-card">
        {err && <div className="px-4 py-8 text-center text-mute">Couldn’t load activity ({err})</div>}
        {!err && !rows && <Spinner />}
        {rows && !rows.length && <div className="px-4 py-8 text-center text-mute">Nothing here yet. Changes from phones and from Sheet2 appear live.</div>}
        {rows?.map(([t, who, action, key, uid, name, dept, details], i) => {
          const [icon, color] = iconFor(action);
          const fromSheet = SHEET_ACTORS.includes(who);
          const clickable = !!(key && byKey[key]);
          return (
            <button
              key={`${t}-${i}-${key}`}
              disabled={!clickable}
              onClick={() => onOpen(key)}
              className={cn('flex w-full gap-2.5 px-3 py-2.5 text-left text-[13.5px]', i && 'border-t border-line')}
            >
              <span className={cn('grid size-[30px] flex-none place-items-center rounded-[9px] text-[13px] font-extrabold text-white', color)}>{icon}</span>
              <div className="min-w-0">
                <div>
                  <b>{fromSheet ? (who === 'System' ? 'System' : 'Sheet2') : who}</b> {sentence(action)} <b>{name}</b>
                  {uid ? <span className="text-mute"> #{uid}</span> : null}
                </div>
                {details && <div className="truncate text-xs text-ink/80">{details}</div>}
                <div className="text-xs text-mute">{ago(t)}{dept ? ` · ${shortDept(dept)}` : ''}</div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
