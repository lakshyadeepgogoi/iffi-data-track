export const cn = (...c) => c.filter(Boolean).join(' ');

export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('gd_' + k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('gd_' + k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
  del(k) {
    try {
      localStorage.removeItem('gd_' + k);
    } catch {
      /* storage unavailable */
    }
  },
};

export function fmtT(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? t
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + t;
}

export function ago(ms) {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  return fmtT(ms);
}

export const vibrate = (p) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not supported */
  }
};
