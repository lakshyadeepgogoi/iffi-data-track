/**
 * Runs the real apps-script/GuestDesk.gs inside the emulator and checks every
 * behaviour the team relies on. `npm test`
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGas, FakeSpreadsheet, post } from '../emulator/gas.js';
import { HEADER, makeSheet2 } from '../emulator/fixture.js';

const AUTH = { name: 'Asha – Desk 1', pin: '2026' };
const C = Object.fromEntries(HEADER.map((h, i) => [h, i + 1])); // 1-based column numbers

let env, gs, sheet;
const today = () => gs.today_();
const log = () => env.ss.getSheetByName('_Ops_Log').rows().slice(1);
const actions = () => log().map((r) => r[2]).filter((a) => a !== 'BACKUP'); // hourly backups are tested separately
const snap = () => gs.apiSnapshot(AUTH);
const keyOfRow = (row) => snap().guests.find((g) => g[1] === row)[0];
const cell = (row, col) => sheet.rows()[row - 1][C[col] - 1];
const setCell = (row, col, v) => { sheet.rows()[row - 1][C[col] - 1] = v; };
const rescan = () => { env.cache.remove('FRESH'); return gs.apiVersion(AUTH); };
const MIN = 60_000;
const later = (min) => env.advance(min * MIN);

function boot(rows = makeSheet2(120)) {
  const ss = new FakeSpreadsheet();
  sheet = ss.addSheet('Sheet2', rows);
  env = createGas({ spreadsheet: ss });
  gs = env.gs;
  gs.setup();
}

beforeEach(() => boot());

describe('setup', () => {
  it('creates hidden helper tabs, PIN, a 1-minute scan and an hourly backup trigger', () => {
    expect(env.ss.getSheetByName('_Ops_Track').hidden).toBe(true);
    expect(env.ss.getSheetByName('_Ops_Log').hidden).toBe(true);
    expect(env.props.get('APP_PIN')).toBe('2026');
    expect(env.triggers.map((t) => t.getHandlerFunction())).toEqual(['reconcileTrigger', 'backupNow']);
  });

  it('logs one TRACKING STARTED entry, not one per guest', () => {
    expect(actions()).toEqual(['TRACKING STARTED']);
    expect(log()[0][5]).toBe('120 guests');
  });

  it('is safe to run twice (no duplicate trigger, no new log noise)', () => {
    gs.setup();
    expect(env.triggers).toHaveLength(2);
    expect(actions()).toEqual(['TRACKING STARTED']);
  });

  it('adds missing Printed / Delivered columns to Sheet2', () => {
    const rows = makeSheet2(5).map((r) => r.slice(0, 11));
    boot(rows);
    expect(sheet.rows()[0].slice(11, 13)).toEqual(['Printed', 'Delivered']);
  });
});

describe('auth', () => {
  it('rejects a wrong PIN with an AUTH error', () => {
    expect(() => gs.apiLogin({ name: 'x', pin: '1111' })).toThrow(/AUTH/);
    expect(post(gs, 'apiSnapshot', { name: 'x', pin: '' })).toMatchObject({ ok: false, error: expect.stringContaining('AUTH') });
  });

  it('accepts the right PIN and returns the name', () => {
    expect(gs.apiLogin(AUTH)).toMatchObject({ ok: true, name: AUTH.name });
  });

  it('neutralises names that look like formulas', () => {
    expect(gs.apiLogin({ name: '=HYPERLINK("x")', pin: '2026' }).name).toBe('\'=HYPERLINK("x")');
  });
});

describe('reading Sheet2', () => {
  it('returns every guest with a unique key', () => {
    const s = snap();
    expect(s.guests).toHaveLength(120);
    expect(new Set(s.guests.map((g) => g[0])).size).toBe(120);
  });

  it('strips invisible characters from department names', () => {
    expect(snap().guests.some((g) => g[2].includes('⁠'))).toBe(false);
  });

  it('treats a date in Printed as printed and keeps the raw value', () => {
    const k = keyOfRow(5); // fixture row 5 = guest 4 → printed 15/11/26
    const st = snap().status[k];
    expect(st[0]).toBe(1);
    expect(st[7]).toBe('15/11/26');
  });

  it('treats Remark "Deleverd" as delivered', () => {
    const k = keyOfRow(9); // guest 8
    const st = snap().status[k];
    expect(st[3]).toBe(1);
    expect(st[8]).toBe('Remark: Deleverd');
  });

  it('gives duplicate dept+email rows different keys', () => {
    const rows = makeSheet2(3);
    rows.push(rows[2].slice());
    boot(rows);
    const keys = snap().guests.map((g) => g[0]);
    expect(new Set(keys).size).toBe(4);
    expect(keys[3]).toMatch(/#2$/);
  });

  it('finds columns by header name in any order', () => {
    const rows = makeSheet2(10).map((r) => [r[12], r[11], ...r.slice(0, 11)]);
    boot(rows);
    const k = snap().guests.find((g) => g[1] === 5)[0];
    expect(snap().status[k][0]).toBe(1);
  });
});

describe('desk actions write into Sheet2', () => {
  it('Mark printed writes today\'s date in the Printed column', () => {
    const k = keyOfRow(2);
    const r = gs.apiSet(AUTH, [k], 'printed', true);
    expect(cell(2, 'Printed')).toBe(today());
    expect(r.changed[k][0]).toBe(1);
    expect(r.changed[k][2]).toBe(AUTH.name);
    expect(actions().at(-1)).toBe('PRINTED');
  });

  it('Hand over on an unprinted card fills both Printed and Delivered', () => {
    gs.apiSet(AUTH, [keyOfRow(2)], 'delivered', true);
    expect(cell(2, 'Printed')).toBe(today());
    expect(cell(2, 'Delivered')).toBe(today());
  });

  it('keeps an existing print date when delivering', () => {
    gs.apiSet(AUTH, [keyOfRow(5)], 'delivered', true);
    expect(cell(5, 'Printed')).toBe('15/11/26');
  });

  it('Undo printed clears both columns', () => {
    const k = keyOfRow(2);
    gs.apiSet(AUTH, [k], 'delivered', true);
    gs.apiSet(AUTH, [k], 'printed', false);
    expect(cell(2, 'Printed')).toBe('');
    expect(cell(2, 'Delivered')).toBe('');
    expect(snap().status[k]).toBeUndefined();
  });

  it('Undo delivery on a Remark-delivered guest removes only the delivered word', () => {
    const k = keyOfRow(9);
    setCell(9, 'Remark', 'Deleverd, collected by driver'.replace('collected', 'picked up'));
    rescan();
    gs.apiSet(AUTH, [k], 'delivered', false);
    expect(cell(9, 'Remark')).toBe('picked up by driver');
    expect(snap().status[k]?.[3] || 0).toBe(0);
  });

  it('does not touch other rows in bulk updates with gaps', () => {
    const rows = [2, 3, 4, 10, 11, 40];
    const before = sheet.rows().map((r) => r.slice());
    gs.apiSet(AUTH, rows.map(keyOfRow), 'printed', true);
    sheet.rows().forEach((r, i) => {
      if (rows.includes(i + 1)) expect(r[C.Printed - 1]).toBeTruthy();
      else expect(r[C.Printed - 1] ?? '').toBe(before[i][C.Printed - 1] ?? '');
    });
  });

  it('ignores unknown keys and repeated keys', () => {
    const k = keyOfRow(2);
    const r = gs.apiSet(AUTH, [k, k, 'nope'], 'printed', true);
    expect(Object.keys(r.changed)).toEqual([k]);
    expect(actions().filter((a) => a === 'PRINTED')).toHaveLength(1);
  });

  it('does not log when nothing changes (already printed)', () => {
    gs.apiSet(AUTH, [keyOfRow(5)], 'printed', true);
    expect(actions()).toEqual(['TRACKING STARTED']);
  });

  it('rejects bad fields', () => {
    expect(() => gs.apiSet(AUTH, [keyOfRow(2)], 'paid', true)).toThrow(/Bad field/);
  });

  it('bumps the status version so other phones refresh', () => {
    const v0 = gs.apiVersion(AUTH).s;
    gs.apiSet(AUTH, [keyOfRow(2)], 'printed', true);
    expect(gs.apiVersion(AUTH).s).not.toBe(v0);
  });

  it('saves desk notes without touching Sheet2', () => {
    const k = keyOfRow(2);
    const before = JSON.stringify(sheet.rows());
    gs.apiNote(AUTH, k, 'Call after 5 PM');
    expect(snap().status[k][6]).toBe('Call after 5 PM');
    expect(JSON.stringify(sheet.rows())).toBe(before);
  });
});

describe('tracking changes made directly in Sheet2', () => {
  it('picks up Printed typed by hand and logs it as Sheet2', () => {
    const k = keyOfRow(2);
    setCell(2, 'Printed', '17/11/26');
    rescan();
    expect(snap().status[k][0]).toBe(1);
    const last = log().at(-1);
    expect(last.slice(1, 3)).toEqual(['Sheet2', 'PRINTED']);
  });

  it('picks up Printed cleared by hand', () => {
    setCell(5, 'Printed', '');
    rescan();
    expect(actions().at(-1)).toBe('UNDO PRINTED');
  });

  it('picks up "Deleverd" typed into Remark as delivered', () => {
    const k = keyOfRow(2);
    setCell(2, 'Remark', 'Delivered');
    rescan();
    expect(snap().status[k][3]).toBe(1);
  });

  it('logs NEW GUEST when the sync adds a row and bumps the data version', () => {
    const v0 = gs.apiVersion(AUTH).d;
    sheet.rows().push([121, 'CMOT Guest', 'New', 'Person', '', 'new.person@example.com', '9999999999', '', '', 'Official Invitee', '', '', '']);
    rescan();
    expect(actions().at(-1)).toBe('NEW GUEST');
    expect(gs.apiVersion(AUTH).d).not.toBe(v0);
    expect(snap().guests.at(-1)[12]).toBeGreaterThan(0); // first-seen time
  });

  it('logs ID ASSIGNED when a User ID appears', () => {
    setCell(10, 'User ID', '777777'); // guest 9 had no ID
    rescan();
    const last = log().at(-1);
    expect(last[2]).toBe('ID ASSIGNED');
    expect(last[7]).toContain('777777');
  });

  it('logs UPDATED with before → after for other edits', () => {
    setCell(3, 'Accreditation', 'Official Invitee');
    rescan();
    const last = log().at(-1);
    expect(last[2]).toBe('UPDATED');
    expect(last[7]).toMatch(/Accreditation: .* → Official Invitee/);
  });

  it('logs REMOVED when a row has been gone for 10 minutes', () => {
    sheet.deleteRow(3);
    rescan();
    later(10);
    rescan();
    expect(actions().at(-1)).toBe('REMOVED');
  });

  it('keeps each guest\'s status when the sync re-orders rows', () => {
    const k = keyOfRow(5);
    const [head, ...body] = sheet.rows();
    sheet.data = [head, ...body.reverse()];
    rescan();
    expect(snap().status[k][0]).toBe(1);
    expect(actions()).toEqual(['TRACKING STARTED']);
  });

  it('restores Printed dates wiped by a re-sync', () => {
    const printedRows = sheet.rows().map((r, i) => (i && r[C.Printed - 1] ? i + 1 : 0)).filter(Boolean);
    expect(printedRows.length).toBeGreaterThanOrEqual(10);
    printedRows.forEach((r) => setCell(r, 'Printed', ''));
    rescan();
    printedRows.forEach((r) => expect(cell(r, 'Printed')).toBe('15/11/26'));
    expect(actions().at(-1)).toBe('RESTORED');
  });

  it('waits instead of marking everyone removed while the sync is mid-rewrite', () => {
    sheet.data = sheet.rows().slice(0, 20);
    rescan();
    expect(actions()).not.toContain('REMOVED');
    expect(() => gs.apiSet(AUTH, ['x'], 'printed', true)).toThrow(/re-synced/);
  });
});

describe('activity, export and the HTTP API', () => {
  it('returns activity newest first and filters by kind', () => {
    gs.apiSet(AUTH, [keyOfRow(2)], 'printed', true);
    setCell(3, 'Printed', '17/11/26');
    rescan();
    const all = gs.apiActivity(AUTH, 10, 'all');
    expect(all[0][1]).toBe('Sheet2');
    expect(gs.apiActivity(AUTH, 10, 'desk').every((r) => r[1] === AUTH.name)).toBe(true);
    expect(gs.apiActivity(AUTH, 10, 'sheet').every((r) => ['Sheet2', 'System'].includes(r[1]))).toBe(true);
  });

  it('exports selected guests to a new tab', () => {
    const keys = [keyOfRow(2), keyOfRow(5)];
    const r = gs.apiExport(AUTH, keys, 'Vendor');
    expect(r.count).toBe(2);
    const tab = env.ss.getSheetByName(r.name);
    expect(tab.rows()).toHaveLength(3);
    expect(tab.rows()[2][9]).toBe('15/11/26');
  });

  it('routes doPost actions and reports errors as JSON', () => {
    expect(post(gs, 'apiLogin', AUTH)).toMatchObject({ ok: true });
    expect(post(gs, 'dropTables', AUTH)).toMatchObject({ ok: false, error: expect.stringContaining('Unknown action') });
    const bad = JSON.parse(gs.doPost({ postData: { contents: '{not json' } }).getContent());
    expect(bad.ok).toBe(false);
  });

  it('doGet returns a health check when no Index page is pasted', () => {
    expect(JSON.parse(gs.doGet().getContent()).ok).toBe(true);
  });

  it('apiVersion re-scans at most every few seconds', () => {
    gs.apiVersion(AUTH);
    setCell(2, 'Printed', '17/11/26');
    const before = log().length;
    gs.apiVersion(AUTH); // cached → no scan yet
    expect(log().length).toBe(before);
    rescan();
    expect(log().length).toBe(before + 1);
  });
});

describe('first-seen times', () => {
  it('are blank for guests that existed before tracking began', () => {
    expect(snap().guests.every((g) => g[12] === 0)).toBe(true);
  });
});

describe('performance safeguards', () => {
  it('writes scattered bulk updates in one call and still hits exactly the right rows', () => {
    boot(makeSheet2(400));
    const s = snap();
    const targets = s.guests.filter((g, i) => i % 3 === 0 && !s.status[g[0]]); // ~100 scattered rows
    const before = sheet.rows().map((r) => r.slice());
    const writes0 = sheet.writes;
    gs.apiSet(AUTH, targets.map((g) => g[0]), 'printed', true);
    expect(sheet.writes - writes0).toBeLessThanOrEqual(2);
    const hit = new Set(targets.map((g) => g[1]));
    sheet.rows().forEach((r, i) => {
      if (i === 0) return;
      const was = before[i][C.Printed - 1];
      expect(r[C.Printed - 1]).toBe(hit.has(i + 1) ? today() : was);
      expect(r.filter((_, c) => c !== C.Printed - 1)).toEqual(before[i].filter((_, c) => c !== C.Printed - 1));
    });
  });

  it('stores tracker values as text so a re-scan finds no false changes', () => {
    const logs = log().length;
    rescan(); rescan();
    expect(log().length).toBe(logs);
    const tr = env.ss.getSheetByName('_Ops_Track').rows().slice(1);
    expect(tr.every((r) => typeof r[0] === 'string' && typeof r[5] === 'string' && typeof r[12] === 'string')).toBe(true);
  });
});
