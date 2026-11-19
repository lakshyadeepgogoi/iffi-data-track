/**
 * Optional: runs the backend against YOUR exported workbook.
 *   TEST_XLSX=/path/to/All_Guest.xlsx npm test
 * Skipped when TEST_XLSX is not set (the file holds personal data, so it isn't in the repo).
 */
import { describe, expect, it } from 'vitest';
import { createGas, FakeSpreadsheet } from '../emulator/gas.js';
import { readSheet } from '../emulator/xlsx.js';

const FILE = process.env.TEST_XLSX;
const AUTH = { name: 'Test', pin: '2026' };

describe.skipIf(!FILE)('real Sheet2 export', () => {
  it('loads, tracks and updates every guest without errors', async () => {
    const rows = await readSheet(FILE);
    const ss = new FakeSpreadsheet();
    const sheet = ss.addSheet('Sheet2', rows);
    const { gs } = createGas({ spreadsheet: ss });
    gs.setup();
    const s = gs.apiSnapshot(AUTH);
    const head = rows[0].map((h) => String(h).trim().toLowerCase());
    const pCol = ['printed', 'to print'].map((h) => head.indexOf(h)).find((i) => i >= 0);
    const dCol = head.indexOf('delivered');
    expect(pCol, 'Sheet2 needs a "Printed" or "To Print" column').toBeGreaterThanOrEqual(0);
    const isGuest = (r) => r[1] || r[2] || r[3];
    const expectedGuests = rows.slice(1).filter(isGuest).length;
    const expectedPrinted = rows.slice(1).filter((r) => isGuest(r) && String(r[pCol] || '').trim()).length;

    expect(s.warnings).toEqual([]);
    expect(s.guests).toHaveLength(expectedGuests);
    expect(new Set(s.guests.map((g) => g[0])).size).toBe(expectedGuests);
    expect(Object.values(s.status).filter((x) => x[0]).length).toBe(expectedPrinted);

    // Every guest can be printed, delivered and undone, and Sheet2 ends where it started —
    // except Delivered cells holding a note such as "Paid", which a hand-over replaces with a date.
    const before = sheet.rows().map((r) => r.slice());
    const unprinted = s.guests.map((g) => g[0]).filter((k) => !s.status[k]);
    gs.apiSet(AUTH, unprinted, 'delivered', true);
    const mid = gs.apiSnapshot(AUTH);
    expect(Object.values(mid.status).filter((x) => x[3]).length).toBeGreaterThanOrEqual(unprinted.length);
    gs.apiSet(AUTH, unprinted, 'printed', false);
    const touched = new Set(mid.guests.filter((g) => unprinted.includes(g[0])).map((g) => g[1]));
    const strip = (rs) => rs.map((r, i) => r.map((v, c) => (c === dCol && touched.has(i + 1) ? '' : v)));
    expect(JSON.stringify(strip(sheet.rows()))).toBe(JSON.stringify(strip(before)));
    console.log(`real data: ${expectedGuests} guests, ${expectedPrinted} printed, ${Object.values(s.status).filter((x) => x[3]).length} delivered`);
  });
});
