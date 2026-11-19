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
    const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]'; // Dates from the script's own realm too
    return this.getValues().map((l) => l.map((v) => (isDate(v) ? v.toISOString() : v == null ? '' : String(v))));
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
  clearContent() {
    for (let r = 0; r < this.nr; r++) {
      for (let c = 0; c < this.nc; c++) if (this.sheet.data[this.row + r - 1]) this.sheet._set(this.row + r, this.col + c, '');
    }
    this.sheet.writes++;
    return this;
  }
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
    this.maxRows = 1000; this.maxCols = 26; // a new Google Sheets tab is 1000 × 26
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
  getMaxRows() { return Math.max(this.maxRows, this.data.length); }
  getMaxColumns() { return Math.max(this.maxCols, ...this.data.map((l) => l.length)); }
  insertRowsAfter(after, n) { this.maxRows = this.getMaxRows() + n; return this; }
  insertColumnsAfter(after, n) { this.maxCols = this.getMaxColumns() + n; return this; }
  deleteRows(start, n) { const m = this.getMaxRows(); this.data.splice(start - 1, n); this.maxRows = m - n; return this; }
  deleteColumns(start, n) { const m = this.getMaxColumns(); this.data.forEach((l) => l.splice(start - 1, n)); this.maxCols = m - n; return this; }
  hideSheet() { this.hidden = true; return this; }
  /* test helpers (not Apps Script API) */
  rows() { return this.data; }
  deleteRow(r) { this.data.splice(r - 1, 1); }
}

export class FakeSpreadsheet {
  constructor(id = 'EMULATOR', name = 'Guest Desk') { this.sheets = []; this.nextId = 100; this.id = id; this.name = name; }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  deleteSheet(s) {
    if (this.sheets.length < 2) throw new Error("You can't remove all the sheets in a document.");
    this.sheets.splice(this.sheets.indexOf(s), 1);
  }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error(`A sheet with the name "${n}" already exists.`);
    const s = new FakeSheet(n, this.nextId++);
    this.sheets.push(s);
    return s;
  }
  addSheet(n, rows) { const s = new FakeSheet(n, this.nextId++, rows); this.sheets.push(s); return s; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }
}

/* ── Drive (only what backups use) ── */
function makeDrive(clock) {
  const folders = [];
  let seq = 0;
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const makeFolder = (name) => {
    const files = [];
    return {
      name, files,
      getName: () => name,
      createFile: (fname, content, mime) => {
        const f = { name: fname, content, mime, trashed: false, created: new Date(clock() + seq++) };
        Object.assign(f, { getName: () => fname, getDateCreated: () => f.created, setTrashed: (v) => { f.trashed = !!v; return f; } });
        files.push(f);
        return f;
      },
      getFiles: () => iter(files.filter((f) => !f.trashed)),
    };
  };
  return {
    folders,
    getFoldersByName: (n) => iter(folders.filter((f) => f.name === n)),
    createFolder: (n) => { const f = makeFolder(n); folders.push(f); return f; },
    getFileById: () => { throw new Error('No Drive in emulator'); },
  };
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
  let offset = 0;                               // test clock: advance(ms) moves the script's time forward
  const clock = () => Date.now() + offset;
  const books = new Map([[spreadsheet.getId(), spreadsheet]]);
  let nextBook = 1;
  const drive = makeDrive(clock);
  const env = {
    SpreadsheetApp: {
      getActive: () => spreadsheet,
      openById: (id) => { if (!books.has(id)) throw new Error(`Spreadsheet ${id} not found`); return books.get(id); },
      create: (name) => {
        const b = new FakeSpreadsheet('BACKUP' + nextBook++, name);
        b.insertSheet('Sheet1');
        books.set(b.getId(), b);
        return b;
      },
      flush: () => {},
    },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        getProperties: () => Object.fromEntries(props),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    MimeType: { CSV: 'text/csv' },
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
    DriveApp: drive,
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => {
        const t = { getHandlerFunction: () => fn };
        const chain = { timeBased: () => chain, everyMinutes: () => chain, everyHours: () => chain, create: () => { triggers.push(t); return t; } };
        return chain;
      },
    },
    Logger: { log: () => {} },
    console,
  };
  const ctx = vm.createContext(env);
  ctx.__clock = clock;
  // The script's Date follows the test clock (new Date() / Date.now()); dates built from arguments are unchanged.
  vm.runInContext(`(() => {
    const RealDate = Date;
    class ClockDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(__clock()); }
      static now() { return __clock(); }
    }
    globalThis.Date = ClockDate;
  })();`, ctx);
  vm.runInContext(code, ctx, { filename: 'GuestDesk.gs' });
  const advance = (ms) => { offset += ms; };
  return { gs: ctx, ss: spreadsheet, cache, props, triggers, books, drive, advance, clock };
}

/** Calls the API exactly like the deployed web app does (doPost + JSON). */
export function post(gs, action, ...args) {
  const out = gs.doPost({ postData: { contents: JSON.stringify({ action, args }) } });
  return JSON.parse(out.getContent());
}
