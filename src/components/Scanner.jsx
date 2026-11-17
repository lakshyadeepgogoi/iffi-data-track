import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Image as ImageIcon } from 'lucide-react';
import { useDesk } from '../state/DeskContext.jsx';
import { findByCode, getSt, shortDept, stage } from '../lib/guests.js';
import { cn, fmtT, vibrate } from '../lib/utils.js';
import { Avatar, Button, Card, Pill } from './ui.jsx';

export default function Scanner({ onOpen, onSearch }) {
  const { guests, status, setStatus, notify } = useDesk();
  const [mode, setMode] = useState('lookup'); // lookup | hand
  const [running, setRunning] = useState(false);
  const [manual, setManual] = useState('');
  const [last, setLast] = useState(null); // { code, hits }
  const [camErr, setCamErr] = useState('');
  const qrRef = useRef(null);
  const lastScan = useRef({ code: '', at: 0 });

  // Always call the latest handler from the camera callback.
  const handlerRef = useRef(null);
  handlerRef.current = (code, typed) => {
    if (!typed && code === lastScan.current.code && Date.now() - lastScan.current.at < 3000) return;
    lastScan.current = { code, at: Date.now() };
    const hits = findByCode(guests, code);
    setLast({ code, keys: hits.map((h) => h.key) });
    if (!hits.length) { vibrate([60, 60, 60]); return; }
    const g = hits[0];
    if (mode === 'hand' && hits.length === 1) {
      const s = getSt(status, g.key);
      if (s[3]) { vibrate([80, 50, 80]); notify(`⚠ ${g.name} already collected ${fmtT(s[4])} (${s[5]})`); }
      else setStatus([g.key], 'delivered', true);
      return;
    }
    onOpen(g.key);
  };

  async function start() {
    setCamErr('');
    try {
      qrRef.current ??= new Html5Qrcode('qr-reader');
      await qrRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const m = Math.floor(Math.min(w, h) * 0.7); return { width: m, height: m }; } },
        (text) => handlerRef.current(text),
        () => {},
      );
      setRunning(true);
    } catch {
      setCamErr('Live camera isn’t allowed here. “Photo of QR” opens your camera and reads the code from the picture — it works on every phone.');
    }
  }
  async function stop() {
    try { if (qrRef.current?.isScanning) await qrRef.current.stop(); } catch { /* already stopped */ }
    setRunning(false);
  }
  useEffect(() => () => { if (qrRef.current?.isScanning) qrRef.current.stop().catch(() => {}); }, []);

  async function scanPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const reader = new Html5Qrcode('qr-file');
      handlerRef.current(await reader.scanFile(file, false), true);
    } catch {
      notify('No QR / barcode found in that photo');
    }
  }

  const hits = (last?.keys || []).map((k) => guests.find((g) => g.key === k)).filter(Boolean);

  return (
    <section>
      <div className="mb-2.5 flex rounded-xl bg-[#e9e3da] p-[3px]">
        {[['lookup', 'Look up'], ['hand', 'Quick hand-over']].map(([m, t]) => (
          <button key={m} onClick={() => setMode(m)} className={cn('flex-1 rounded-[9px] py-2 text-[13.5px] font-bold', mode === m ? 'bg-white text-ink shadow-card' : 'text-mute')}>
            {t}
          </button>
        ))}
      </div>

      <div id="qr-reader" className={cn('w-full overflow-hidden rounded-2xl', running && 'bg-[#111]')} />
      <div id="qr-file" hidden />

      <div className="mt-2.5 flex gap-2">
        <Button variant="pri" className="flex flex-1 items-center justify-center gap-2" onClick={running ? stop : start}>
          <Camera size={18} /> {running ? 'Stop camera' : 'Start camera'}
        </Button>
        <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-sand px-3 py-3.5 text-[15px] font-bold">
          <ImageIcon size={18} /> Photo of QR
          <input type="file" accept="image/*" capture="environment" hidden onChange={scanPhoto} />
        </label>
      </div>

      <form className="mt-2.5 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) handlerRef.current(manual.trim(), true); }}>
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          inputMode="numeric"
          placeholder="Type User ID"
          className="min-w-0 flex-1 rounded-xl border border-line bg-white p-3 text-[17px] tracking-wide outline-none focus:border-brand"
        />
        <Button type="submit" className="px-5">Find</Button>
      </form>

      <p className="mt-2 text-[12.5px] text-mute">
        {camErr || 'Scans QR codes or barcodes on cards. “Quick hand-over” marks the card delivered the moment it’s scanned (with undo).'}
      </p>

      {last && (
        <Card className="mt-3" title={`Last scan · ${last.code}`}>
          {!hits.length && (
            <>
              <b>No guest for “{last.code}”</b>
              <Button className="mt-2 w-full" onClick={() => onSearch(last.code)}>Search guests</Button>
            </>
          )}
          {hits.map((h) => {
            const sg = stage(h, status);
            return (
              <button key={h.key} onClick={() => onOpen(h.key)} className="flex w-full items-center gap-3 py-2 text-left">
                <Avatar g={h} stage={sg} />
                <span className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{h.name}</div>
                  <div className="truncate text-[12.5px] text-mute">#{h.uid} · {shortDept(h.dept)}</div>
                </span>
                <Pill stage={sg} />
              </button>
            );
          })}
          {hits.length > 1 && <p className="text-[12.5px] font-bold text-bad">⚠ Same User ID on more than one row — pick the right one.</p>}
        </Card>
      )}
    </section>
  );
}
