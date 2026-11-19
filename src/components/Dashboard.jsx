import { useMemo } from 'react';
import { useDesk } from '../state/DeskContext.jsx';
import { ISSUES, getSt, isToday, shortDept, stage } from '../lib/guests.js';
import { ago, cn } from '../lib/utils.js';
import { Card, ProgressBar } from './ui.jsx';

export default function Dashboard({ onFilter }) {
  const { guests, status, lastOk } = useDesk();

  const { c, depts, issues, today } = useMemo(() => {
    const c = { all: 0, uid: 0, del: 0, pri: 0, ready: 0, noid: 0 };
    const today = { fresh: 0, printed: 0, delivered: 0 };
    const depts = {};
    const issues = Object.fromEntries(Object.keys(ISSUES).map((k) => [k, 0]));
    guests.forEach((g) => {
      const s = stage(g, status);
      c.all++; c[s]++; if (g.uid) c.uid++;
      const d = (depts[g.dept] ||= { all: 0, del: 0, pri: 0, ready: 0, noid: 0 });
      d.all++; d[s]++;
      g.issues.forEach((i) => issues[i]++);
      const st = getSt(status, g.key);
      if (isToday(g.firstSeen)) today.fresh++;
      if (st[0] && isToday(st[1])) today.printed++;
      if (st[3] && isToday(st[4])) today.delivered++;
    });
    return { c, depts: Object.entries(depts).sort((a, b) => b[1].all - a[1].all), issues, today };
  }, [guests, status]);

  const pct = (n) => (c.all ? ((n / c.all) * 100).toFixed(1) : '0') + '%';
  const kpis = [
    ['all', c.all, 'Registered', ''],
    ['hasuid', c.uid, 'Accredited (ID)', ''],
    ['ready', c.ready, 'To print', 'text-ready'],
    ['pri', c.pri, 'Printed, to hand over', 'text-pri'],
    ['del', c.del, 'Delivered', 'text-del'],
    ['noid', c.noid, 'Waiting for ID', ''],
  ];

  return (
    <section>
      <div className="mb-3 grid grid-cols-3 gap-2 lg:mb-4 lg:grid-cols-6 lg:gap-3">
        {kpis.map(([st, n, label, color]) => (
          <button key={st} onClick={() => onFilter({ st })} className="rounded-xl bg-white px-3 py-2.5 text-left shadow-card transition-shadow active:scale-[.98] lg:px-4 lg:py-3.5 lg:hover:shadow-lg">
            <b className={cn('block text-[23px] leading-tight tabular-nums lg:text-[28px]', color)}>{n}</b>
            <span className="text-[11.5px] leading-tight font-semibold text-mute lg:text-xs">{label}</span>
          </button>
        ))}
      </div>

      {/* Laptop: two columns. Phone: one column, same order. */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
      <div>
      <Card title="Today">
        <div className="grid grid-cols-3 gap-2 text-center">
          <TodayStat n={today.fresh} label="New registrations" onClick={() => onFilter({ st: 'new' })} />
          <TodayStat n={today.printed} label="Cards printed" color="text-pri" />
          <TodayStat n={today.delivered} label="Cards delivered" color="text-del" />
        </div>
      </Card>

      <Card title="Overall progress">
        <ProgressBar total={c.all} parts={[[c.del, 'bg-del'], [c.pri, 'bg-pri'], [c.ready, 'bg-ready']]} className="my-1.5" />
        <div className="flex flex-wrap gap-3 text-xs text-mute">
          <Legend color="bg-del">Delivered {pct(c.del)}</Legend>
          <Legend color="bg-pri">Printed {pct(c.pri + c.del)}</Legend>
          <Legend color="bg-ready">To print</Legend>
          <Legend color="bg-[#eee8df]">No ID</Legend>
        </div>
      </Card>

      <Card title="By department">
        {depts.map(([name, d], i) => (
          <button key={name} onClick={() => onFilter({ dept: name })} className={cn('flex w-full items-center gap-2.5 py-2.5 text-left', i && 'border-t border-line')}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{shortDept(name)}</div>
              <ProgressBar total={d.all} parts={[[d.del, 'bg-del'], [d.pri, 'bg-pri'], [d.ready, 'bg-ready']]} className="mt-1.5 h-1.5" />
            </div>
            <div className="text-right text-[12.5px] whitespace-nowrap text-mute tabular-nums">
              <b className="text-sm text-ink">{d.del}</b>/{d.all}
              <br />
              {d.ready ? `${d.ready} to print` : d.pri ? `${d.pri} to hand` : d.noid ? `${d.noid} no ID` : 'done ✓'}
            </div>
          </button>
        ))}
      </Card>
      </div>

      <div>
      <Card title="Data checks">
        {Object.entries(ISSUES).map(([k, [t, sub]], i) => (
          <button key={k} onClick={() => onFilter({ issue: k })} className={cn('flex w-full items-center justify-between gap-3 py-2.5 text-left', i && 'border-t border-line')}>
            <div>
              {t}
              <em className="block text-[12.5px] text-mute not-italic">{sub}</em>
            </div>
            <span className={cn('min-w-8 rounded-full px-2 py-0.5 text-center text-[13px] font-bold', issues[k] ? 'bg-bad/10 text-bad' : 'bg-del/10 text-del')}>
              {issues[k] || '✓'}
            </span>
          </button>
        ))}
      </Card>
      </div>
      </div>

      <p className="text-center text-xs text-mute">Updated {ago(lastOk)} · {guests.length} guests tracked live from Sheet2</p>
    </section>
  );
}

const TodayStat = ({ n, label, color, onClick }) => (
  <button onClick={onClick} disabled={!onClick} className="rounded-xl bg-paper px-1 py-2">
    <b className={cn('block text-xl tabular-nums', color)}>{n}</b>
    <span className="text-[11.5px] font-semibold text-mute">{label}</span>
  </button>
);

const Legend = ({ color, children }) => (
  <span className="flex items-center gap-1"><i className={cn('inline-block size-2.5 rounded-[3px]', color)} />{children}</span>
);
