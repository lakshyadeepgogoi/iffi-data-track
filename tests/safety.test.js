/**
 * Safety nets against sheet changes. Background: on 17 Nov the Sheet2 header "Printed"
 * was renamed to "To Print"; the old backend read every status as blank and logged
 * "System restored 592 statuses" 1,545 times. These tests make sure that can't recur.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createGas, FakeSpreadsheet } from '../emulator/gas.js';
import { HEADER, makeSheet2 } from '../emulator/fixture.js';

const AUTH = { name: 'Asha – Desk 1', pin: '2026' };
const C = Object.fromEntries(HEADER.map((h, i) => [h, i + 1])); // 1-based column numbers
const MIN = 60_000;

let env, gs, sheet;
const today = () => gs.today_();
const log = () => env.ss.getSheetByName('_Ops_Log').rows().slice(1);
const actions = () => log().map((r) => r[2]).filter((a) => a !== 'BACKUP');
const count = (a) => actions().filter((x) => x === a).length;
const statusLog = () => actions().filter((a) => /PRINT|DELIVER/.test(a));
const snap = () => gs.apiSnapshot(AUTH);
const keyOfRow = (row) => snap().guests.find((g) => g[1] === row)[0];
const cell = (row, col) => sheet.rows()[row - 1][C[col] - 1];
const setCell = (row, col, v) => { sheet.rows()[row - 1][C[col] - 1] = v; };
const rescan = () => { env.cache.remove('FRESH'); return gs.apiVersion(AUTH); };
const later = (min) => env.advance(min * MIN);
const printedRows = () => sheet.rows().map((r, i) => (i && r[C.Printed - 1] ? i + 1 : 0)).filter(Boolean);
const rename = (from, to) => { const h = sheet.rows()[0]; h[h.indexOf(from)] = to; };

function boot(rows = makeSheet2(120)) {
  const ss = new FakeSpreadsheet();
  sheet = ss.addSheet('Sheet2', rows);
  env = createGas({ spreadsheet: ss });
  gs = env.gs;
  gs.setup();
}

beforeEach(() => boot());

describe('header aliases', () => {
  it('"To Print" works for reading and for desk writes', () => {
    const rows = makeSheet2(40);
    rows[0][C.Printed - 1] = 'To Print';
    boot(rows);
    expect(sheet.rows()[0].filter((h) => /print/i.test(h))).toEqual(['To Print']); // setup did not add a 2nd column
    expect(snap().status[keyOfRow(5)][0]).toBe(1);
    const k = keyOfRow(2);
    gs.apiSet(AUTH, [k], 'printed', true);
    expect(cell(2, 'Printed')).toBe(today()); // same column, now headed "To Print"
    expect(snap().status[k][0]).toBe(1);
  });

  it('renaming "Printed" to "To Print" on a live sheet changes nothing', () => {
    const before = snap().status;
    rename('Printed', 'To Print');
    rescan(); rescan();
    expect(actions()).toEqual(['TRACKING STARTED']);
    expect(snap().status).toEqual(before);
    expect(snap().warnings).toEqual([]);
  });

  it('accepts the other names, case-insensitive', () => {
    const rows = makeSheet2(20);
    const alias = { 'Official Email Address': 'EMAIL', 'Mobile Number': 'mobile', Accreditation: 'Card Type', Remark: 'Remarks', Delivered: 'Delivery Date' };
    rows[0] = rows[0].map((h) => alias[h] || h);
    rows[3][C.Delivered - 1] = '16/11/26';
    boot(rows);
    const g = snap().guests.find((x) => x[1] === 4);
    expect(g[6]).toMatch(/@example\.com$/);
    expect(g[10]).toBeTruthy();
    expect(snap().status[g[0]][3]).toBe(1);
  });
});

describe('status column renamed to an unknown name', () => {
  it('freezes statuses: no RESTORED, one COLUMN MISSING, warning returned, apiSet blocked', () => {
    const before = snap().status;
    rename('Printed', 'Status');
    const rows = JSON.stringify(sheet.rows());
    for (let i = 0; i < 6; i++) { rescan(); later(1); }
    expect(actions()).not.toContain('RESTORED');
    expect(count('COLUMN MISSING')).toBe(1);
    expect(statusLog()).toEqual([]);
    const s = snap();
    expect(s.status).toEqual(before);
    expect(s.warnings).toEqual(['No "Printed" column in Sheet2 — was the header renamed? Statuses are frozen until it is back.']);
    expect(gs.apiStatus(AUTH).warnings).toHaveLength(1);
    expect(() => gs.apiSet(AUTH, [keyOfRow(2)], 'printed', true))
      .toThrow('Sheet2 has no "Printed" column — was the header renamed? Rename it back (or run setup()) and try again.');
    expect(() => gs.apiSet(AUTH, [keyOfRow(2)], 'delivered', true)).toThrow(/no "Printed" column/);
    expect(JSON.stringify(sheet.rows())).toBe(rows); // nothing written to Sheet2
  });

  it('bumps the status version once so phones pick up the warning', () => {
    const v0 = gs.apiVersion(AUTH).s;
    rename('Delivered', 'Hand-over');
    const v1 = rescan().s;
    expect(v1).not.toBe(v0);
    expect(rescan().s).toBe(v1);
    expect(snap().warnings[0]).toMatch(/No "Delivered" column/);
  });

  it('repeats the COLUMN MISSING log at most every 30 minutes', () => {
    rename('Printed', 'Status');
    rescan(); later(29); rescan();
    expect(count('COLUMN MISSING')).toBe(1);
    later(2); rescan();
    expect(count('COLUMN MISSING')).toBe(2);
  });

  it('header fixed: typed dates picked up, cleared marks not restored, one RESYNCED, no other logs', () => {
    rename('Printed', 'Status');
    rescan();
    setCell(2, 'Printed', '18/11/26');   // typed while the header was unknown
    setCell(3, 'Printed', '19/11/26');
    setCell(5, 'Printed', '');           // cleared meanwhile
    rescan();
    expect(snap().status[keyOfRow(2)]).toBeUndefined(); // still frozen
    expect(snap().status[keyOfRow(5)][0]).toBe(1);

    rename('Status', 'Printed');
    rescan();
    const s = snap();
    expect(s.status[keyOfRow(2)][0]).toBe(1);
    expect(s.status[keyOfRow(3)][7]).toBe('19/11/26');
    expect(s.status[keyOfRow(5)]).toBeUndefined();
    expect(cell(5, 'Printed')).toBe('');
    expect(s.warnings).toEqual([]);
    expect(actions()).not.toContain('RESTORED');
    expect(statusLog()).toEqual([]);
    const rs = log().filter((r) => r[2] === 'RESYNCED');
    expect(rs).toHaveLength(1);
    expect(rs[0][1]).toBe('System');
    expect(rs[0][5]).toBe('2 added · 1 cleared');
    expect(rs[0][7]).toContain('Nothing was written to Sheet2');
    expect(env.props.has('COL_MISSING')).toBe(false);
    rescan(); rescan();
    expect(count('RESYNCED')).toBe(1);
    setCell(4, 'Printed', '20/11/26');   // and normal tracking is back
    rescan();
    expect(actions().at(-1)).toBe('PRINTED');
  });

  it('setup() refuses to add an empty column over statuses on record', () => {
    rename('Printed', 'Status');
    const head = sheet.rows()[0].slice();
    expect(() => gs.setup()).toThrow(/no "Printed" column, but 30 guests have a printed value on record/);
    expect(sheet.rows()[0]).toEqual(head);
  });

  it('setup() accepts the sheet as-is: no restore, one RESYNCED, protect flags cleared', () => {
    printedRows().slice(0, 3).forEach((r) => setCell(r, 'Printed', ''));
    env.props.set('LAST_WIPE_AT', String(env.clock()));
    env.props.set('LAST_WIPE_WARN', '1');
    env.props.set('LAST_COL_WARN', '1');
    gs.setup();
    expect(statusLog()).toEqual([]);
    expect(log().filter((r) => r[2] === 'RESYNCED').map((r) => r[5])).toEqual(['0 added · 3 cleared']);
    ['LAST_WIPE_AT', 'LAST_WIPE_WARN', 'LAST_COL_WARN'].forEach((p) => expect(env.props.has(p)).toBe(false));
  });
});

describe('wipe-loop protection', () => {
  const wipe = (rows) => rows.forEach((r) => setCell(r, 'Printed', ''));

  it('restores once, then never writes to Sheet2 again within 30 minutes', () => {
    const rows = printedRows();
    wipe(rows); rescan();
    rows.forEach((r) => expect(cell(r, 'Printed')).toBe('15/11/26'));
    const writes = sheet.writes;
    for (let i = 0; i < 12; i++) { later(4); wipe(rows); rescan(); }   // 48 min of a script wiping every scan
    expect(sheet.writes).toBe(writes);
    rows.forEach((r) => expect(cell(r, 'Printed')).toBe(''));
    expect(count('RESTORED')).toBe(1);
    expect(count('WIPE LOOP')).toBe(2);   // once, then once more after 30 min
    expect(statusLog()).toEqual([]);
    const s = snap();
    rows.forEach((r) => expect(s.status[keyOfRow(r)][0]).toBe(1)); // the app still shows them printed
  });

  it('logs WIPE LOOP only once per 30 minutes', () => {
    const rows = printedRows();
    wipe(rows); rescan(); later(1); wipe(rows);
    for (let i = 0; i < 5; i++) rescan();
    expect(count('WIPE LOOP')).toBe(1);
    expect(log().find((r) => r[2] === 'WIPE LOOP')[5]).toBe('30 statuses held');
  });

  it('a desk action survives being cleared by another script; Undo from the app still works', () => {
    const rows = printedRows();
    wipe(rows); rescan(); later(1); wipe(rows); rescan();   // loop protection is on
    const k = keyOfRow(2);
    gs.apiSet(AUTH, [k], 'printed', true);
    expect(cell(2, 'Printed')).toBe(today());
    setCell(2, 'Printed', '');                               // the other script clears it
    rescan();
    expect(snap().status[k][0]).toBe(1);
    expect(actions()).not.toContain('UNDO PRINTED');
    gs.apiSet(AUTH, [k], 'printed', false);                  // the desk really undoes it
    expect(snap().status[k]).toBeUndefined();
    expect(log().at(-1).slice(1, 3)).toEqual([AUTH.name, 'UNDO PRINTED']);
    rescan();
    expect(snap().status[k]).toBeUndefined();
  });

  it('outside a loop, a single cleared cell is still an intentional UNDO', () => {
    setCell(5, 'Printed', '');
    rescan();
    expect(actions().at(-1)).toBe('UNDO PRINTED');
  });

  it('rewriteStatusesToSheet2 fills only empty cells and never overwrites a typed value', () => {
    const rows = printedRows();
    wipe(rows); rescan(); later(1); wipe(rows); rescan();
    setCell(rows[0], 'Printed', '20/11/26');   // values typed meanwhile
    setCell(rows[1], 'Printed', 'PRINTED');
    const msg = gs.rewriteStatusesToSheet2();
    expect(msg).toMatch(/Filled 28 empty Printed/);
    expect(cell(rows[0], 'Printed')).toBe('20/11/26');
    expect(cell(rows[1], 'Printed')).toBe('PRINTED');
    rows.slice(2).forEach((r) => expect(cell(r, 'Printed')).toBe('15/11/26'));
    expect(env.props.has('LAST_WIPE_AT')).toBe(false);
    expect(env.props.has('LAST_WIPE_WARN')).toBe(false);
    const n = log().length;
    rescan(); rescan();
    expect(log().length).toBe(n);
  });

  it('rewriteStatusesToSheet2 refuses while a status column is missing', () => {
    rename('Printed', 'Status');
    expect(() => gs.rewriteStatusesToSheet2()).toThrow(/no "Printed" column/);
  });
});

describe('removal grace period', () => {
  it('no REMOVED before 10 minutes, then exactly one', () => {
    sheet.deleteRow(3);
    rescan(); later(5); rescan(); later(4); rescan();
    expect(actions()).not.toContain('REMOVED');
    later(2); rescan(); rescan();
    expect(count('REMOVED')).toBe(1);
  });

  it('a department that disappears and comes back stays silent', () => {
    const dept = cell(2, 'Department');
    const status = snap().status;
    const all = sheet.rows().slice();
    sheet.data = all.filter((r, i) => i === 0 || r[C.Department - 1] !== dept);
    rescan(); later(4); rescan(); later(4); rescan();
    sheet.data = all;
    rescan(); later(20); rescan();
    expect(actions()).toEqual(['TRACKING STARTED']);
    expect(snap().status).toEqual(status);
    const tr = env.ss.getSheetByName('_Ops_Track').rows();
    expect(tr[0][15]).toBe('Missing Since');
    expect(tr.slice(1).every((r) => !r[15] && !r[14])).toBe(true);
  });

  it('upgrades a 15-column tracker from the previous version', () => {
    const track = env.ss.getSheetByName('_Ops_Track');
    track.data = track.rows().map((r) => r.slice(0, 15));
    sheet.deleteRow(3);
    rescan();
    expect(track.rows()[0][15]).toBe('Missing Since');
    later(11); rescan();
    expect(actions().at(-1)).toBe('REMOVED');
  });
});

describe('Delivered column rule', () => {
  it.each(['Paid', 'Check', 'pending', 'PRINTED'])('"%s" is NOT delivered', (v) => {
    setCell(2, 'Delivered', v);
    rescan();
    expect(snap().status[keyOfRow(2)]?.[3] || 0).toBe(0);
    expect(statusLog()).toEqual([]);
  });

  it.each(['18/11/26', '18/11/2026', 'Yes', 'y', 'Done', '✓', 'Collected', 'handed over', 'Delivred'])('"%s" is delivered', (v) => {
    setCell(2, 'Delivered', v);
    rescan();
    expect(snap().status[keyOfRow(2)][3]).toBe(1);
    expect(actions().at(-1)).toBe('DELIVERED');
  });

  it('handing over a row that says "Paid" overwrites it with today\'s date', () => {
    setCell(2, 'Delivered', 'Paid');
    rescan();
    gs.apiSet(AUTH, [keyOfRow(2)], 'delivered', true);
    expect(cell(2, 'Delivered')).toBe(today());
  });

  it('undo keeps a non-delivery note like "Paid"', () => {
    setCell(9, 'Delivered', 'Paid'); // row 9 is delivered through Remark "Deleverd"
    rescan();
    gs.apiSet(AUTH, [keyOfRow(9)], 'delivered', false);
    expect(cell(9, 'Delivered')).toBe('Paid');
    expect(cell(9, 'Remark')).toBe('');
  });

  it('status edits typed in Sheet2 bump the data version so phones refetch the rows', () => {
    const d0 = gs.apiVersion(AUTH).d;
    setCell(2, 'Printed', '17/11/26');
    expect(rescan().d).not.toBe(d0);
  });
});

describe('snapshot rows carry the raw status cells', () => {
  it('has 15 fields: … firstSeen, printedCell, deliveredCell', () => {
    setCell(2, 'Delivered', 'Check');
    rescan();
    const s = snap();
    expect(s.guests.every((g) => g.length === 15)).toBe(true);
    const g5 = s.guests.find((g) => g[1] === 5);
    const g2 = s.guests.find((g) => g[1] === 2);
    expect([g5[13], g5[14]]).toEqual(['15/11/26', '']);
    expect(g2[14]).toBe('Check');
  });
});

describe('hourly backup', () => {
  const book = () => env.books.get(env.props.get('BACKUP_SS_ID'));
  const tabs = (src) => book().getSheets().map((s) => s.getName()).filter((n) => n.endsWith(' ' + src));
  const backupLogs = () => log().filter((r) => r[2] === 'BACKUP');

  it('setup creates "IFFI Guest Desk – Backups" with one plain-text tab per source and logs BACKUP', () => {
    const bs = book();
    expect(bs.getName()).toBe('IFFI Guest Desk – Backups');
    const names = bs.getSheets().map((s) => s.getName());
    expect(names).toHaveLength(3); // the blank "Sheet1" of a new spreadsheet is removed
    names.forEach((n) => expect(n).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} (Sheet2|_Ops_Track|_Ops_Log)$/));
    const s2 = bs.getSheetByName(tabs('Sheet2')[0]);
    expect(s2.rows()).toEqual(sheet.rows().map((r) => r.map((v) => String(v))));
    expect([s2.getMaxRows(), s2.getMaxColumns()]).toEqual([121, 13]); // sized exactly, no spare cells
    const t = bs.getSheetByName(tabs('_Ops_Track')[0]).rows();
    expect(t.flat().every((v) => typeof v === 'string')).toBe(true);
    expect(backupLogs()).toHaveLength(1);
    expect(backupLogs()[0].slice(1, 3)).toEqual(['System', 'BACKUP']);
    expect(backupLogs()[0][5]).toBe('120 rows');
    expect(env.drive.folders[0].getName()).toBe('IFFI Guest Desk Backups');
    expect(env.drive.folders[0].files[0].content.split('\r\n')).toHaveLength(121);
  });

  it('adds tabs per run and keeps at most 48 runs per source tab (and 48 CSVs)', () => {
    for (let i = 0; i < 50; i++) { later(60); gs.backupNow(); }
    for (const src of ['Sheet2', '_Ops_Track', '_Ops_Log']) expect(tabs(src)).toHaveLength(48);
    const kept = tabs('Sheet2').sort();
    expect(kept.at(-1) > kept[0]).toBe(true);
    expect(env.drive.folders[0].files.filter((f) => !f.trashed)).toHaveLength(48);
    expect(backupLogs()).toHaveLength(51);
  });

  it('a second run in the same minute does not replace that minute\'s backup', () => {
    gs.backupNow();
    expect(tabs('Sheet2')).toHaveLength(2);
    expect(tabs('Sheet2').some((n) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /.test(n))).toBe(true);
  });

  it('makes a new backup spreadsheet if the old one is gone', () => {
    const old = env.props.get('BACKUP_SS_ID');
    env.books.delete(old);
    gs.backupNow();
    expect(env.props.get('BACKUP_SS_ID')).not.toBe(old);
    expect(tabs('Sheet2')).toHaveLength(1);
  });

  it('restoreFromBackup is a dry run by default and writes only with confirm', () => {
    const tab = tabs('Sheet2')[0];
    const name = cell(2, 'First Name');
    setCell(2, 'First Name', 'Changed');
    setCell(5, 'Printed', '');
    rescan();
    const dry = gs.restoreFromBackup(tab);
    expect(dry).toMatchObject({ dryRun: true, differing: 2, written: 0 });
    expect(cell(2, 'First Name')).toBe('Changed');
    const r = gs.restoreFromBackup(tab, true);
    expect(r).toMatchObject({ dryRun: false, differing: 2 });
    expect(cell(2, 'First Name')).toBe(name);
    expect(cell(5, 'Printed')).toBe('15/11/26');
    expect(snap().status[keyOfRow(5)][0]).toBe(1);
    expect(tabs('Sheet2')).toHaveLength(2);                   // the state before the restore was saved first
    expect(book().getSheetByName(tab)).toBeTruthy();           // …without replacing the chosen backup
    expect(actions().slice(-2)).toEqual(['RESYNCED', 'RESTORED']); // no per-guest noise
    expect(gs.restoreFromBackup(tab).differing).toBe(0);
  });

  it('restoreFromBackup explains bad tab names', () => {
    expect(() => gs.restoreFromBackup('nope')).toThrow(/No backup tab "nope"/);
  });

  it('Activity "Sheet2 changes" includes System entries', () => {
    const rows = gs.apiActivity(AUTH, 10, 'sheet');
    expect(rows.map((r) => r[2])).toEqual(expect.arrayContaining(['BACKUP', 'TRACKING STARTED']));
    expect(gs.apiActivity(AUTH, 10, 'desk')).toEqual([]);
  });
});
