/* Turns raw rows from the backend into guest objects, and holds every
 * rule about stages, card types and data problems. */

export const ISSUES = {
  noUid: ['Missing User ID', 'Can’t print a card until accreditation ID exists'],
  dupUid: ['Same User ID on 2+ rows', 'Check if it’s one person registered twice'],
  dupEmail: ['Same email on 2+ rows', 'Possible duplicate registration'],
  noPhoto: ['No photo uploaded', 'Card will print without a photo'],
  sheetFlag: ['Flagged in sheet', 'Accreditation column says duplicate / photo missing'],
  noCard: ['Card type blank', 'Accreditation column is empty'],
  labelFix: ['Card type spelt differently', 'e.g. “Offcial Invitee”, “Add-Onn” — fix in the form sheet'],
  badUid: ['User ID is not a number', 'Something else was typed into the User ID column'],
};

export const STAGES = {
  ready: { label: 'To print', pill: 'bg-ready/12 text-ready', bg: 'bg-ready' },
  pri: { label: 'Printed', pill: 'bg-pri/12 text-pri', bg: 'bg-pri' },
  del: { label: 'Delivered', pill: 'bg-del/12 text-del', bg: 'bg-del' },
  noid: { label: 'No User ID', pill: 'bg-noid/15 text-[#5d636b]', bg: 'bg-noid' },
};

export const DEFAULT_FILTERS = { q: '', st: 'all', dept: '', card: '', issue: '' };

/* Status tuple from the backend (all values come from Sheet2 + the tracker):
 * [printed, printedAt, printedBy, delivered, deliveredAt, deliveredBy, note, printedRaw, deliveredRaw]
 * printedRaw / deliveredRaw = what Sheet2 shows, e.g. "16/11/26" or "Remark: Deleverd". */
export const EMPTY_STATUS = [0, 0, '', 0, 0, '', '', '', ''];
export const SHEET_ACTORS = ['Sheet2', 'System'];
export const getSt = (status, key) => status[key] || EMPTY_STATUS;

export function stage(g, status) {
  const s = getSt(status, g.key);
  return s[3] ? 'del' : s[0] ? 'pri' : g.uid ? 'ready' : 'noid';
}

/** Same business rules as the server: delivered ⇒ printed, un-print ⇒ un-deliver. */
export function localApply(prev, field, val, me, today = todayStr()) {
  const s = (prev || EMPTY_STATUS).slice();
  const now = Date.now();
  const print = (on) => { s[0] = on ? 1 : 0; s[1] = on ? now : 0; s[2] = on ? me : ''; s[7] = on ? today : ''; };
  const deliver = (on) => { s[3] = on ? 1 : 0; s[4] = on ? now : 0; s[5] = on ? me : ''; s[8] = on ? today : ''; };
  if (field === 'printed') {
    if (val && s[0]) return s;           // already printed: keep original date
    print(val);
    if (!val) deliver(false);            // not printed ⇒ not delivered
  } else {
    if (val && s[3]) return s;
    deliver(val);
    if (val && !s[0]) print(true);       // delivered ⇒ printed
  }
  return s;
}

/** Today as dd/mm/yy in India time — the format the team uses in Sheet2. */
export function todayStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}

/** True when a timestamp falls on today's date in India time. */
export const isToday = (ms) => !!ms && todayStr(new Date(ms)) === todayStr();

export function shortDept(d = '') {
  return (
    d.replace(/^IFFI\s*/i, '')
      .replace(/\s*2026/, '')
      .replace(/\s*Guests?$/i, '')
      .replace(/^International Cinema\s*-\s*/i, 'Intl · ')
      .trim() || d
  );
}

export const initials = (g) => (((g.first || '')[0] || '') + ((g.last || '')[0] || '')).toUpperCase() || '?';

export function normCard(raw) {
  const text = String(raw || '').trim();
  const s = text.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return { card: 'Not set', flag: 'noCard' };
  if (/^du[bp]/.test(s) || s.includes('duplicate')) return { card: 'Flagged: duplicate', flag: 'sheetFlag' };
  if (s.includes('photomissing')) return { card: 'Flagged: photo missing', flag: 'sheetFlag' };
  let card = text;
  if (s.includes('special')) card = 'Special Invitee';
  else if (s.includes('invitee')) card = 'Official Invitee';
  else if (s.includes('addon')) card = 'Guest Add-On';
  else if (s.includes('management')) card = 'IFFI Management';
  else if (s.includes('official')) card = 'IFFI Official';
  else if (s === 'kids') card = 'Kids';
  const sameIgnoringCase = card.toLowerCase().replace(/[^a-z]/g, '') === s;
  return { card, flag: sameIgnoringCase ? '' : 'labelFix' };
}

export function shapeGuests(rows) {
  const uidCount = {};
  const emailCount = {};
  const guests = rows.map((a) => {
    const [key, row, dept, first, last, desig, email, mobile, photoId, uid, accr, remark, firstSeen] = a;
    const g = { key, row, dept, first, last, desig, email, mobile, photoId, uid, accr, remark, firstSeen: firstSeen || 0 };
    g.name = `${first} ${last}`.trim() || '(no name)';
    const n = normCard(accr);
    g.card = n.card;
    g.cardFlag = n.flag;
    if (uid) uidCount[uid] = (uidCount[uid] || 0) + 1;
    if (email) emailCount[email.toLowerCase()] = (emailCount[email.toLowerCase()] || 0) + 1;
    return g;
  });
  const byKey = {};
  guests.forEach((g) => {
    const issues = [];
    if (!g.uid) issues.push('noUid');
    if (g.uid && uidCount[g.uid] > 1) issues.push('dupUid');
    if (g.uid && !/^\d+$/.test(g.uid)) issues.push('badUid');
    if (g.email && emailCount[g.email.toLowerCase()] > 1) issues.push('dupEmail');
    if (!g.photoId) issues.push('noPhoto');
    if (g.cardFlag) issues.push(g.cardFlag);
    g.issues = issues;
    g.hay = [g.name, g.email, g.mobile, g.uid, g.desig, g.dept, g.card].join(' ').toLowerCase();
    g.digits = String(g.mobile).replace(/\D/g, '');
    byKey[g.key] = g;
  });
  return { guests, byKey };
}

export function filterGuests(guests, status, f) {
  const q = f.q.trim().toLowerCase();
  const qd = q.replace(/\D/g, '');
  return guests.filter((g) => {
    if (f.dept && g.dept !== f.dept) return false;
    if (f.card && g.card !== f.card) return false;
    if (f.issue && !g.issues.includes(f.issue)) return false;
    if (f.st === 'issues' && !g.issues.length) return false;
    if (f.st === 'hasuid' && !g.uid) return false;
    if (f.st === 'new' && !isToday(g.firstSeen)) return false;
    if (['del', 'pri', 'ready', 'noid'].includes(f.st) && stage(g, status) !== f.st) return false;
    if (q) {
      if (g.hay.includes(q)) return true;
      if (qd.length >= 4 && (g.digits.includes(qd) || g.uid.includes(qd))) return true;
      return q.split(/\s+/).every((w) => g.hay.includes(w));
    }
    return true;
  });
}

export function waLink(g) {
  const d = g.digits;
  if (d.length < 10) return '';
  const num = d.length === 10 ? '91' + d : d;
  const text = `Hello ${g.first}, your IFFI 2026 card${g.uid ? ` (ID ${g.uid})` : ''} is ready for collection at the accreditation desk.`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}
