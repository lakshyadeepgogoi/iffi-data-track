import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { call, isAuthErr, isNetErr, POLL_MS } from '../lib/api.js';
import { localApply, shapeGuests } from '../lib/guests.js';
import { store, vibrate } from '../lib/utils.js';

const Ctx = createContext(null);
export const useDesk = () => useContext(Ctx);

const EMPTY_DATA = { guests: [], byKey: {} };

function withQueue(status, queue, me) {
  const next = { ...status };
  queue.forEach((op) => op.keys.forEach((k) => { next[k] = localApply(next[k], op.field, op.value, me); }));
  return next;
}

/**
 * Owns all live data: guests, card status, sync state and the offline queue.
 * Realtime = each phone asks the backend for two version stamps every POLL_MS:
 *   s (status changed)  → re-fetch status only (small)
 *   d (guest list changed, e.g. new form entries) → re-fetch everything
 */
export function DeskProvider({ children }) {
  const [auth, setAuth] = useState(() => store.get('auth', null));
  const [phase, setPhase] = useState(() => (store.get('auth', null) ? 'booting' : 'login'));
  const [data, setData] = useState(EMPTY_DATA);
  const [status, setStatusState] = useState({});
  const [live, setLive] = useState('wait'); // ok | wait | off
  const [lastOk, setLastOk] = useState(0);
  const [queueLen, setQueueLen] = useState(() => store.get('queue', []).length);
  const [statusTick, setStatusTick] = useState(0);
  const [toast, setToast] = useState(null);

  // Refs are the source of truth inside async code (no stale closures).
  const authRef = useRef(auth);
  const statusRef = useRef({});
  const byKeyRef = useRef({});
  const vRef = useRef({ s: '', d: '' });
  const queueRef = useRef(store.get('queue', []));

  const commitStatus = useCallback((next) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const commitQueue = useCallback((next) => {
    queueRef.current = next;
    store.set('queue', next);
    setQueueLen(next.length);
  }, []);

  const notify = useCallback((msg, action) => setToast({ msg, action, id: Date.now() + Math.random() }), []);

  const markOk = useCallback(() => {
    setLive('ok');
    setLastOk(Date.now());
  }, []);

  const applyData = useCallback(
    (rows, serverStatus) => {
      const shaped = shapeGuests(rows);
      byKeyRef.current = shaped.byKey;
      setData(shaped);
      commitStatus(withQueue(serverStatus, queueRef.current, authRef.current?.name || ''));
    },
    [commitStatus],
  );

  const loadAll = useCallback(async () => {
    const r = await call('apiSnapshot', authRef.current);
    vRef.current = r.v;
    applyData(r.guests, r.status);
    store.set('cache', { guests: r.guests, status: r.status, at: Date.now() });
    markOk();
  }, [applyData, markOk]);

  const loadCache = useCallback(() => {
    const c = store.get('cache', null);
    if (c) applyData(c.guests, c.status);
  }, [applyData]);

  /* ── auth ── */
  const login = useCallback(
    async (name, pin) => {
      const a = { name: name.trim(), pin: pin.trim() };
      await call('apiLogin', a);
      authRef.current = a;
      setAuth(a);
      store.set('auth', a);
      setPhase('booting');
      try {
        await loadAll();
      } finally {
        setPhase('ready');
      }
    },
    [loadAll],
  );

  const logout = useCallback(() => {
    store.del('auth');
    authRef.current = null;
    setAuth(null);
    setPhase('login');
  }, []);

  // Restore a saved session.
  useEffect(() => {
    if (phase !== 'booting' || !authRef.current) return;
    let alive = true;
    (async () => {
      try {
        await call('apiLogin', authRef.current);
        await loadAll();
        if (alive) setPhase('ready');
      } catch (e) {
        if (!alive) return;
        if (isAuthErr(e)) {
          setPhase('login');
        } else {
          loadCache();
          setLive('off');
          setPhase('ready');
          notify('Offline — showing last saved data');
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── offline queue ── */
  const flushQueue = useCallback(async () => {
    let flushed = false;
    while (queueRef.current.length) {
      const op = queueRef.current[0];
      const r = await call('apiSet', authRef.current, op.keys, op.field, op.value, 'synced from offline');
      commitStatus({ ...statusRef.current, ...r.changed });
      vRef.current = { ...vRef.current, s: r.v.s };
      commitQueue(queueRef.current.slice(1));
      flushed = true;
    }
    if (flushed) {
      setStatusTick((t) => t + 1);
      notify('Offline changes synced');
    }
  }, [commitQueue, commitStatus, notify]);

  /* ── realtime polling ── */
  useEffect(() => {
    if (phase !== 'ready') return;
    let stopped = false;
    let running = false;
    let timer;

    const tick = async () => {
      if (running) return;
      running = true;
      if (!document.hidden) {
        try {
          await flushQueue();
          const v = await call('apiVersion', authRef.current);
          if (v.d !== vRef.current.d) {
            await loadAll();
            setStatusTick((t) => t + 1);
            notify('Sheet2 changed — list updated');
          } else if (v.s !== vRef.current.s) {
            const r = await call('apiStatus', authRef.current);
            vRef.current = r.v;
            commitStatus(withQueue(r.status, queueRef.current, authRef.current?.name || ''));
            setStatusTick((t) => t + 1);
          }
          markOk();
        } catch (e) {
          if (isAuthErr(e)) { logout(); return; }
          setLive(isNetErr(e) ? 'off' : 'wait');
        }
      }
      running = false;
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };

    const wake = () => {
      if (document.hidden || running) return;
      clearTimeout(timer);
      tick();
    };

    timer = setTimeout(tick, POLL_MS);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [phase, flushQueue, loadAll, commitStatus, markOk, notify, logout]);

  /* ── writes: optimistic, with undo and offline fallback ── */
  const setStatus = useCallback(
    async (keys, field, value, { silent = false } = {}) => {
      keys = keys.filter((k) => byKeyRef.current[k]);
      if (!keys.length) return;
      const me = authRef.current.name;
      const prev = statusRef.current;
      const next = { ...prev };
      keys.forEach((k) => { next[k] = localApply(next[k], field, value, me); });
      commitStatus(next);
      vibrate(value ? 30 : [20, 40, 20]);

      if (!silent) {
        const who = keys.length === 1 ? byKeyRef.current[keys[0]].name : `${keys.length} guests`;
        const verb = value ? (field === 'printed' ? 'marked printed' : 'delivered ✓') : 'undone';
        notify(`${who} ${verb}`, value ? { label: 'Undo', fn: () => setStatus(keys, field, false) } : null);
      }

      try {
        setLive('wait');
        const r = await call('apiSet', authRef.current, keys, field, value, '');
        commitStatus({ ...statusRef.current, ...r.changed });
        vRef.current = { ...vRef.current, s: r.v.s };
        setStatusTick((t) => t + 1);
        markOk();
      } catch (e) {
        if (isNetErr(e)) {
          commitQueue([...queueRef.current, { keys, field, value }]);
          setLive('off');
          notify('No network — saved on this phone, will sync automatically');
        } else {
          const reverted = { ...statusRef.current };
          keys.forEach((k) => { if (prev[k]) reverted[k] = prev[k]; else delete reverted[k]; });
          commitStatus(reverted);
          notify('Failed: ' + (e.message || e));
        }
      }
    },
    [commitQueue, commitStatus, markOk, notify],
  );

  const saveNote = useCallback(
    async (key, note) => {
      try {
        const r = await call('apiNote', authRef.current, key, note);
        commitStatus({ ...statusRef.current, ...r.changed });
        notify('Note saved');
      } catch (e) {
        notify('Note failed: ' + (e.message || e));
      }
    },
    [commitStatus, notify],
  );

  /** Any other backend call with auth prepended. */
  const api = useCallback((action, ...args) => call(action, authRef.current, ...args), []);

  const value = useMemo(
    () => ({
      auth, phase, guests: data.guests, byKey: data.byKey, status, live, lastOk, queueLen, statusTick,
      toast, setToast, notify, login, logout, setStatus, saveNote, api,
    }),
    [auth, phase, data, status, live, lastOk, queueLen, statusTick, toast, notify, login, logout, setStatus, saveNote, api],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
