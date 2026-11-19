import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useDesk } from '../state/DeskContext.jsx';
import { ISSUES, STAGES, filterGuests, isToday, shortDept, stage } from '../lib/guests.js';
import { cn } from '../lib/utils.js';
import { Avatar, ConfirmDialog, Pill } from './ui.jsx';

const PAGE = 120;

export default function GuestList({ filters: f, setFilters, onOpen }) {
  const { guests, status, byKey, setStatus, api, notify } = useDesk();
  const [limit, setLimit] = useState(PAGE);
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null);

  useEffect(() => setLimit(PAGE), [f]);
  const set = (patch) => setFilters({ ...f, ...patch });

  const counts = useMemo(() => {
    const c = { all: guests.length, hasuid: 0, ready: 0, pri: 0, del: 0, noid: 0, issues: 0, new: 0 };
    guests.forEach((g) => {
      c[stage(g, status)]++;
      if (g.uid) c.hasuid++;
      if (g.issues.length) c.issues++;
      if (isToday(g.firstSeen)) c.new++;
    });
    return c;
  }, [guests, status]);
  const depts = useMemo(() => [...new Set(guests.map((g) => g.dept))].sort(), [guests]);
  const cards = useMemo(() => [...new Set(guests.map((g) => g.card))].sort(), [guests]);
  const list = useMemo(() => filterGuests(guests, status, f), [guests, status, f]);

  const chips = [['all', 'All'], ['ready', 'To print'], ['pri', 'To hand over'], ['del', 'Delivered'], ['noid', 'No ID'], ['issues', 'Issues']];
  if (f.st === 'hasuid') chips.splice(1, 0, ['hasuid', 'Has ID']);
  if (counts.new || f.st === 'new') chips.push(['new', 'New today']);

  const toggle = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const exitSel = () => { setSelMode(false); setSel(new Set()); };
  const allOn = list.length > 0 && list.every((g) => sel.has(g.key));
  const selectAll = () => setSel((s) => { const n = new Set(s); list.forEach((g) => (allOn ? n.delete(g.key) : n.add(g.key))); return n; });

  function askBulk(field) {
    const keys = [...sel];
    if (!keys.length) return notify('Select guests first');
    const noid = keys.filter((k) => !byKey[k]?.uid).length;
    setConfirm({
      title: `Mark ${keys.length} guest${keys.length > 1 ? 's' : ''} ${field}?`,
      body: noid ? `${noid} of them have no User ID.` : '',
      onConfirm: () => { setConfirm(null); exitSel(); setStatus(keys, field, true); },
    });
  }

  async function exportSel() {
    const keys = [...sel];
    if (!keys.length) return notify('Select guests first');
    const label = f.dept ? shortDept(f.dept) : STAGES[f.st]?.label || (f.st === 'new' ? 'New today' : '');
    try {
      notify('Creating export tab…');
      const r = await api('apiExport', keys, label);
      notify(`${r.count} guests → tab “${r.name}”`, r.url ? { label: 'Open', fn: () => window.open(r.url, '_blank') } : null);
    } catch (e) {
      notify('Export failed: ' + (e.message || e));
    }
  }

  const select = 'min-w-0 flex-1 rounded-xl border border-line bg-white px-2.5 py-2 text-[13.5px]';

  return (
    <section>
      <div className="sticky top-[58px] z-10 -mx-3 bg-paper px-3 pt-0.5 pb-2 lg:-mx-6 lg:px-6 lg:pt-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 shadow-card">
          <Search size={18} className="text-mute" />
          <input
            type="search"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Name, phone, email or User ID"
            className="flex-1 bg-transparent py-3 text-base outline-none"
            autoComplete="off"
          />
          {f.q && <button onClick={() => set({ q: '' })} aria-label="Clear"><X size={18} className="text-mute" /></button>}
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pt-2 pb-0.5">
          {chips.map(([k, t]) => (
            <button
              key={k}
              onClick={() => set({ st: k })}
              className={cn('rounded-full border px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap', f.st === k ? 'border-ink bg-ink text-white' : 'border-line bg-white text-mute')}
            >
              {t}<b className="ml-1 opacity-75">{counts[k]}</b>
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5 lg:max-w-3xl">
          <select className={select} value={f.dept} onChange={(e) => set({ dept: e.target.value })}>
            <option value="">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{shortDept(d)}</option>)}
          </select>
          <select className={select} value={f.card} onChange={(e) => set({ card: e.target.value })}>
            <option value="">All card types</option>
            {cards.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className={select} value={f.issue} onChange={(e) => set({ issue: e.target.value })}>
            <option value="">Any data</option>
            {Object.entries(ISSUES).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="mx-0.5 my-1.5 flex items-center justify-between text-[12.5px] text-mute">
        <span>{list.length} guest{list.length === 1 ? '' : 's'}</span>
        <button className="px-0.5 py-1 text-[13px] font-bold text-brand" onClick={() => (selMode ? exitSel() : setSelMode(true))}>
          {selMode ? 'Done' : 'Select'}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-card">
        {list.length > 0 && (
          <div aria-hidden="true" className="hidden items-center gap-3 border-b border-line bg-sand/60 px-4 py-2 text-[11.5px] font-bold tracking-wider text-mute uppercase lg:flex">
            {selMode && <span className="w-[22px]" />}
            <span className="w-10" />
            <span className="flex-1">Guest</span>
            <span className="w-44">Card type</span>
            <span className="w-36">Mobile</span>
            <span className="w-20">Sheet2</span>
            <span className="w-24 text-right">Status</span>
          </div>
        )}
        {!list.length && <div className="px-4 py-8 text-center text-mute">No guests match.</div>}
        {list.slice(0, limit).map((g, i) => {
          const sg = stage(g, status);
          return (
            <button
              key={g.key}
              onClick={() => (selMode ? toggle(g.key) : onOpen(g.key))}
              className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-[#faf7f2] lg:px-4 lg:hover:bg-[#faf7f2]', i && 'border-t border-line')}
            >
              {selMode && (
                <span className={cn('grid size-[22px] flex-none place-items-center rounded-[7px] border-2 text-white', sel.has(g.key) ? 'border-brand bg-brand' : 'border-[#cfc8bd]')}>
                  {sel.has(g.key) && '✓'}
                </span>
              )}
              <Avatar g={g} stage={sg} />
              <span className="min-w-0 flex-1">
                <div className="truncate font-semibold">{g.name}</div>
                <div className="truncate text-[12.5px] text-mute">
                  {g.uid ? `#${g.uid}` : <span className="font-bold text-bad">no ID</span>} · {shortDept(g.dept)}
                  {g.issues.length > 0 && sg !== 'noid' && <span className="font-bold text-bad"> · ⚠</span>}
                </div>
              </span>
              <span className={cn('hidden w-44 truncate text-[13px] lg:block', g.cardFlag ? 'text-bad' : 'text-ink/80')}>{g.card}</span>
              <span className="hidden w-36 truncate text-[13px] text-mute tabular-nums lg:block">{g.mobile || '—'}</span>
              <span className="hidden w-20 text-[13px] text-mute tabular-nums lg:block">Row {g.row}</span>
              <span className="lg:flex lg:w-24 lg:justify-end"><Pill stage={sg} /></span>
            </button>
          );
        })}
        {list.length > limit && (
          <button className="block w-full border-t border-line p-3.5 font-bold text-brand" onClick={() => setLimit((l) => l + 200)}>
            Show {Math.min(200, list.length - limit)} more of {list.length - limit}
          </button>
        )}
      </div>

      {selMode && (
        <div className="fixed inset-x-0 bottom-[66px] z-25 flex justify-center px-2.5 pb-[env(safe-area-inset-bottom)] lg:bottom-6">
          <div className="flex w-full max-w-[740px] flex-wrap items-center gap-1.5 rounded-2xl bg-ink p-2.5 text-white shadow-2xl">
            <div className="min-w-[90px] flex-1 pl-1 font-bold">{sel.size} selected</div>
            <BulkBtn onClick={selectAll}>{allOn ? 'None' : 'All'}</BulkBtn>
            <BulkBtn className="bg-pri" onClick={() => askBulk('printed')}>Printed</BulkBtn>
            <BulkBtn className="bg-del" onClick={() => askBulk('delivered')}>Delivered</BulkBtn>
            <BulkBtn onClick={exportSel}>Export</BulkBtn>
            <BulkBtn onClick={exitSel} aria-label="Close">✕</BulkBtn>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
    </section>
  );
}

const BulkBtn = ({ className, ...p }) => (
  <button {...p} className={cn('rounded-lg bg-white/15 px-3 py-2 text-[13px] font-semibold', className)} />
);
