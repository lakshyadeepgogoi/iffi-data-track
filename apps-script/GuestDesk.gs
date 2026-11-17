/**
 * IFFI Guest Desk — backend (Google Apps Script)
 * ─────────────────────────────────────────────────────────────────────────────
 * Sheet2 is the single source of truth.
 *   • Guest data      → read from Sheet2 (whatever your form sync writes there)
 *   • Printed status  → Sheet2 "Printed" column   (a date like 16/11/26 = printed)
 *   • Delivered status→ Sheet2 "Delivered" column (a date = delivered), or a Remark
 *                       such as "Delivered" / "Deleverd" (how the team marked it so far)
 *
 * The app writes dates into those same columns, so the sheet always shows the truth
 * and anything typed by hand in Sheet2 shows up in the app within seconds.
 *
 * Two hidden helper tabs are created (never edit them by hand):
 *   _Ops_Track  remembers what Sheet2 looked like last time, so every change can be
 *               detected and logged (new guest, User ID assigned, edits, printed,
 *               delivered, removed) and who/when for each card
 *   _Ops_Log    the full audit trail shown in the app's Activity tab
 *
 * Setup: paste this file → run setup() once → Deploy as Web app (Execute as: Me,
 * Who has access: Anyone). Full guide in README.md.
 */

const CFG = {
  SPREADSHEET_ID: '',          // leave blank when the script is bound to the spreadsheet
  SOURCE_SHEET: 'Sheet2',
  TRACK_SHEET: '_Ops_Track',
  LOG_SHEET: '_Ops_Log',
  TZ: 'Asia/Kolkata',
  DATE_FORMAT: 'dd/MM/yy',     // same format the team already types into "Printed"
  CHECK_SECONDS: 8,            // how often (at most) Sheet2 is re-scanned for changes
  WIPE_MIN_ROWS: 10,           // this many statuses vanishing at once = a re-sync wiped them → restore
  MIN_ROWS_RATIO: 0.5,         // Sheet2 suddenly has < 50 % of known guests = sync in progress → wait
  DEFAULT_PIN: '2026',
};

/** Sheet2 headers (matched case-insensitively, any column order). */
const COL = {
  dept: 'Department', first: 'First Name', last: 'Last Name', desig: 'Designation/Job Title',
  email: 'Official Email Address', mobile: 'Mobile Number', photo: 'Photograph URL',
  uid: 'User ID', accr: 'Accreditation', remark: 'Remark', printed: 'Printed', delivered: 'Delivered',
};
/** Fields whose edits are tracked and logged. */
const TRACKED = ['first', 'last', 'desig', 'email', 'mobile', 'photo', 'uid', 'accr', 'remark'];
const LABEL = {
  first: 'First name', last: 'Last name', desig: 'Designation', email: 'Email', mobile: 'Mobile',
  photo: 'Photo', uid: 'User ID', accr: 'Accreditation', remark: 'Remark',
};

/* _Ops_Track columns */
const T = { key: 0, row: 1, dept: 2, name: 3, uid: 4, pRaw: 5, dRaw: 6, pAt: 7, pBy: 8, dAt: 9, dBy: 10, note: 11, fp: 12, firstSeen: 13, removed: 14 };
const TRACK_HEAD = ['Key', 'Sheet2 Row', 'Department', 'Name', 'User ID', 'Printed (last seen)', 'Delivered (last seen)',
  'Printed At', 'Printed By', 'Delivered At', 'Delivered By', 'Desk Note', 'Fingerprint', 'First Seen', 'Removed At'];
const LOG_HEAD = ['Time', 'By', 'Action', 'Key', 'User ID', 'Name', 'Department', 'Details'];

const SHEET_ACTOR = 'Sheet2';    // "who" for changes made directly in the sheet
const SYSTEM_ACTOR = 'System';
const FP_SEP = '␟';
const DELIVERED_WORD = /\b(?:del[ie]v[ae]?re?d|collected|handed over)\b/i;
const NOT_WORD = /\b(?:not|un|pending)\b/i;

/* ══════════════════════════ Web app entry points ══════════════════════════ */

/** GET: serves the single-file React build if pasted as HTML file "Index",
 *  otherwise a JSON health check (open the /exec URL to confirm it works). */
function doGet() {
  try {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('IFFI Guest Desk')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (e) {
    return json_({ ok: true, data: { service: 'IFFI Guest Desk API', source: CFG.SOURCE_SHEET, time: new Date().toISOString() } });
  }
}

/** POST: JSON API for the hosted React app.
 *  Body (sent as text/plain to avoid a CORS preflight): {"action":"apiSnapshot","args":[auth, ...]} */
function doPost(e) {
  const ACTIONS = {
    apiLogin: apiLogin, apiSnapshot: apiSnapshot, apiVersion: apiVersion, apiStatus: apiStatus,
    apiSet: apiSet, apiNote: apiNote, apiActivity: apiActivity, apiExport: apiExport, apiPhoto: apiPhoto,
  };
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = ACTIONS[body.action];
    if (!fn) throw new Error('Unknown action: ' + body.action);
    return json_({ ok: true, data: fn.apply(null, body.args || []) });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ══════════════════════════ Setup & triggers ══════════════════════════ */

/** Run once from the editor (safe to run again). */
function setup() {
  const ss = ss_();
  const sh = ss.getSheetByName(CFG.SOURCE_SHEET);
  if (!sh) throw new Error('Sheet "' + CFG.SOURCE_SHEET + '" not found');

  // Make sure Sheet2 has the two status columns.
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return clean_(h).toLowerCase(); });
  let next = head.length;
  while (next > 0 && !head[next - 1]) next--;          // first empty column after the last header
  ['printed', 'delivered'].forEach(function (k) {
    if (head.indexOf(COL[k].toLowerCase()) < 0) {
      next++;
      sh.getRange(1, next, 1, 1).setValues([[COL[k]]]).setFontWeight('bold');
    }
  });

  ensureSheet_(ss, CFG.TRACK_SHEET, TRACK_HEAD);
  ensureSheet_(ss, CFG.LOG_SHEET, LOG_HEAD);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_PIN')) props.setProperty('APP_PIN', CFG.DEFAULT_PIN);

  const res = withLock_(function () { return reconcile_(); });

  // Re-scan every minute even when no phone is open, so the log never misses a change.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'reconcileTrigger') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reconcileTrigger').timeBased().everyMinutes(1).create();

  const msg = 'Setup done. Tracking ' + res.src.guests.length + ' guests from ' + CFG.SOURCE_SHEET +
    '. PIN = ' + props.getProperty('APP_PIN') + ' (change in Project Settings → Script properties → APP_PIN).';
  Logger.log(msg);
  return msg;
}

/** Time-driven trigger (installed by setup). */
function reconcileTrigger() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    reconcile_();
    CacheService.getScriptCache().put('FRESH', '1', CFG.CHECK_SECONDS);
  } finally {
    lock.releaseLock();
  }
}

/** Optional: call at the end of your own sync function so phones see new rows instantly. */
function guestDeskDataChanged() {
  reconcileTrigger();
}

/* ══════════════════════════ Public API ══════════════════════════ */

function apiLogin(auth) {
  return api_(auth, function (who) { return { ok: true, name: who }; });
}

function apiSnapshot(auth) {
  return api_(auth, function () {
    const res = withLock_(function () { return reconcile_(); });
    CacheService.getScriptCache().put('FRESH', '1', CFG.CHECK_SECONDS);
    return {
      guests: res.src.guests.map(function (g) {
        const t = trackOf_(res.tr, g.key);
        return [g.key, g.row, g.dept, g.first, g.last, g.desig, g.email, g.mobile, driveId_(g.photo), g.uid, g.accr, g.remark,
          t ? ts_(t[T.firstSeen]) : 0];
      }),
      status: statusMap_(res),
      v: currentVersions_(),
      now: Date.now(),
    };
  });
}

/** Cheap call every phone makes every few seconds. Re-scans Sheet2 at most every CHECK_SECONDS. */
function apiVersion(auth) {
  return api_(auth, function () { return versions_(); });
}

function apiStatus(auth) {
  return api_(auth, function () {
    const res = withLock_(function () { return reconcile_(); });
    return { status: statusMap_(res), v: currentVersions_() };
  });
}

/** field: 'printed' | 'delivered', value: true/false. Writes dates straight into Sheet2. */
function apiSet(auth, keys, field, value, note) {
  return api_(auth, function (who) {
    if (field !== 'printed' && field !== 'delivered') throw new Error('Bad field: ' + field);
    value = !!value;
    keys = uniq_(keys || []).slice(0, 3000);
    return withLock_(function () {
      const res = reconcile_();
      if (res.skipped) throw new Error(CFG.SOURCE_SHEET + ' is being re-synced right now. Try again in a few seconds.');
      const src = res.src;
      if (src.idx.printed < 0 || src.idx.delivered < 0) throw new Error('Sheet2 needs "Printed" and "Delivered" columns. Run setup().');
      const gmap = byKey_(src.guests);
      const today = today_();
      const now = new Date();
      const cells = { printed: [], delivered: [], remark: [] };
      const changed = {};
      const logs = [];
      let dirty = false;

      keys.forEach(function (k) {
        const g = gmap[k];
        if (!g) return;
        const t = trackOf_(res.tr, k);
        const before = statusOf_(g, t);
        let p = g.printedRaw, d = g.deliveredRaw, rem = g.remark;

        if (field === 'printed') {
          if (value) { if (!truthy_(p)) p = today; }
          else { p = ''; d = ''; rem = stripDelivered_(rem); }   // not printed ⇒ not delivered
        } else if (value) {
          if (!truthy_(d) && !remarkDelivered_(rem)) d = today;
          if (!truthy_(p)) p = today;                           // delivered ⇒ printed
        } else {
          d = ''; rem = stripDelivered_(rem);
        }

        if (p !== g.printedRaw) cells.printed.push({ row: g.row, value: p });
        if (d !== g.deliveredRaw) cells.delivered.push({ row: g.row, value: d });
        if (rem !== g.remark && src.idx.remark >= 0) cells.remark.push({ row: g.row, value: rem });
        g.printedRaw = p; g.deliveredRaw = d; g.remark = rem;

        const after = statusOf_(g, null);
        t[T.pRaw] = p; t[T.dRaw] = d; t[T.fp] = fingerprint_(g);
        if (after[0] && !before[0]) { t[T.pAt] = now; t[T.pBy] = who; }
        if (!after[0]) { t[T.pAt] = ''; t[T.pBy] = ''; }
        if (after[3] && !before[3]) { t[T.dAt] = now; t[T.dBy] = who; }
        if (!after[3]) { t[T.dAt] = ''; t[T.dBy] = ''; }
        dirty = true;

        const final = statusOf_(g, t);
        if (final[0] !== before[0] || final[3] !== before[3]) {
          changed[k] = final;
          logs.push(logRow_(now, who, (value ? '' : 'UNDO ') + field.toUpperCase(), g, note || ''));
        }
      });

      writeCells_(src, src.idx.printed + 1, cells.printed);
      writeCells_(src, src.idx.delivered + 1, cells.delivered);
      writeCells_(src, src.idx.remark + 1, cells.remark);
      if (dirty) writeTrack_(res.tr);
      if (logs.length) { appendLog_(logs); bump_('S'); }
      return { changed: changed, v: currentVersions_() };
    });
  });
}

function apiNote(auth, key, note) {
  return api_(auth, function (who) {
    return withLock_(function () {
      const res = reconcile_();
      if (res.skipped) throw new Error(CFG.SOURCE_SHEET + ' is being re-synced right now. Try again in a few seconds.');
      const g = byKey_(res.src.guests)[key];
      if (!g) throw new Error('Guest not found in Sheet2 (it may have been edited). Refresh and retry.');
      const t = trackOf_(res.tr, key);
      t[T.note] = safe_(String(note || '').slice(0, 500));
      writeTrack_(res.tr);
      appendLog_([logRow_(new Date(), who, 'NOTE', g, t[T.note])]);
      bump_('S');
      const out = {};
      out[key] = statusOf_(g, t);
      return { changed: out, v: currentVersions_() };
    });
  });
}

/** kind: 'all' | 'desk' (staff actions) | 'sheet' (changes found in Sheet2). Newest first. */
function apiActivity(auth, limit, kind) {
  return api_(auth, function () {
    const sh = ss_().getSheetByName(CFG.LOG_SHEET);
    if (!sh || sh.getLastRow() < 2) return [];
    limit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const n = sh.getLastRow() - 1;
    const take = Math.min(n, kind && kind !== 'all' ? limit * 5 : limit);
    const rows = sh.getRange(n - take + 2, 1, take, LOG_HEAD.length).getValues().reverse();
    const isSheet = function (r) { return r[1] === SHEET_ACTOR || r[1] === SYSTEM_ACTOR; };
    return rows
      .filter(function (r) { return !kind || kind === 'all' || (kind === 'sheet' ? isSheet(r) : !isSheet(r)); })
      .slice(0, limit)
      .map(function (r) { return [ts_(r[0]), String(r[1]), String(r[2]), String(r[3]), String(r[4]), String(r[5]), String(r[6]), String(r[7])]; });
  });
}

/** Copies the selected guests to a new tab (e.g. for the print vendor). */
function apiExport(auth, keys, label) {
  return api_(auth, function (who) {
    const res = withLock_(function () { return reconcile_(); });
    const set = {};
    (keys || []).forEach(function (k) { set[k] = true; });
    const rows = res.src.guests.filter(function (g) { return set[g.key]; }).map(function (g) {
      const s = statusOf_(g, trackOf_(res.tr, g.key));
      return [g.uid, g.first, g.last, g.desig, g.dept, g.accr, g.mobile, g.email, g.photo, s[7], s[8]];
    });
    const name = safe_(('Export ' + Utilities.formatDate(new Date(), CFG.TZ, 'dd-MMM HHmm') + ' ' + (label || '')).slice(0, 90).trim());
    const sh = ss_().insertSheet(name);
    const head = ['User ID', 'First Name', 'Last Name', 'Designation', 'Department', 'Card Type', 'Mobile', 'Email', 'Photo URL', 'Printed', 'Delivered'];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    if (rows.length) sh.getRange(2, 1, rows.length, head.length).setNumberFormat('@').setValues(rows);
    sh.setFrozenRows(1);
    appendLog_([[new Date(), who, 'EXPORT', '', '', rows.length + ' guests', '', name]]);
    return { url: ss_().getUrl() + '#gid=' + sh.getSheetId(), name: name, count: rows.length };
  });
}

/** Photo through the owner's Drive access (staff may not see the upload folder). */
function apiPhoto(auth, id) {
  return api_(auth, function () {
    if (!/^[\w-]{10,}$/.test(id || '')) return null;
    const cache = CacheService.getScriptCache();
    const hit = cache.get('PH_' + id);
    if (hit) return hit;
    try {
      const file = DriveApp.getFileById(id);
      let blob = file.getThumbnail();
      if (!blob && file.getSize() < 3.5e6) blob = file.getBlob();
      if (!blob) return null;
      const url = 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
      if (url.length < 95000) cache.put('PH_' + id, url, 21600);
      return url;
    } catch (e) {
      return null;
    }
  });
}

/* ══════════════════════════ Change tracking ══════════════════════════ */

/**
 * Compares Sheet2 with what was seen last time and records every difference.
 * Must run inside the script lock. Returns { src, tr, skipped }.
 */
function reconcile_() {
  const src = readSource_();
  const tr = readTrack_();
  const now = new Date();
  const res = { src: src, tr: tr, skipped: false };

  const active = tr.rows.filter(function (r) { return r[T.key] && !r[T.removed]; }).length;
  if (active >= 20 && src.guests.length < active * CFG.MIN_ROWS_RATIO) {
    res.skipped = true;                     // sync is mid-rewrite; look again next time
    return res;
  }

  const firstRun = tr.rows.length === 0;
  const logs = [];
  const statusChanges = [];
  const present = {};
  let dirty = false, dataChanged = false, statusChanged = false;

  src.guests.forEach(function (g) {
    present[g.key] = true;
    const fp = fingerprint_(g);
    let t = trackOf_(tr, g.key);

    if (!t) {
      t = [g.key, g.row, g.dept, g.name, g.uid, g.printedRaw, g.deliveredRaw, '', '', '', '', '', fp, firstRun ? '' : now, ''];  // rows present before tracking began have no first-seen time
      tr.rows.push(t);
      tr.map[g.key] = tr.rows.length - 1;
      dirty = dataChanged = true;
      if (!firstRun) logs.push(logRow_(now, SHEET_ACTOR, 'NEW GUEST', g, [g.accr, g.uid ? 'ID ' + g.uid : 'no User ID yet'].filter(String).join(' · ')));
      return;
    }

    if (t[T.removed]) {
      t[T.removed] = '';
      dirty = dataChanged = true;
      logs.push(logRow_(now, SHEET_ACTOR, 'BACK IN SHEET', g, ''));
    }

    if (String(t[T.fp]) !== fp) {
      const diff = diff_(String(t[T.fp]), g);
      if (diff.length) {
        const idAssigned = diff.length === 1 && diff[0].k === 'uid' && !diff[0].from;
        logs.push(logRow_(now, SHEET_ACTOR, idAssigned ? 'ID ASSIGNED' : 'UPDATED', g,
          diff.map(function (c) { return LABEL[c.k] + ': ' + (c.from || '—') + ' → ' + (c.to || '—'); }).join('; ').slice(0, 1000)));
        if (diff.some(function (c) { return c.k === 'remark' && remarkDelivered_(c.from) !== remarkDelivered_(c.to); })) {
          statusChanged = true;
          const delivered = remarkDelivered_(g.remark) || truthy_(g.deliveredRaw);
          t[T.dAt] = delivered ? (t[T.dAt] || now) : '';
          t[T.dBy] = delivered ? (t[T.dBy] || SHEET_ACTOR) : '';
        }
      }
      t[T.fp] = fp;
      dirty = dataChanged = true;
    }

    if (Number(t[T.row]) !== g.row || t[T.dept] !== g.dept || t[T.name] !== g.name || String(t[T.uid]) !== g.uid) {
      t[T.row] = g.row; t[T.dept] = g.dept; t[T.name] = g.name; t[T.uid] = g.uid;
      dirty = true;
    }

    if (g.printedRaw !== String(t[T.pRaw])) statusChanges.push({ g: g, t: t, field: 'printed', from: String(t[T.pRaw]), to: g.printedRaw });
    if (g.deliveredRaw !== String(t[T.dRaw])) statusChanges.push({ g: g, t: t, field: 'delivered', from: String(t[T.dRaw]), to: g.deliveredRaw });
  });

  tr.rows.forEach(function (t) {
    if (t[T.key] && !present[t[T.key]] && !t[T.removed]) {
      t[T.removed] = now;
      dirty = dataChanged = true;
      logs.push([now, SHEET_ACTOR, 'REMOVED', t[T.key], String(t[T.uid]), t[T.name], t[T.dept], 'Row no longer in ' + CFG.SOURCE_SHEET]);
    }
  });

  // A re-sync that blanks many statuses at once is restored, not accepted.
  const wipes = statusChanges.filter(function (c) { return truthy_(c.from) && !c.to; });
  let restoreSet = [];
  if (!firstRun && wipes.length >= CFG.WIPE_MIN_ROWS && wipes.length >= statusChanges.length * 0.8) {
    restoreSet = wipes;
    const cells = { printed: [], delivered: [] };
    wipes.forEach(function (c) {
      cells[c.field].push({ row: c.g.row, value: c.from });
      if (c.field === 'printed') c.g.printedRaw = c.from; else c.g.deliveredRaw = c.from;
    });
    writeCells_(src, src.idx.printed + 1, cells.printed);
    writeCells_(src, src.idx.delivered + 1, cells.delivered);
    logs.push([now, SYSTEM_ACTOR, 'RESTORED', '', '', wipes.length + ' statuses', '',
      'Printed/Delivered were blanked by a re-sync of ' + CFG.SOURCE_SHEET + ' and have been written back']);
  }

  statusChanges.forEach(function (c) {
    if (restoreSet.indexOf(c) >= 0) return;
    const t = c.t, g = c.g;
    const wasOn = truthy_(c.from), isOn = truthy_(c.to);
    if (c.field === 'printed') {
      t[T.pRaw] = c.to;
      if (isOn && !wasOn) { t[T.pAt] = now; t[T.pBy] = SHEET_ACTOR; }
      if (!isOn) { t[T.pAt] = ''; t[T.pBy] = ''; }
    } else {
      t[T.dRaw] = c.to;
      const delivered = isOn || remarkDelivered_(g.remark);
      if (delivered && !t[T.dAt]) { t[T.dAt] = now; t[T.dBy] = SHEET_ACTOR; }
      if (!delivered) { t[T.dAt] = ''; t[T.dBy] = ''; }
    }
    dirty = statusChanged = true;
    if (wasOn !== isOn) {
      logs.push(logRow_(now, SHEET_ACTOR, (isOn ? '' : 'UNDO ') + c.field.toUpperCase(), g, c.to ? 'Sheet2 value: ' + c.to : 'cleared in Sheet2'));
    }
  });

  if (firstRun) {
    logs.length = 0;
    logs.push([now, SYSTEM_ACTOR, 'TRACKING STARTED', '', '', src.guests.length + ' guests', '', 'Watching ' + CFG.SOURCE_SHEET]);
  }
  if (dirty) writeTrack_(tr);
  if (logs.length) appendLog_(logs);
  if (dataChanged) bump_('D');
  if (statusChanged || restoreSet.length) bump_('S');
  return res;
}

function diff_(oldFp, g) {
  const old = oldFp.split(FP_SEP);
  const out = [];
  TRACKED.forEach(function (k, i) {
    const from = old[i] === undefined ? '' : old[i];
    if (from !== g[k]) out.push({ k: k, from: k === 'photo' ? (from ? 'yes' : '') : from, to: k === 'photo' ? (g[k] ? 'yes' : '') : g[k] });
  });
  return out;
}

function fingerprint_(g) {
  return TRACKED.map(function (k) { return g[k]; }).join(FP_SEP);
}

/* ══════════════════════════ Status rules ══════════════════════════ */

/** [printed, printedAt, printedBy, delivered, deliveredAt, deliveredBy, note, printedRaw, deliveredRaw] */
function statusOf_(g, t) {
  const p = truthy_(g.printedRaw);
  const dCol = truthy_(g.deliveredRaw);
  const dRem = remarkDelivered_(g.remark);
  const d = dCol || dRem;
  return [
    p ? 1 : 0,
    p ? (t && ts_(t[T.pAt])) || parseDate_(g.printedRaw) : 0,
    p ? String((t && t[T.pBy]) || '') : '',
    d ? 1 : 0,
    d ? (t && ts_(t[T.dAt])) || parseDate_(g.deliveredRaw) : 0,
    d ? String((t && t[T.dBy]) || '') : '',
    String((t && t[T.note]) || ''),
    p ? g.printedRaw : '',
    dCol ? g.deliveredRaw : dRem ? 'Remark: ' + g.remark : '',
  ];
}

function statusMap_(res) {
  const out = {};
  res.src.guests.forEach(function (g) {
    const s = statusOf_(g, trackOf_(res.tr, g.key));
    if (s[0] || s[3] || s[6]) out[g.key] = s;
  });
  return out;
}

/** A cell counts as "yes" when it has any value except an explicit no. */
function truthy_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return !/^(no|n|false|0|-|na|n\/a|pending|not printed|not delivered|✗|x)$/i.test(s);
}

function remarkDelivered_(remark) {
  const s = String(remark || '');
  return DELIVERED_WORD.test(s) && !NOT_WORD.test(s);
}

function stripDelivered_(remark) {
  if (!remarkDelivered_(remark)) return remark;
  return String(remark).replace(DELIVERED_WORD, '').replace(/\s{2,}/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');
}

/** "15/11/26", "15/11/2026", "15-11-2026", "2026-11-15" → epoch ms (IST midnight). */
function parseDate_(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  let y, mo, d;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  return Date.UTC(y, mo - 1, d) - 5.5 * 3600 * 1000;
}

function today_() {
  return Utilities.formatDate(new Date(), CFG.TZ, CFG.DATE_FORMAT);
}

/* ══════════════════════════ Sheet I/O ══════════════════════════ */

function readSource_() {
  const sh = ss_().getSheetByName(CFG.SOURCE_SHEET);
  if (!sh) throw new Error('Sheet "' + CFG.SOURCE_SHEET + '" not found');
  const values = sh.getDataRange().getDisplayValues();
  const head = (values[0] || []).map(function (h) { return clean_(h).toLowerCase(); });
  const idx = {};
  Object.keys(COL).forEach(function (k) { idx[k] = head.indexOf(COL[k].toLowerCase()); });
  if (idx.dept < 0 || idx.first < 0) throw new Error(CFG.SOURCE_SHEET + ' header row must contain "Department" and "First Name"');

  const guests = [];
  const count = {};
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const get = function (k) { return idx[k] >= 0 ? clean_(row[idx[k]]) : ''; };
    const g = {
      row: r + 1, dept: get('dept'), first: get('first'), last: get('last'), desig: get('desig'),
      email: get('email'), mobile: get('mobile'), photo: get('photo'), uid: get('uid'), accr: get('accr'),
      remark: get('remark'), printedRaw: get('printed'), deliveredRaw: get('delivered'),
    };
    if (!g.dept && !g.first && !g.last) continue;
    g.name = (g.first + ' ' + g.last).trim();
    const contact = g.email.toLowerCase() || g.mobile.replace(/\D/g, '').slice(-10) || g.name.toLowerCase();
    const base = g.dept + '|' + contact;
    count[base] = (count[base] || 0) + 1;
    g.key = count[base] > 1 ? base + '#' + count[base] : base;
    guests.push(g);
  }
  return { sheet: sh, guests: guests, idx: idx, values: values };
}

function readTrack_() {
  const sh = ensureSheet_(ss_(), CFG.TRACK_SHEET, TRACK_HEAD);
  const n = sh.getLastRow();
  const rows = n < 2 ? [] : sh.getRange(2, 1, n - 1, TRACK_HEAD.length).getValues();
  const map = {};
  rows.forEach(function (r, i) {
    r[T.key] = String(r[T.key] || '');
    r[T.pRaw] = String(r[T.pRaw] == null ? '' : r[T.pRaw]);
    r[T.dRaw] = String(r[T.dRaw] == null ? '' : r[T.dRaw]);
    if (r[T.key]) map[r[T.key]] = i;
  });
  return { sheet: sh, rows: rows, map: map };
}

const TRACK_DATE_COLS = [T.pAt, T.dAt, T.firstSeen, T.removed];

/** Text columns are forced to plain text first, so "15/11/26" or "00123" are never
 *  turned into dates/numbers by Sheets (which would look like a change on every scan). */
function writeTrack_(tr) {
  const n = tr.rows.length;
  if (!n) return;
  const fmtRow = TRACK_HEAD.map(function (h, i) { return TRACK_DATE_COLS.indexOf(i) >= 0 ? 'dd-MMM-yy HH:mm' : '@'; });
  const formats = [];
  for (let i = 0; i < n; i++) formats.push(fmtRow);
  tr.sheet.getRange(2, 1, n, TRACK_HEAD.length)
    .setNumberFormats(formats)
    .setValues(tr.rows.map(function (r) {
      return r.map(function (v, i) { return TRACK_DATE_COLS.indexOf(i) >= 0 ? (v || '') : String(v == null ? '' : v); });
    }));
}

function trackOf_(tr, key) {
  const i = tr.map[key];
  return i === undefined ? null : tr.rows[i];
}

/** Writes values into one Sheet2 column. Consecutive rows are grouped; when the
 *  updates are scattered (many runs) the whole column is written in one call. */
function writeCells_(src, col, cells) {
  if (!cells || !cells.length || col < 1) return;
  cells.sort(function (a, b) { return a.row - b.row; });
  const runs = [];
  let start = 0;
  for (let i = 1; i <= cells.length; i++) {
    if (i === cells.length || cells[i].row !== cells[i - 1].row + 1) { runs.push(cells.slice(start, i)); start = i; }
  }
  const sh = src.sheet;
  if (runs.length > 15 && src.values) {
    const column = [];
    for (let r = 1; r < src.values.length; r++) column.push([src.values[r][col - 1] == null ? '' : src.values[r][col - 1]]);
    cells.forEach(function (c) { column[c.row - 2] = [c.value]; src.values[c.row - 1][col - 1] = c.value; });
    sh.getRange(2, col, column.length, 1).setNumberFormat('@').setValues(column);
    return;
  }
  runs.forEach(function (run) {
    sh.getRange(run[0].row, col, run.length, 1).setNumberFormat('@').setValues(run.map(function (c) { return [c.value]; }));
    run.forEach(function (c) { if (src.values && src.values[c.row - 1]) src.values[c.row - 1][col - 1] = c.value; });
  });
}

function appendLog_(rows) {
  const sh = ensureSheet_(ss_(), CFG.LOG_SHEET, LOG_HEAD);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_HEAD.length).setValues(rows.map(function (r) {
    return r.map(function (v, i) { return i === 0 ? v : safe_(v); });
  }));
}

function logRow_(time, who, action, g, details) {
  return [time, who, action, g.key, g.uid, g.name, g.dept, details || ''];
}

function ensureSheet_(ss, name, head) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

/* ══════════════════════════ Helpers ══════════════════════════ */

function api_(auth, fn) {
  const pin = prop_('APP_PIN');
  if (pin && String((auth || {}).pin || '').trim() !== String(pin)) throw new Error('AUTH: Wrong PIN');
  let who = String((auth || {}).name || '').trim().slice(0, 40);
  if (!who) { try { who = Session.getActiveUser().getEmail(); } catch (e) { who = ''; } }
  who = safe_(who || 'Unknown');
  if (who === SHEET_ACTOR || who === SYSTEM_ACTOR) who += ' (staff)';
  return fn(who);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function versions_() {
  const cache = CacheService.getScriptCache();
  if (!cache.get('FRESH')) {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(5000)) {
      try {
        if (!cache.get('FRESH')) { reconcile_(); cache.put('FRESH', '1', CFG.CHECK_SECONDS); }
      } finally {
        lock.releaseLock();
      }
    }
  }
  return currentVersions_();
}

function currentVersions_() { return { s: ver_('S'), d: ver_('D') }; }

/* Version stamps live in CacheService (fast, no quota) backed by Script Properties. */
function bump_(which) {
  const v = String(Date.now()) + Math.floor(Math.random() * 1000);
  CacheService.getScriptCache().put('V_' + which, v, 21600);
  PropertiesService.getScriptProperties().setProperty('V_' + which, v);
  return v;
}

function ver_(which) {
  const cache = CacheService.getScriptCache();
  let v = cache.get('V_' + which);
  if (!v) {
    v = PropertiesService.getScriptProperties().getProperty('V_' + which) || '0';
    cache.put('V_' + which, v, 21600);
  }
  return v;
}

function prop_(name) {
  const cache = CacheService.getScriptCache();
  let v = cache.get('P_' + name);
  if (v === null || v === undefined) {
    v = PropertiesService.getScriptProperties().getProperty(name) || '';
    cache.put('P_' + name, v, 120);
  }
  return v;
}

function ss_() {
  return CFG.SPREADSHEET_ID ? SpreadsheetApp.openById(CFG.SPREADSHEET_ID) : SpreadsheetApp.getActive();
}

function clean_(s) {
  return String(s == null ? '' : s).replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
}

/** Stops text from being read as a formula when written to a sheet. */
function safe_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function driveId_(url) {
  const m = String(url || '').match(/(?:id=|\/d\/)([\w-]{10,})/);
  return m ? m[1] : '';
}

function byKey_(guests) {
  const m = {};
  guests.forEach(function (g) { m[g.key] = g; });
  return m;
}

function uniq_(a) {
  const seen = {};
  return a.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
}

function ts_(v) {
  if (v instanceof Date) return v.getTime();
  if (!v) return 0;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}
