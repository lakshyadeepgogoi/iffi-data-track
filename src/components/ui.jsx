import { cn } from '../lib/utils.js';
import { STAGES, initials } from '../lib/guests.js';

export const Card = ({ className, title, children }) => (
  <div className={cn('mb-3 rounded-2xl bg-white p-3.5 shadow-card', className)}>
    {title && <h2 className="mb-2.5 text-xs font-bold tracking-wider text-mute uppercase">{title}</h2>}
    {children}
  </div>
);

export const Pill = ({ stage, className }) => (
  <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap', STAGES[stage].pill, className)}>
    {STAGES[stage].label}
  </span>
);

export const Avatar = ({ g, stage }) => (
  <span className={cn('grid size-10 flex-none place-items-center rounded-full text-sm font-bold text-white', STAGES[stage].bg)}>
    {initials(g)}
  </span>
);

export const Spinner = () => (
  <div className="mx-auto my-10 size-7 animate-spin rounded-full border-[3px] border-line border-t-brand" />
);

export function ProgressBar({ parts, total, className }) {
  return (
    <div className={cn('flex h-2.5 overflow-hidden rounded-full bg-[#eee8df]', className)}>
      {parts.map(([n, color], i) => (
        <i key={i} className={cn('block h-full transition-all duration-500', color)} style={{ width: total ? `${(n / total) * 100}%` : 0 }} />
      ))}
    </div>
  );
}

export function Button({ variant = 'default', className, ...props }) {
  const v = {
    default: 'bg-sand text-ink',
    pri: 'bg-pri text-white',
    del: 'bg-del text-white',
    brand: 'bg-brand text-white',
    ghost: 'border-[1.5px] border-line bg-white py-2.5 text-[13.5px] text-mute',
  }[variant];
  return (
    <button
      {...props}
      className={cn('rounded-xl px-3 py-3.5 text-center text-[15px] font-bold transition active:scale-[.98] disabled:opacity-45', v, className)}
    />
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-5" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{title}</h3>
        {body && <p className="mt-1.5 text-sm whitespace-pre-line text-mute">{body}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="brand" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
