/**
 * Local backend: runs apps-script/GuestDesk.gs in Node with an in-memory Sheet2,
 * so you can test the React app end-to-end before deploying to Google.
 *
 *   npm run emulator                                # 120 sample guests
 *   npm run emulator -- --xlsx ./All_Guest.xlsx     # your exported workbook (Sheet2 tab)
 *   npm run emulator -- --simulate                  # also adds guests / IDs every 20 s like a live sync
 *
 * Then: VITE_API_URL=http://localhost:8787 npm run dev
 * Extra endpoints (emulator only, used by the e2e tests):
 *   GET /sheet2 · POST /sheet2/cell {row, header, value} · POST /sheet2/row {Header: value, …}
 */
import http from 'node:http';
import { createGas, FakeSpreadsheet } from './gas.js';
import { makeSheet2 } from './fixture.js';
import { readSheet } from './xlsx.js';

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const PORT = Number(arg('--port') || process.env.PORT || 8787);
const XLSX = arg('--xlsx');
const SIMULATE = argv.includes('--simulate');

const rows = XLSX ? await readSheet(XLSX) : makeSheet2(120);
const ss = new FakeSpreadsheet();
const sheet = ss.addSheet('Sheet2', rows);
const { gs, props } = createGas({ spreadsheet: ss });
if (process.env.APP_PIN) props.set('APP_PIN', process.env.APP_PIN);
console.log(gs.setup());

setInterval(() => gs.reconcileTrigger(), 30_000);

if (SIMULATE) {
  let n = 0;
  setInterval(() => {
    n++;
    const head = sheet.rows()[0].map((h) => String(h).trim().toLowerCase());
    const col = (h) => head.indexOf(h.toLowerCase());
    if (n % 2) {
      const row = new Array(head.length).fill('');
      row[col('S.No.')] = sheet.rows().length;
      row[col('Department')] = 'CMOT Guest';
      row[col('First Name')] = 'Walk-in';
      row[col('Last Name')] = 'Guest ' + n;
      row[col('Official Email Address')] = `walkin${n}@example.com`;
      row[col('Accreditation')] = 'Official Invitee';
      sheet.rows().push(row);
      console.log('[simulate] new registration row', sheet.rows().length);
    } else {
      const r = sheet.rows().findIndex((x, i) => i && !x[col('User ID')]);
      if (r > 0) { sheet.rows()[r][col('User ID')] = String(900000 + n); console.log('[simulate] User ID assigned on row', r + 1); }
    }
  }, 20_000);
}

const send = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });

http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'GET' && req.url === '/sheet2') return send(res, 200, sheet.rows());
    if (req.method === 'POST' && req.url === '/sheet2/cell') {
      const { row, header, value } = JSON.parse(await readBody(req));
      const c = sheet.rows()[0].findIndex((h) => String(h).trim().toLowerCase() === String(header).toLowerCase());
      if (c < 0) return send(res, 400, { ok: false, error: 'No column ' + header });
      sheet._set(row, c + 1, value);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/sheet2/row') {
      const values = JSON.parse(await readBody(req));
      const head = sheet.rows()[0].map((h) => String(h).trim().toLowerCase());
      const row = head.map((h) => { const k = Object.keys(values).find((x) => x.toLowerCase() === h); return k ? values[k] : ''; });
      sheet.rows().push(row);
      return send(res, 200, { ok: true, row: sheet.rows().length });
    }
    if (req.method === 'GET') return send(res, 200, gs.doGet().getContent());
    if (req.method === 'POST') {
      const out = gs.doPost({ postData: { contents: await readBody(req) } });
      return send(res, 200, out.getContent());
    }
    send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    send(res, 500, { ok: false, error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`Guest Desk emulator on http://localhost:${PORT}  (${sheet.rows().length - 1} rows in Sheet2${SIMULATE ? ', simulating live sync' : ''})`);
  console.log(`Run the app against it:  VITE_API_URL=http://localhost:${PORT} npm run dev`);
});
