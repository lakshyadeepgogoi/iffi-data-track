import { useState } from 'react';
import { LogOut, TriangleAlert } from 'lucide-react';
import { useDesk } from '../state/DeskContext.jsx';
import { cn } from '../lib/utils.js';
import { ConfirmDialog } from './ui.jsx';
import { TABS } from './TabBar.jsx';
import logo from '../assets/iffi-logo.png';

export default function Header({ view, onChange }) {
  const { auth, live, queueLen, logout, warnings } = useDesk();
  const [ask, setAsk] = useState(false);
  const pending = queueLen ? ` · ${queueLen} pending` : '';
  const label = live === 'off' ? 'Offline' + pending : live === 'wait' ? 'Syncing' : 'Live' + pending;
  return (
    <header className="sticky top-0 z-20 bg-brand pt-[env(safe-area-inset-top)] text-white">
      <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-3.5 py-2.5 lg:max-w-6xl lg:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white p-0.5">
          <img src={logo} alt="IFFI" className="size-full object-contain" />
        </span>
        <h1 className="flex-1 text-[17px] leading-tight font-bold">
          IFFI Guest Desk
          <small className="block text-[11.5px] font-medium opacity-80">{auth?.name}</small>
        </h1>
        {/* Laptop: the tabs live up here instead of the bottom bar. */}
        <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
          {TABS.map(([id, text, Icon]) => (
            <button
              key={id}
              onClick={() => onChange?.(id)}
              aria-current={view === id ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
                view === id ? 'bg-white text-brand' : 'text-white/85 hover:bg-white/10',
              )}
            >
              <Icon size={17} strokeWidth={view === id ? 2.4 : 2} />
              {text}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs whitespace-nowrap">
          <span className={cn('size-2 rounded-full', live === 'ok' && 'animate-pulse-dot bg-[#7CFFB0]', live === 'wait' && 'bg-[#ffe08a]', live === 'off' && 'bg-[#ffb4b4]')} />
          {label}
        </div>
        <button aria-label="Log out" className="rounded-lg p-1.5 hover:bg-white/10" onClick={() => setAsk(true)}>
          <LogOut size={18} />
        </button>
      </div>
      {warnings.map((w) => (
        <div key={w} role="alert" className="bg-bad text-white">
          <div className="mx-auto flex max-w-3xl items-start gap-2 px-3.5 py-2 text-[13px] leading-snug font-semibold lg:max-w-6xl lg:px-6">
            <TriangleAlert size={16} className="mt-px shrink-0" />
            <span>{w}</span>
          </div>
        </div>
      ))}
      <ConfirmDialog
        open={ask}
        title="Log out?"
        body={queueLen ? `${queueLen} change(s) are still waiting to sync. They stay on this phone.` : 'You can log back in with the team PIN.'}
        confirmLabel="Log out"
        onCancel={() => setAsk(false)}
        onConfirm={() => { setAsk(false); logout(); }}
      />
    </header>
  );
}
