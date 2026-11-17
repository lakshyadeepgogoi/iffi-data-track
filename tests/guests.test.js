import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATUS, filterGuests, localApply, normCard, shapeGuests, shortDept, stage, todayStr, waLink, DEFAULT_FILTERS,
} from '../src/lib/guests.js';

const row = (o = {}) => {
  const d = { key: 'k', row: 2, dept: 'CMOT Guest', first: 'Asha', last: 'Rao', desig: '', email: 'a@x.com', mobile: '9876543210',
    photo: 'p1234567890', uid: '4614', accr: 'Official Invitee', remark: '', firstSeen: 0, ...o };
  return [d.key, d.row, d.dept, d.first, d.last, d.desig, d.email, d.mobile, d.photo, d.uid, d.accr, d.remark, d.firstSeen];
};

describe('normCard — every spelling found in the real Sheet2', () => {
  it.each([
    ['Official Invitee', 'Official Invitee', ''],
    ['Offcial Invitee', 'Official Invitee', 'labelFix'],
    ['special invite', 'Special Invitee', 'labelFix'],
    ['Special Invitee', 'Special Invitee', ''],
    ['Guest Add-On', 'Guest Add-On', ''],
    ['Add-Onn', 'Guest Add-On', 'labelFix'],
    ['IFFI Management', 'IFFI Management', ''],
    ['Iffi Management', 'IFFI Management', ''],
    ['IFFI Official', 'IFFI Official', ''],
    ['Iffi Official', 'IFFI Official', ''],
    ['Kids', 'Kids', ''],
    ['Duplicate Email', 'Flagged: duplicate', 'sheetFlag'],
    ['Dublicate', 'Flagged: duplicate', 'sheetFlag'],
    ['dubulicate Mail', 'Flagged: duplicate', 'sheetFlag'],
    ['Dubilicate', 'Flagged: duplicate', 'sheetFlag'],
    ['Photo Missing', 'Flagged: photo missing', 'sheetFlag'],
    ['', 'Not set', 'noCard'],
  ])('%j → %s', (raw, card, flag) => {
    expect(normCard(raw)).toEqual({ card, flag });
  });
});

describe('shapeGuests', () => {
  it('detects data problems', () => {
    const { guests } = shapeGuests([
      row({ key: 'a', uid: '1', email: 'same@x.com' }),
      row({ key: 'b', uid: '1', email: 'SAME@x.com', photo: '' }),
      row({ key: 'c', uid: '', accr: '' }),
      row({ key: 'd', uid: 'photo issue' }),
    ]);
    expect(guests[0].issues).toEqual(expect.arrayContaining(['dupUid', 'dupEmail']));
    expect(guests[1].issues).toEqual(expect.arrayContaining(['dupUid', 'dupEmail', 'noPhoto']));
    expect(guests[2].issues).toEqual(expect.arrayContaining(['noUid', 'noCard']));
    expect(guests[3].issues).toContain('badUid');
  });

  it('builds a lookup by key and full names', () => {
    const { byKey } = shapeGuests([row({ key: 'x', last: '' })]);
    expect(byKey.x.name).toBe('Asha');
  });
});

describe('localApply — same rules as the server', () => {
  const me = 'Desk 1';
  it('delivering marks printed too', () => {
    const s = localApply(null, 'delivered', true, me, '17/11/26');
    expect([s[0], s[3], s[7], s[8], s[2], s[5]]).toEqual([1, 1, '17/11/26', '17/11/26', me, me]);
  });
  it('un-printing clears delivery', () => {
    const s = localApply(localApply(null, 'delivered', true, me), 'printed', false, me);
    expect(s.slice(0, 6)).toEqual([0, 0, '', 0, 0, '']);
  });
  it('keeps the original print date when already printed', () => {
    const prev = [1, 1, 'Sheet2', 0, 0, '', '', '15/11/26', ''];
    expect(localApply(prev, 'printed', true, me, '17/11/26')[7]).toBe('15/11/26');
    expect(localApply(prev, 'delivered', true, me, '17/11/26')[7]).toBe('15/11/26');
  });
  it('never mutates the previous tuple', () => {
    const prev = EMPTY_STATUS.slice();
    localApply(prev, 'printed', true, me);
    expect(prev).toEqual(EMPTY_STATUS);
  });
});

describe('stage', () => {
  const g = { key: 'k', uid: '1' };
  it('orders delivered > printed > to print > no ID', () => {
    expect(stage(g, { k: [1, 0, '', 1] })).toBe('del');
    expect(stage(g, { k: [1, 0, '', 0] })).toBe('pri');
    expect(stage(g, {})).toBe('ready');
    expect(stage({ key: 'k', uid: '' }, {})).toBe('noid');
  });
});

describe('filterGuests', () => {
  const { guests } = shapeGuests([
    row({ key: 'a', first: 'Asha', uid: '4614', mobile: '+91 98765 43210' }),
    row({ key: 'b', first: 'Bimal', uid: '', dept: 'PIB Officials', mobile: '9000000001', firstSeen: Date.now() }),
    row({ key: 'c', first: 'Chitra', uid: '777', mobile: '9000000002', accr: 'Offcial Invitee' }),
  ]);
  const status = { c: [1, 0, '', 0] };
  const f = (o) => filterGuests(guests, status, { ...DEFAULT_FILTERS, ...o }).map((g) => g.key);

  it('searches name, User ID and phone digits', () => {
    expect(f({ q: 'asha' })).toEqual(['a']);
    expect(f({ q: '4614' })).toEqual(['a']);
    expect(f({ q: '98765 43210' })).toEqual(['a']);
    expect(f({ q: 'rao chitra' })).toEqual(['c']);
  });
  it('filters by stage, department, card, issue and new today', () => {
    expect(f({ st: 'pri' })).toEqual(['c']);
    expect(f({ st: 'noid' })).toEqual(['b']);
    expect(f({ dept: 'PIB Officials' })).toEqual(['b']);
    expect(f({ card: 'Official Invitee' })).toEqual(['a', 'b', 'c']);
    expect(f({ issue: 'labelFix' })).toEqual(['c']);
    expect(f({ st: 'new' })).toEqual(['b']);
  });
});

describe('helpers', () => {
  it('formats today as dd/mm/yy in IST', () => {
    expect(todayStr(new Date('2026-11-16T20:00:00Z'))).toBe('17/11/26'); // 01:30 IST next day
  });
  it('builds WhatsApp links for Indian and international numbers', () => {
    expect(waLink({ digits: '9876543210', first: 'A', uid: '' })).toMatch(/^https:\/\/wa\.me\/919876543210\?/);
    expect(waLink({ digits: '34686381790', first: 'A', uid: '' })).toMatch(/wa\.me\/34686381790/);
    expect(waLink({ digits: '123', first: 'A' })).toBe('');
  });
  it('shortens department names', () => {
    expect(shortDept('IFFI Indian Panorama 2026 Guest')).toBe('Indian Panorama');
    expect(shortDept('International Cinema - Film Guests')).toBe('Intl · Film');
  });
});
