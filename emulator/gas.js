/**
 * Minimal Google Apps Script runtime for Node: SpreadsheetApp, CacheService,
 * PropertiesService, LockService, Utilities, ContentService, ScriptApp…
 * Only the APIs GuestDesk.gs uses are implemented. Used by the tests and the
 * local emulator server, so the real backend code runs unchanged.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GS_FILE = path.resolve(HERE, '../apps-script/GuestDesk.gs');

/* ── Spreadsheet ── */
class FakeRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) line.push(this.sheet._get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((l) => l.map((v) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v))));
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((l) => l.length !== this.nc)) {
      throw new Error(`The number of rows/columns in the data does not match the range (${vals.length}x${vals[0]?.length} vs ${this.nr}x${this.nc})`);
    }
    vals.forEach((l, r) => l.forEach((v, c) => this.sheet._set(this.row + r, this.col + c, v)));
    this.sheet.writes++;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
  setNumberFormats(f) {
    if (f.length !== this.nr || f.some((l) => l.length !== this.nc)) throw new Error('Number formats do not match the range');
    return this;
  }
  setFontWeight() { return this; }
}

export class FakeSheet {
  constructor(name, id, rows = []) {
    this.name = name; this.id = id; this.hidden = false; this.writes = 0;
    this.data = rows.map((r) => r.slice());
  }
  _get(r, c) { return this.data[r - 1]?.[c - 1] ?? ''; }
  _set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const line = this.data[r - 1];
    while (line.length < c) line.push('');
    line[c - 1] = v;
  }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some((v) => v !== '' && v != null)) return r;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach((l) => { for (let c = l.length; c > m; c--) if (l[c - 1] !== '' && l[c - 1] != null) { m = c; break; } });
    return m;
  }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(a, b, c = 1, d = 1) {
    if (typeof a === 'string') return new FakeRange(this, 1, 1, 1, 1); // A1 notation only used for formats
    if (a < 1 || b < 1 || c < 1 || d < 1) throw new Error(`Invalid range ${a},${b},${c},${d}`);
    return new FakeRange(this, a, b, c, d);
  }
  setFrozenRows() { return this; }
  hideSheet() { this.hidden = true; return this; }
  /* test helpers (not Apps Script API) */
  rows() { return this.data; }
  deleteRow(r) { this.data.splice(r - 1, 1); }
}

export class FakeSpreadsheet {
  constructor() { this.sheets = []; this.nextId = 100; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error(`A sheet with the name "${n}" already exists.`);
    const s = new FakeSheet(n, this.nextId++);
    this.sheets.push(s);
    return s;
  }
  addSheet(n, rows) { const s = new FakeSheet(n, this.nextId++, rows); this.sheets.push(s); return s; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/EMULATOR/edit'; }
}

/* ── Services ── */
function makeCache() {
  const m = new Map();
  return {
    get: (k) => { const e = m.get(k); if (!e) return null; if (e.exp < Date.now()) { m.delete(k); return null; } return e.v; },
    put: (k, v, s = 600) => { m.set(k, { v: String(v), exp: Date.now() + s * 1000 }); },
    remove: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function formatDate(date, tz, fmt) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const mon = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'short' }).format(date);
  return fmt.replace(/yyyy|yy|MMM|MM|dd|HH|mm|ss/g, (t) => ({
    yyyy: parts.year, yy: parts.year.slice(2), MMM: mon, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second,
  })[t]);
}

/**
 * Creates an isolated Apps Script environment with GuestDesk.gs loaded.
 * Returns { gs, ss, cache, props, triggers } — gs exposes every top-level function.
 */
export function createGas({ spreadsheet = new FakeSpreadsheet(), code = fs.readFileSync(GS_FILE, 'utf8') } = {}) {
  const cache = makeCache();
  const props = new Map();
  const triggers = [];
  const env = {
    SpreadsheetApp: { getActive: () => spreadsheet, openById: () => spreadsheet, flush: () => {} },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      formatDate,
      base64Encode: (b) => Buffer.from(b).toString('base64'),
    },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, setMimeType() { return this; }, getContent() { return content; } }),
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: () => { throw new Error('No HTML file named Index was found.'); },
    },
    DriveApp: { getFileById: () => { throw new Error('No Drive in emulator'); } },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => {
        const t = { getHandlerFunction: () => fn };
        const chain = { timeBased: () => chain, everyMinutes: () => chain, create: () => { triggers.push(t); return t; } };
        return chain;
      },
    },
    Logger: { log: () => {} },
    console,
  };
  const ctx = vm.createContext(env);
  vm.runInContext(code, ctx, { filename: 'GuestDesk.gs' });
  return { gs: ctx, ss: spreadsheet, cache, props, triggers };
}

/** Calls the API exactly like the deployed web app does (doPost + JSON). */
export function post(gs, action, ...args) {
  const out = gs.doPost({ postData: { contents: JSON.stringify({ action, args }) } });
  return JSON.parse(out.getContent());
}
