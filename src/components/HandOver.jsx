import { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useDesk } from '../state/DeskContext.jsx';
import { DEFAULT_FILTERS, filterGuests, getSt, isToday, shortDept, stage } from '../lib/guests.js';
import { cn, fmtT } from '../lib/utils.js';
import { Avatar, Button, Card, ConfirmDialog, Pill } from './ui.jsx';

const MAX = 15;
const ORDER = { pri: 0, ready: 1, del: 2, noid: 3 };

/** The desk counter: a guest walks up → find them → hand over the card in one tap. */
export default function HandOver({ onOpen }) {
  const { guests, status, setStatus } = useDesk();
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(null);
  const inputRef = useRef(null);

  const hits = useMemo(() => {
    if (q.trim().length < 2) return [];
    return filterGuests(guests, status, { ...DEFAULT_FILTERS, q })
      .sort((a, b) => ORDER[stage(a, status)] - ORDER[stage(b, status)]);
  }, [guests, status, q]);

  const { waiting, today } = useMemo(() => {
    let waiting = 0;
    const today = [];
    guests.forEach((g) => {
      const s = getSt(status, g.key);
      if (s[0] && !s[3]) waiting++;
      if (s[3] && isToday(s[4])) today.push([g, s]);
    });
    today.sort((a, b) => b[1][4] - a[1][4]);
    return { waiting, today };
  }, [guests, status]);

  const next = () => { setQ(''); inputRef.current?.focus(); };
  const handOver = (g) => { setStatus([g.key], 'delivered', true); next(); };
  const askUnprinted = (g) => setConfirm({
    title: `Hand over to ${g.name}?`,
    body: 'This card is not marked printed yet. Handing it over marks it printed and delivered.',
    confirmLabel: 'Hand over',
    onConfirm: () => { setConfirm(null); handOver(g); },
  });

  return (
    <section>
      <div className="sticky top-[58px] z-10 -mx-3 bg-paper px-3 pt-0.5 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 shadow-card">
          <Search size={18} className="text-mute" />
          <input
            ref={inputRef}
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Guest name, phone, email or User ID"
            className="flex-1 bg-transparent py-3.5 text-[17px] outline-none"
            autoComplete="off"
          />
          {q && <button onClick={next} aria-label="Clear"><X size={18} className="text-mute" /></button>}
        </div>
      </div>

      {q.trim().length >= 2 ? (
        <div className="space-y-2">
          {!hits.length && <Card className="py-8 text-center text-mute">No guest matches “{q}”.</Card>}
          {hits.slice(0, MAX).map((g) => {
            const sg = stage(g, status);
            const s = getSt(status, g.key);
            return (
              <div key={g.key} className="rounded-2xl bg-white p-3 shadow-card">
                <button onClick={() => onOpen(g.key)} className="flex w-full items-center gap-3 text-left">
                  <Avatar g={g} stage={sg} />
                  <span className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{g.name}</div>
                    <div className="truncate text-[12.5px] text-mute">
                      {g.uid ? `#${g.uid}` : 'no ID'} · {shortDept(g.dept)} · {g.card}
                    </div>
                  </span>
                  <Pill stage={sg} />
                </button>
                <div className="mt-2.5">
                  {sg === 'pri' && <Button variant="del" className="w-full" onClick={() => handOver(g)}>Hand over card</Button>}
                  {sg === 'ready' && <Button variant="ghost" className="w-full" onClick={() => askUnprinted(g)}>Not printed yet · hand over anyway</Button>}
                  {sg === 'del' && (
                    <p className="rounded-xl bg-ready/12 px-3 py-2.5 text-[13.5px] font-semibold text-ready">
                      ⚠ Already collected {fmtT(s[4]) || s[8]}{s[5] ? ` · by ${s[5]}` : ''}
                    </p>
                  )}
                  {sg === 'noid' && (
                    <p className="rounded-xl bg-noid/15 px-3 py-2.5 text-[13.5px] font-semibold text-[#5d636b]">
                      No User ID yet, so the card can’t be printed.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {hits.length > MAX && <p className="text-center text-[12.5px] text-mute">{hits.length - MAX} more. Type more of the name or number.</p>}
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Stat n={waiting} label="Printed, waiting for guest" className="text-pri" />
            <Stat n={today.length} label="Handed over today" className="text-del" />
          </div>
          <Card title="Handed over today">
            {!today.length && <p className="py-2 text-sm text-mute">None yet today.</p>}
            {today.slice(0, 30).map(([g, s], i) => (
              <button key={g.key} onClick={() => onOpen(g.key)} className={cn('flex w-full items-center gap-3 py-2 text-left', i && 'border-t border-line')}>
                <span className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{g.name}</div>
                  <div className="truncate text-[12.5px] text-mute">{g.uid ? `#${g.uid} · ` : ''}{shortDept(g.dept)}</div>
                </span>
                <span className="text-right text-[12px] text-mute">
                  {fmtT(s[4])}
                  <div className="max-w-[110px] truncate">{s[5] || 'Sheet2'}</div>
                </span>
              </button>
            ))}
          </Card>
        </>
      )}

      <ConfirmDialog open={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
    </section>
  );
}

const Stat = ({ n, label, className }) => (
  <div className="rounded-2xl bg-white p-3 shadow-card">
    <b className={cn('block text-2xl', className)}>{n}</b>
    <span className="text-[12.5px] text-mute">{label}</span>
  </div>
);
