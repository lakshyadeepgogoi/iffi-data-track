/* Synthetic Sheet2 shaped like the real one (no real personal data). */
export const HEADER = ['S.No.', 'Department', 'First Name', 'Last Name', 'Designation/Job Title', 'Official Email Address',
  'Mobile Number', 'Photograph URL', 'User ID', 'Accreditation', 'Remark', 'Printed', 'Delivered'];

const DEPTS = ['IFFI ⁠Indian Panorama 2026 Guest', 'IFFI Officials 2026', 'CMOT Guest', '⁠International Cinema - Film Guests', 'PIB Officials'];
const FIRST = ['Aarav', 'Meera', 'Rohan', 'Ananya', 'Kabir', 'Isha', 'Vikram', 'Neha', 'Arjun', 'Priya', 'Dev', 'Sara'];
const LAST = ['Sharma', 'Iyer', 'Das', 'Menon', 'Khan', 'Bose', 'Rao', 'Patel', 'Nair', 'Singh', ''];
const CARDS = ['Official Invitee', 'Official Invitee', 'Special Invitee', 'Guest Add-On', 'Offcial Invitee', 'Add-Onn', ''];

/** n guests. Every 4th printed on 15/11/26, every 8th has Remark "Deleverd", every 9th has no User ID. */
export function makeSheet2(n = 120) {
  const rows = [HEADER.slice()];
  for (let i = 1; i <= n; i++) {
    const f = FIRST[i % FIRST.length], l = LAST[i % LAST.length];
    rows.push([
      i, DEPTS[i % DEPTS.length], f, l, i % 3 ? 'Director' : '', `${f}.${l || 'x'}${i}@example.com`.toLowerCase(),
      i % 5 ? '98' + String(10000000 + i * 7919).slice(0, 8) : '', i % 6 ? `https://drive.google.com/open?id=PHOTO${String(i).padStart(8, '0')}` : '',
      i % 9 ? String(4000 + i) : '', CARDS[i % CARDS.length], i % 8 === 0 ? 'Deleverd' : '', i % 4 === 0 ? '15/11/26' : '', '',
    ]);
  }
  return rows;
}
