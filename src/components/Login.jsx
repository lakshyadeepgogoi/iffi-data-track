import { useState } from 'react';
import { useDesk } from '../state/DeskContext.jsx';
import { store } from '../lib/utils.js';
import { Button } from './ui.jsx';
import logo from '../assets/iffi-logo.png';

export default function Login() {
  const { login } = useDesk();
  const [name, setName] = useState(() => store.get('lastName', ''));
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Enter your name so the team sees who did what.');
    setBusy(true);
    setErr('');
    try {
      store.set('lastName', name.trim());
      await login(name, pin);
    } catch (e2) {
      setErr(String(e2.message || e2).replace(/^.*AUTH:\s*/, ''));
    }
    setBusy(false);
  }

  const input = 'w-full rounded-xl border border-line px-3 py-3 text-base outline-none focus:border-brand';
  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-brand to-brand-dark p-5">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white px-5 py-6 shadow-2xl">
        <img src={logo} alt="IFFI logo" className="mx-auto mb-2 size-28 object-contain" />
        <p className="mb-3 text-center text-xs font-semibold tracking-wide text-mute">57th International Film Festival of India</p>
        <h1 className="text-2xl font-bold text-brand">IFFI Guest Desk</h1>
        <p className="mt-1 mb-4 text-sm text-mute">Accreditation · card printing · hand-over — live for the whole team.</p>
        <label className="mt-2.5 mb-1 block text-xs font-bold text-mute" htmlFor="name">Your name</label>
        <input id="name" className={input} autoComplete="name" placeholder="e.g. Lakshya – Desk 2" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="mt-2.5 mb-1 block text-xs font-bold text-mute" htmlFor="pin">Team PIN</label>
        <input id="pin" className={input} type="password" inputMode="numeric" placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value)} />
        <Button variant="brand" type="submit" disabled={busy} className="mt-4 w-full">{busy ? 'Checking…' : 'Start'}</Button>
        <div className="mt-2 min-h-5 text-sm text-bad">{err}</div>      </form>
    </div>
  );
}
