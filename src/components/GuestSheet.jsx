import { useEffect, useRef, useState } from 'react';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { useDesk } from '../state/DeskContext.jsx';
import { ISSUES, SHEET_ACTORS, getSt, initials, shortDept, stage, waLink } from '../lib/guests.js';
import { MODE } from '../lib/api.js';
import { cn, fmtT } from '../lib/utils.js';
import { Button, Pill } from './ui.jsx';

const photoCache = {};

/** Bottom sheet with one guest: photo, status actions, contact, note. */
export default function GuestSheet({ guestKey, onClose }) {
  const { byKey, status, setStatus, saveNote } = useDesk();
  const lastKey = useRef(null);
  if (guestKey) lastKey.current = guestKey;
  const g = byKey[guestKey || lastKey.current];
  const open = !!guestKey && !!g;

  const [note, setNote] = useState('');
  const savedNote = g ? getSt(status, g.key)[6] : '';
  useEffect(() => { setNote(savedNote || ''); }, [guestKey, savedNote]);

  // Close when the guest disappears after a re-sync.
  useEffect(() => { if (guestKey && !byKey[guestKey]) onClose(); }, [guestKey, byKey, onClose]);

  return (
    <>
      <div onClick={onClose} className={cn('fixed inset-0 z-40 bg-[#14100c]/45 transition-opacity', open ? 'opacity-100' : 'pointer-events-none opacity-0')} />
      <div
        inert={!open}
        aria-hidden={!open}
        role="dialog"
        aria-label={g ? g.name : 'Guest'}
        className={cn('fixed inset-x-0 bottom-0 z-[41] flex justify-center transition-transform duration-250 ease-out', open ? 'translate-y-0' : 'translate-y-[105%]')}
      >
        <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-t-3xl bg-white px-4 pt-2 pb-[calc(18px+env(safe-area-inset-bottom))]">
          <div className="mx-auto mt-1 mb-2.5 h-[5px] w-10 rounded-full bg-[#ddd5ca]" />
          {g && <Body g={g} status={status} setStatus={setStatus} note={note} setNote={setNote} saveNote={saveNote} onClose={onClose} />}
        </div>
      </div>
    </>
  );
}

function Body({ g, status, setStatus, note, setNote, saveNote, onClose }) {
  const s = getSt(status, g.key);
  const sg = stage(g, status);
  const wa = waLink(g);
  const act = (field, value) => setStatus([g.key], field, value);

  return (
    <>
      <div className="flex items-center gap-3.5">
        <Photo g={g} />
        <div className="min-w-0">
          <h3 className="text-xl leading-tight font-bold">{g.name}</h3>
          <div className="text-[13.5px] text-mute">{g.desig || '—'}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="rounded-md bg-sand px-2 py-0.5 text-[13px] font-bold tabular-nums">{g.uid ? `ID ${g.uid}` : 'No User ID'}</span>
            <Pill stage={sg} />
          </div>
        </div>
      </div>

      <div className="mt-3 mb-1 flex flex-wrap gap-1.5">
        <Tag>{shortDept(g.dept)}</Tag>
        <Tag>{g.card}</Tag>
        {g.issues.map((i) => <Tag key={i} bad>{ISSUES[i][0]}</Tag>)}
      </div>

      <div className="my-3.5 grid gap-2">
        {!s[0] && (
          <>
            <Button variant="pri" onClick={() => act('printed', true)}>{g.uid ? 'Mark card printed' : 'Mark printed (no User ID!)'}</Button>
            <Button variant="del" onClick={() => act('delivered', true)}>Hand over card now</Button>
          </>
        )}
        {!!s[0] && !s[3] && (
          <>
            <Button variant="del" className="py-[18px]" onClick={() => act('delivered', true)}>Hand over card ✓</Button>
            <Button variant="ghost" onClick={() => act('printed', false)}>Undo printed</Button>
          </>
        )}
        {!!s[3] && (
          <>
            <div className="rounded-xl bg-del/12 p-3.5 text-center font-bold text-del">Delivered {fmtT(s[4])}</div>
            <Button variant="ghost" onClick={() => act('delivered', false)}>Undo delivery</Button>
          </>
        )}
      </div>

      <div className="mb-1.5 space-y-1 text-[13px] text-mute">
        {!!s[0] && <TimeLine icon="🖨" verb="Printed" at={s[1]} by={s[2]} raw={s[7]} />}
        {!!s[3] && <TimeLine icon="✅" verb="Delivered" at={s[4]} by={s[5]} raw={s[8]} />}
        {!!g.firstSeen && <div>🆕 First seen in Sheet2 <b className="text-ink">{fmtT(g.firstSeen)}</b></div>}
      </div>

      <div className="my-2.5 grid grid-cols-3 gap-2">
        <Contact href={g.mobile ? `tel:${g.mobile}` : ''} icon={Phone}>Call</Contact>
        <Contact href={wa} icon={MessageCircle} external>WhatsApp</Contact>
        <Contact href={g.email ? `mailto:${g.email}` : ''} icon={Mail} external>Email</Contact>
      </div>

      <dl className="mt-2 border-t border-line text-[13.5px]">
        <Row k="Mobile" v={g.mobile} />
        <Row k="Email" v={g.email} />
        <Row k="Department" v={g.dept} />
        <Row k="Card (sheet)" v={g.accr} />
        {g.remark && <Row k="Remark" v={g.remark} />}
        <Row k="Sheet2 row" v={`Row ${g.row}`} />
      </dl>

      <label className="mt-3 block text-xs font-bold text-mute" htmlFor="note">Team note</label>
      <textarea
        id="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Collected by assistant, call before 5 PM…"
        className="mt-1 min-h-16 w-full resize-y rounded-xl border border-line p-2.5 outline-none focus:border-brand"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button onClick={() => saveNote(g.key, note)}>Save note</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </>
  );
}

function Photo({ g }) {
  const { api } = useDesk();
  const [src, setSrc] = useState(null);
  useEffect(() => {
    const id = g.photoId;
    setSrc(photoCache[id] || null);
    if (!id || photoCache[id] || MODE === 'demo') return;
    let alive = true;
    const img = new Image();
    img.onload = () => { photoCache[id] = img.src; if (alive) setSrc(img.src); };
    // Staff may not have Drive access to the upload folder → fetch through the backend.
    img.onerror = () =>
      api('apiPhoto', id).then((u) => { if (u) { photoCache[id] = u; if (alive) setSrc(u); } }).catch(() => {});
    img.src = `https://drive.google.com/thumbnail?id=${id}&sz=w400`;
    return () => { alive = false; };
  }, [g.photoId, api]);
  return (
    <div className="grid h-[108px] w-[88px] flex-none place-items-center overflow-hidden rounded-xl bg-[#eee8df] text-2xl font-bold text-mute">
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(g)}
    </div>
  );
}

/** Desk actions show time + staff name; marks typed in Sheet2 show the cell value. */
function TimeLine({ icon, verb, at, by, raw }) {
  const desk = by && !SHEET_ACTORS.includes(by);
  return (
    <div>
      {icon} {verb}{' '}
      {desk ? (
        <><b className="text-ink">{fmtT(at)}</b> by <b className="text-ink">{by}</b></>
      ) : (
        <><b className="text-ink">{raw || fmtT(at)}</b> <span className="text-mute">(in Sheet2)</span></>
      )}
    </div>
  );
}

const Tag = ({ bad, children }) => (
  <span className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold', bad ? 'bg-bad/10 text-bad' : 'bg-sand text-[#4d473f]')}>{children}</span>
);

const Row = ({ k, v }) => (
  <div className="flex gap-2.5 border-b border-line py-2">
    <dt className="w-24 flex-none text-mute">{k}</dt>
    <dd className="font-medium break-words">{v || '—'}</dd>
  </div>
);

const Contact = ({ href, icon: Icon, external, children }) => (
  <a
    href={href || undefined}
    target={external ? '_blank' : undefined}
    rel="noreferrer"
    className={cn('flex flex-col items-center gap-1 rounded-xl bg-[#f6f3ee] px-1 py-2.5 text-xs font-semibold text-ink', !href && 'pointer-events-none opacity-35')}
  >
    <Icon size={21} />
    {children}
  </a>
);
