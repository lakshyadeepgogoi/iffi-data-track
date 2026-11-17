/* Fake backend used when no VITE_API_URL is set. A simulated colleague marks
 * cards and the "sync" adds registrations, so realtime tracking is visible. */
import { localApply, todayStr } from './guests.js';

const DEPTS = {
  'IFFI Indian Panorama 2026 Guest': 60, 'IFFI Officials 2026': 30, 'CMOT Guest': 24,
  'International Cinema - Film Guests': 20, 'IFFI Ministry 2026 Guest': 18, 'Chairman Guest': 14,
  'PIB Officials': 9, 'IFFI Master Class 2026 Guest': 8,
};
const F = ['Aarav', 'Meera', 'Rohan', 'Ananya', 'Kabir', 'Isha', 'Vikram', 'Neha', 'Arjun', 'Priya', 'Dev', 'Sara', 'Nikhil', 'Tara', 'Imran', 'Leela', 'Joseph', 'Mira', 'Rahul', 'Zoya'];
const L = ['Sharma', 'Iyer', 'Das', 'Menon', 'Khan', 'Bose', 'Rao', 'Patel', 'Nair', 'Singh', 'Fernandes', 'Kapoor', 'Ghosh', 'Reddy', 'Sen'];
const CARDS = ['Official Invitee', 'Official Invitee', 'Official Invitee', 'Guest Add-On', 'IFFI Management', 'Special Invitee', 'Offcial Invitee', ''];
const DESIG = ['Director', 'Producer', 'Actor', 'Officer', 'Critic', ''];

let seed = 7;
const R = (n) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n); };

const guests = [];
const status = {};
const log = [];
let vs = '1';
let vd = '1';

function addGuest(dept, firstSeen = 0) {
  const n = guests.length + 1;
  const f = F[R(F.length)], l = L[R(L.length)];
  const uid = R(10) < 9 ? String(4000 + n * 37) : '';
  const email = `${f}.${l}${n}@example.com`.toLowerCase();
  const g = [`${dept}|${email}`, n + 1, dept, f, l, DESIG[R(6)], email, '98' + String(10000000 + R(89999999)),
    R(12) ? 'demo' + n : '', uid, CARDS[R(CARDS.length)], '', firstSeen];
  guests.push(g);
  return g;
}
Object.entries(DEPTS).forEach(([dept, count]) => { for (let j = 0; j < count; j++) addGuest(dept); });
const dup = [...guests[3]]; dup[0] += '#2'; dup[1] = 999; guests.push(dup);

guests.slice(0, 70).forEach((g, k) => {
  if (!g[9]) return;
  status[g[0]] = [1, 0, '', k % 3 ? 0 : 1, 0, '', '', '15/11/26', k % 3 ? '' : 'Remark: Deleverd'];
});
log.push([Date.now() - 3_600_000, 'System', 'TRACKING STARTED', '', '', `${guests.length} guests`, '', 'Watching Sheet2']);

const entry = (who, action, g, details = '') => log.unshift([Date.now(), who, action, g[0], g[9], `${g[3]} ${g[4]}`, g[2], details]);

function set(who, keys, field, val) {
  const changed = {};
  keys.forEach((k) => {
    const g = guests.find((x) => x[0] === k);
    if (!g) return;
    const before = status[k] || [];
    const next = localApply(status[k], field, val, who, todayStr());
    if (next[0] === (before[0] || 0) && next[3] === (before[3] || 0)) return;
    status[k] = next;
    changed[k] = next;
    entry(who, (val ? '' : 'UNDO ') + field.toUpperCase(), g);
  });
  vs = String(Date.now());
  return changed;
}

let started = false;
function startSimulation() {
  if (started) return;
  started = true;
  let tick = 0;
  setInterval(() => {
    tick++;
    if (tick % 5 === 0) {                                   // the form sync adds a registration
      const g = addGuest('CMOT Guest', Date.now());
      entry('Sheet2', 'NEW GUEST', g, g[10] || 'no card type');
      vd = String(Date.now());
      return;
    }
    const open = guests.filter((g) => g[9] && !(status[g[0]] || [])[3]);
    if (!open.length) return;
    const g = open[R(open.length)];
    set(R(2) ? 'Rahul – Desk 1' : 'Priya – Print', [g[0]], (status[g[0]] || [])[0] ? 'delivered' : 'printed', true);
  }, 6000);
}

const reply = (v, ms = 200) => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms));
const ver = () => ({ s: vs, d: vd });
const isSheet = (r) => r[1] === 'Sheet2' || r[1] === 'System';

export const mock = {
  apiLogin: (a) =>
    a.pin !== '2026' ? Promise.reject(new Error('AUTH: Wrong PIN (demo PIN is 2026)')) : reply({ ok: true, name: a.name }),
  apiSnapshot: () => { startSimulation(); return reply({ guests, status, v: ver() }); },
  apiVersion: () => reply(ver(), 80),
  apiStatus: () => reply({ status, v: ver() }),
  apiSet: (a, keys, field, val) => reply({ changed: set(a.name, keys, field, val), v: ver() }),
  apiNote: (a, k, note) => {
    status[k] = (status[k] || [0, 0, '', 0, 0, '', '', '', '']).slice();
    status[k][6] = note;
    const g = guests.find((x) => x[0] === k);
    if (g) entry(a.name, 'NOTE', g, note);
    vs = String(Date.now());
    return reply({ changed: { [k]: status[k] }, v: ver() });
  },
  apiActivity: (a, limit = 100, kind = 'all') =>
    reply(log.filter((r) => kind === 'all' || (kind === 'sheet' ? isSheet(r) : !isSheet(r))).slice(0, limit)),
  apiExport: (a, keys) => reply({ url: '', name: 'Export (demo)', count: keys.length }),
  apiPhoto: () => reply(null),
};
