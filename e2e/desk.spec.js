import { expect, test } from '@playwright/test';

const API = 'http://localhost:8787';
const PIN = '2026';

/* ── helpers talking to the emulator's Sheet2 ── */
const sheet2 = async (request) => (await request.get(`${API}/sheet2`)).json();
const col = (rows, name) => rows[0].findIndex((h) => String(h).trim().toLowerCase() === name.toLowerCase());
const today = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date());
const used = new Set();

/** A guest row (1-based) with a unique numeric User ID and nothing printed/delivered yet. */
async function freshRow(request) {
  const rows = await sheet2(request);
  const [u, p, d, r, dept] = ['User ID', 'Printed', 'Delivered', 'Remark', 'Department'].map((h) => col(rows, h));
  const counts = {};
  rows.slice(1).forEach((x) => { counts[x[u]] = (counts[x[u]] || 0) + 1; });
  for (let i = 1; i < rows.length; i++) {
    const x = rows[i];
    if (/^\d+$/.test(x[u]) && counts[x[u]] === 1 && !x[p] && !x[d] && !/del/i.test(x[r]) && x[dept] && !used.has(x[u])) {
      used.add(x[u]);
      return { row: i + 1, uid: x[u] };
    }
  }
  throw new Error('No unprinted guest left in the test data');
}
const cellOf = async (request, row, header) => { const rows = await sheet2(request); return rows[row - 1][col(rows, header)]; };

async function login(page, name = 'E2E – Desk 1') {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Team PIN').fill(PIN);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Overall progress')).toBeVisible();
}

async function openGuest(page, uid) {
  await page.getByRole('navigation').getByRole('button', { name: 'Guests' }).click();
  await page.getByPlaceholder('Name, phone, email or User ID').fill(uid);
  await page.locator('main').getByText(`#${uid}`).first().click();
  await expect(page.getByText(`ID ${uid}`)).toBeVisible();
}

let errors = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(() => expect(errors, 'browser console errors').toEqual([]));

test('wrong PIN is refused, right PIN logs in and the dashboard counts match Sheet2', async ({ page, request }) => {
  await page.goto('/');
  await page.getByLabel('Your name').fill('E2E');
  await page.getByLabel('Team PIN').fill('0000');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Wrong PIN')).toBeVisible();
  await page.getByLabel('Team PIN').fill(PIN);
  await page.getByRole('button', { name: 'Start' }).click();
  const rows = await sheet2(request);
  const guests = rows.slice(1).filter((r) => r[col(rows, 'Department')] || r[col(rows, 'First Name')]).length;
  await expect(page.locator('button', { hasText: 'Registered' }).locator('b')).toHaveText(String(guests));
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
});

test('hand over writes today\'s date into Sheet2, Undo clears it', async ({ page, request }) => {
  const { row, uid } = await freshRow(request);
  await login(page);
  await openGuest(page, uid);
  await page.getByRole('button', { name: 'Hand over card now' }).click();
  await expect(page.getByText(/^Delivered \d/)).toBeVisible();
  await expect.poll(() => cellOf(request, row, 'Delivered')).toBe(today());
  expect(await cellOf(request, row, 'Printed')).toBe(today());

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => cellOf(request, row, 'Delivered')).toBe('');
  await expect(page.getByRole('button', { name: 'Hand over card ✓' })).toBeVisible();
  expect(await cellOf(request, row, 'Printed')).toBe(today());
});

test('a date typed directly into Sheet2 shows up in the app and in Activity', async ({ page, request }) => {
  const { row, uid } = await freshRow(request);
  await login(page);
  await request.post(`${API}/sheet2/cell`, { data: { row, header: 'Printed', value: '17/11/26' } });
  await openGuest(page, uid);
  await expect(page.getByText('17/11/26')).toBeVisible();
  await expect(page.getByText('(in Sheet2)').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Activity' }).click();
  await page.getByRole('button', { name: 'Sheet2 changes' }).click();
  await expect(page.getByText('marked printed').first()).toBeVisible();
});

test('a new registration synced into Sheet2 appears under "New today"', async ({ page, request }) => {
  await login(page);
  await request.post(`${API}/sheet2/row`, {
    data: { Department: 'CMOT Guest', 'First Name': 'Zubeen', 'Last Name': 'E2E', 'Official Email Address': 'zubeen.e2e@example.com', Accreditation: 'Official Invitee' },
  });
  await expect(page.locator('button', { hasText: 'New registrations' }).locator('b')).toHaveText('1', { timeout: 30_000 });
  await page.locator('button', { hasText: 'New registrations' }).click();
  await expect(page.locator('main').getByText('Zubeen E2E')).toBeVisible();
});

test('two phones: a hand-over on one appears on the other in seconds', async ({ browser, request }) => {
  const { uid } = await freshRow(request);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await login(a, 'Phone A');
  await login(b, 'Phone B');
  await openGuest(b, uid);
  await expect(b.getByRole('button', { name: 'Mark card printed' })).toBeVisible();
  await openGuest(a, uid);
  await a.getByRole('button', { name: 'Hand over card now' }).click();
  await expect(b.getByText(/^Delivered \d/)).toBeVisible({ timeout: 15_000 });
  await expect(b.getByText('Phone A').first()).toBeVisible();
});

test('offline: marks are kept on the phone and synced when back online', async ({ page, context, request }) => {
  const { row, uid } = await freshRow(request);
  await login(page);
  await openGuest(page, uid);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Mark card printed' }).click();
  await expect(page.getByText(/saved on this phone/)).toBeVisible();
  await expect(page.getByText(/Offline · 1 pending/)).toBeVisible();
  expect(await cellOf(request, row, 'Printed')).toBe('');
  await context.setOffline(false);
  await expect.poll(() => cellOf(request, row, 'Printed'), { timeout: 20_000 }).toBe(today());
  await expect(page.getByText(/^Live$/)).toBeVisible();
});

test('hand-over desk: search, hand over once, warns when already collected', async ({ page, request }) => {
  const { row, uid } = await freshRow(request);
  await login(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Hand over' }).click();
  const search = page.getByPlaceholder('Guest name, phone, email or User ID');
  await search.fill(uid);
  await page.getByRole('button', { name: 'Not printed yet · hand over anyway' }).click();
  await page.locator('main').getByRole('button', { name: 'Hand over', exact: true }).click();
  await expect(page.getByText('delivered ✓')).toBeVisible();
  await expect(search).toHaveValue('');
  await expect.poll(() => cellOf(request, row, 'Delivered')).toBe(today());
  await search.fill(uid);
  await expect(page.getByText(/Already collected/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hand over card' })).toHaveCount(0);
});

test('bulk select → Printed asks to confirm and writes every row', async ({ page, request }) => {
  const g1 = await freshRow(request);
  const g2 = await freshRow(request);
  await login(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Guests' }).click();
  await page.getByRole('button', { name: 'Select' }).click();
  for (const g of [g1, g2]) {
    await page.getByPlaceholder('Name, phone, email or User ID').fill(g.uid);
    await page.locator('main').getByText(`#${g.uid}`).first().click();
  }
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Printed', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  for (const g of [g1, g2]) await expect.poll(() => cellOf(request, g.row, 'Printed')).toBe(today());
});

test('a renamed "Printed" header shows a red alert, blocks marks, and clears when fixed', async ({ page, request }) => {
  const { row, uid } = await freshRow(request);
  await login(page);
  await request.post(`${API}/sheet2/cell`, { data: { row: 1, header: 'Printed', value: 'Status' } });
  try {
    await expect(page.getByRole('alert')).toContainText('No "Printed" column in Sheet2', { timeout: 30_000 });
    await openGuest(page, uid);
    await page.getByRole('button', { name: 'Mark card printed' }).click();
    await expect(page.getByText(/Failed: Sheet2 has no "Printed" column/)).toBeVisible();
    expect(await cellOf(request, row, 'Status')).toBe('');
  } finally {
    await request.post(`${API}/sheet2/cell`, { data: { row: 1, header: 'Status', value: 'Printed' } });
  }
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Mark card printed' }).click();
  await expect.poll(() => cellOf(request, row, 'Printed')).toBe(today());
});

test('data checks open the matching guests', async ({ page, request }) => {
  const rows = await sheet2(request);
  const u = col(rows, 'User ID');
  const missing = rows.slice(1).filter((r) => (r[col(rows, 'Department')] || r[col(rows, 'First Name')]) && !r[u]).length;
  await login(page);
  await page.getByRole('button', { name: /Missing User ID/ }).click();
  await expect(page.getByText(new RegExp(`^${missing} guests?$`))).toBeVisible();
});
