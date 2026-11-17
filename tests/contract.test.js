/** The frontend must understand exactly what the backend sends. */
import { describe, expect, it } from 'vitest';
import { createGas, FakeSpreadsheet } from '../emulator/gas.js';
import { makeSheet2 } from '../emulator/fixture.js';
import { localApply, shapeGuests, stage } from '../src/lib/guests.js';
import { mock } from '../src/lib/mock.js';

const AUTH = { name: 'Desk', pin: '2026' };

describe('backend ↔ frontend contract', () => {
  it('snapshot rows and status tuples have the shape the app expects', () => {
    const ss = new FakeSpreadsheet();
    ss.addSheet('Sheet2', makeSheet2(60));
    const { gs } = createGas({ spreadsheet: ss });
    gs.setup();
    const snap = gs.apiSnapshot(AUTH);
    expect(snap.guests.every((g) => g.length === 13)).toBe(true);
    expect(Object.values(snap.status).every((s) => s.length === 9)).toBe(true);
    const { guests } = shapeGuests(snap.guests);
    const counts = guests.reduce((c, g) => ((c[stage(g, snap.status)] = (c[stage(g, snap.status)] || 0) + 1), c), {});
    expect(counts.pri + counts.del).toBe(Object.values(snap.status).filter((s) => s[0] || s[3]).length);
  });

  it('optimistic update predicts exactly what the server returns', () => {
    const ss = new FakeSpreadsheet();
    ss.addSheet('Sheet2', makeSheet2(30));
    const { gs } = createGas({ spreadsheet: ss });
    gs.setup();
    const snap = gs.apiSnapshot(AUTH);
    for (const [field, value] of [['printed', true], ['delivered', true], ['delivered', false], ['printed', false]]) {
      for (const [k] of snap.guests.slice(0, 12)) {
        const before = gs.apiSnapshot(AUTH).status[k];
        const predicted = localApply(before, field, value, AUTH.name, gs.today_());
        const server = gs.apiSet(AUTH, [k], field, value).changed[k] || gs.apiSnapshot(AUTH).status[k] || [0, 0, '', 0, 0, '', '', '', ''];
        expect([server[0], server[3]], `${field}=${value} on ${k}`).toEqual([predicted[0], predicted[3]]);
      }
    }
  });

  it('the demo backend speaks the same format', async () => {
    const snap = await mock.apiSnapshot(AUTH);
    expect(snap.guests.every((g) => g.length === 13)).toBe(true);
    expect(Object.values(snap.status).every((s) => s.length === 9)).toBe(true);
  });
});
