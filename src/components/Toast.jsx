import { useEffect } from 'react';
import { useDesk } from '../state/DeskContext.jsx';
import { cn } from '../lib/utils.js';

export default function Toast() {
  const { toast, setToast } = useDesk();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [toast, setToast]);
  return (
    <div
      className={cn(
        'fixed bottom-24 left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-3.5 py-2.5 text-sm font-semibold text-white shadow-xl transition-all duration-200',
        toast ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-5 opacity-0',
      )}
      role="status"
    >
      <span>{toast?.msg}</span>
      {toast?.action && (
        <button className="font-extrabold text-[#ffd56b]" onClick={() => { const fn = toast.action.fn; setToast(null); fn(); }}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
