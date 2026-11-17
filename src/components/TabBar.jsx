import { History, LayoutDashboard, ScanLine, Users } from 'lucide-react';
import { cn } from '../lib/utils.js';

const TABS = [
  ['home', 'Dashboard', LayoutDashboard],
  ['guests', 'Guests', Users],
  ['scan', 'Scan', ScanLine],
  ['log', 'Activity', History],
];

export default function TabBar({ view, onChange }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-3xl">
        {TABS.map(([id, label, Icon]) => {
          const on = view === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={cn('flex flex-1 flex-col items-center gap-0.5 pt-2 pb-2.5 text-[11.5px] font-semibold', on ? 'text-brand' : 'text-mute')}
            >
              {id === 'scan' ? (
                <span className="-mt-0.5 rounded-2xl bg-brand px-3.5 py-1.5 text-white"><Icon size={22} /></span>
              ) : (
                <Icon size={23} strokeWidth={on ? 2.4 : 2} />
              )}
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
