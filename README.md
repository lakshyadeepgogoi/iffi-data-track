# IFFI Guest Desk

Realtime, phone-first app for the IFFI accreditation desk. It tracks every guest in **Sheet2** from registration through User ID, card printed and card delivered, across any number of phones, with a full audit trail.

> **Sheet2 is the single source of truth.** The app reads guests and statuses from Sheet2 and writes dates back into Sheet2's `Printed` / `Delivered` columns. Edits made directly in the sheet show up in the app within seconds.
> → **[docs/GOOGLE_SHEETS_GUIDE.md](docs/GOOGLE_SHEETS_GUIDE.md)**: how Sheet2 is tracked, what each column means, formulas and colour rules for the sheet itself.

## What it does

| Screen | |
|---|---|
| **Dashboard** | Registered · with User ID · to print · printed · delivered · waiting for ID. **Today**: new registrations, cards printed, cards delivered. Progress per department. **Data checks**: missing/duplicate IDs, duplicate emails, missing photos, card-type typos, flagged rows. Tap any number to open the list. |
| **Guests** | Search by name, phone, email or User ID. Filter by stage, department, card type, data problem or "New today". Bulk-mark printed/delivered. Export a selection to a new tab for the print vendor. |
| **Guest card** | Photo, one-tap **Mark printed** / **Hand over**, undo, call / WhatsApp ("your card is ready") / email, who did it and when (or the Sheet2 value if typed by hand), team note. |
| **Hand over** | The desk counter. Search the guest who walked up (name, phone, email or User ID) and hand over the card in one tap. Warns if the card was already collected (when and by whom) or isn’t printed yet. Shows cards waiting for collection and everything handed over today. |
| **Activity** | Live feed: *Desk actions* (who printed/delivered what) and *Sheet2 changes* (new registrations, IDs assigned, edits, removals, automatic restores). |

Also: works offline (changes are queued on the phone and synced later), installable to the home screen, team PIN, staff names on every action, and protection against formula injection.

## Tech
React 19 · Vite · Tailwind CSS v4 · lucide-react · Google Apps Script backend (free, runs on your Google account) · Vitest + Playwright tests · a local Apps Script emulator.

```
apps-script/GuestDesk.gs   backend: reads/writes Sheet2, change tracking, audit log, JSON API
apps-script/appsscript.json
src/lib/api.js             backend bridge: gas | http | demo
src/lib/guests.js          stages, card-type normalising, data checks, search
src/lib/mock.js            demo backend (fake data + simulated colleague + simulated sync)
src/state/DeskContext.jsx  live state: polling, optimistic updates + undo, offline queue
src/components/            Dashboard, GuestList, GuestSheet, HandOver, Activity, Login, Header, TabBar, Toast, ui
emulator/                  Apps Script runtime in Node + local server (runs the real GuestDesk.gs)
tests/                     unit, backend and contract tests (Vitest)
e2e/                       end-to-end phone tests (Playwright)
docs/GOOGLE_SHEETS_GUIDE.md
```

---

## Quick start (on your laptop)

Requires Node 20+.

```bash
npm install
npm run dev                 # demo mode: fake data, PIN 2026 (open the Network URL on your phone too)
```

### Try it with your real Sheet2, before touching Google
Export the Google Sheet (**File → Download → .xlsx**), then:
```bash
npm run emulator -- --xlsx ./All_Guest.xlsx          # runs the real backend code on your Sheet2
# in a second terminal:
VITE_API_URL=http://localhost:8787 npm run dev        # Windows PowerShell: $env:VITE_API_URL="http://localhost:8787"; npm run dev
```
Add `--simulate` to the emulator to have it add registrations and assign IDs every 20 s, like a live sync.

## Deploy

### Step 1: backend (once, about 10 minutes)
1. Open the Google Sheet that has **Sheet2** → **Extensions → Apps Script**.
2. Create a script file `GuestDesk` and paste `apps-script/GuestDesk.gs`.
   If the project already has a `doGet` / `doPost` / `setup` function, rename the old one, because names must be unique.
3. Select **`setup`** → **Run** → allow permissions (it asks for Drive access too, for the backups). It:
   - adds `Printed` / `Delivered` headers to Sheet2 if missing (yours already has them; `To Print` etc. also count, see the guide)
   - creates the hidden tabs `_Ops_Track` and `_Ops_Log`
   - starts tracking (one `TRACKING STARTED` entry; existing statuses are kept as they are)
   - installs a 1-minute background scan and an **hourly backup** (and makes the first backup now)
   - sets the PIN to **2026**. **Change it**: ⚙ Project Settings → Script properties → `APP_PIN`.
4. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**.
   ("Anyone" is required for the hosted app to reach it; the PIN protects the data.)
5. Open the `/exec` URL in a browser. You should see `{"ok":true,...}`.

**After changing backend code, always:**
1. Paste the new `GuestDesk.gs` → save.
2. **Deploy → Manage deployments → ✏ → Version: New version → Deploy** (the URL stays the same).
3. Select **`setup`** → **Run**. This accepts Sheet2 as it is right now (nothing is restored or overwritten), refreshes the triggers and clears any loop-protection flags. It is always safe to run.

### Step 2: frontend (pick one)

**A. Vercel / Netlify (recommended)**
```bash
cp .env.example .env        # set VITE_API_URL to the /exec URL
npm run build               # → dist/
```
On Vercel: import the repo → framework *Vite* → add env var `VITE_API_URL` → Deploy. Share the link. On phones: browser menu → **Add to Home Screen**.

**B. No hosting: Apps Script serves the app**
```bash
npm run build:gas           # → dist-gas/index.html (single file)
```
In Apps Script: **+ → HTML** named exactly `Index` → paste the whole file → save → new deployment version. The `/exec` URL now opens the app.

## Testing

```bash
npm test                    # 134 unit + backend + safety + contract tests (no setup needed)
npm run test:e2e            # 10 end-to-end tests: real build + real backend in the emulator, phone-sized browser
npm run check               # tests + both production builds

TEST_XLSX=./All_Guest.xlsx npm test          # also run the backend over your exported Sheet2
E2E_XLSX=./All_Guest.xlsx npm run test:e2e   # end-to-end on your real data
```
First-time e2e needs a browser: `npx playwright install chromium` (or set `CHROME_PATH` to any Chrome/Chromium).

**What's covered:**
- **Backend:** setup is idempotent; PIN; columns found by header in any order; dates in Printed and "Deleverd" in Remark understood; unique keys for duplicate rows; printed/delivered/undo write the right cells and only those; bulk updates on scattered rows; notes; hand edits in Sheet2 detected and logged; new rows; User ID assigned; field edits with before → after; removed rows; re-sorted rows keep status; re-sync wipe restored; half-written sheet ignored; activity filters; export; HTTP routing and errors; scan throttling; no false changes on re-scan.
- **Safety (`tests/safety.test.js`):** header aliases ("To Print" read + write); a renamed status header freezes statuses (no restore, one `COLUMN MISSING`, warning, desk actions blocked); fixing it picks up typed dates, doesn't restore cleared marks, logs one `RESYNCED`; wipe loops restore once then never write again for 30 min; desk actions survive another script clearing them; `rewriteStatusesToSheet2` never overwrites typed values; 10-minute removal grace; "Paid"/"Check" are not delivered; hourly backups (48 kept) and dry-run restore.
- **Frontend:** every card-type spelling in the real data, data checks (including odd Printed/Delivered values), `dd/mm/yy` date check, search, filters, WhatsApp numbers, IST dates.
- **Contract:** the app's instant (optimistic) updates match what the server returns, for every action.
- **End-to-end:** login, dashboard totals = Sheet2, hand-over + undo, hand edit in Sheet2 appears in the app, new registration appears, two phones in sync, offline queue, hand-over desk + already-collected warning, bulk with confirm, data checks.

## How "realtime" works
Each phone asks for two version stamps every 4 s. **Status changed** → fetch statuses only. **Sheet2 data changed** → fetch everything. The backend re-scans Sheet2 at most every 8 s (shared across all phones) and every minute in the background. All writes run under a script lock, so several desks can mark cards at the same moment.

## Limits
A free Gmail account handles about 10 phones comfortably. For 20+ phones open all day set `VITE_POLL_MS=8000`, or deploy from a Google Workspace account (higher quotas).

## Troubleshooting
| Symptom | Fix |
|---|---|
| **Red banner** under the header: *No "Printed" column in Sheet2 — was the header renamed?* | Someone renamed or deleted the `Printed` (or `Delivered`) header. Statuses are **frozen** at their last known values and marking cards is blocked, but nothing is lost. Rename the header back (or to an accepted name such as `To Print`, see the [guide](docs/GOOGLE_SHEETS_GUIDE.md#1-how-each-column-is-read)). The banner goes away within seconds and Activity shows one `System re-read Sheet2: X added · Y cleared`. |
| Activity shows **"System restored N statuses"** over and over | This was the 17 Nov bug: the header was renamed, the old backend read every status as blank and kept "restoring" into a column that didn't exist. Paste the current `GuestDesk.gs`, deploy a new version and **run `setup()`**. That stops it. The current code freezes statuses instead of restoring them, and restores at most once per 30 minutes. |
| Activity shows **"System stopped a wipe loop"** | Something (another script or a sync) keeps blanking Printed/Delivered right after they were restored. The app keeps showing the last known values and **doesn't write to Sheet2** until it stops. Find and fix the other script, then in Apps Script run **`rewriteStatusesToSheet2`**. It fills only **empty** cells from the last known values and never overwrites anything typed. |
| A guest shows "Odd value in Printed/Delivered" | The cell has something other than a `dd/mm/yy` date (e.g. `PRINTED`, `18/11/17`, `Paid`). Fix it in Sheet2. "Paid"/"Check" in Delivered **do not** count as delivered. |
| Need to go back to an earlier state | See **Backups** below. |
| "Backend did not return JSON" | Web app access must be **Anyone**; use the `/exec` URL, not `/dev`. |
| "Wrong PIN" for everyone | Check `APP_PIN` in Script properties (takes up to 2 min to apply). |
| Changes in Sheet2 take a minute to show | Normal when no phone has the app open; with the app open it takes about 10 s. Calling `guestDeskDataChanged()` from your sync makes it instant. |
| "Sheet2 is being re-synced right now" | The sync was mid-write; try again in a few seconds. |
| Photos don't show | They load through the owner's Drive access; check the Photograph URL is a Drive link. |

## Backups
Every hour (and every time `setup()` runs) the backend copies **Sheet2**, **_Ops_Track** and **_Ops_Log** into a separate spreadsheet called **"IFFI Guest Desk – Backups"** in the owner's Drive. Each run adds one tab per source, named like `2026-11-19 14:00 Sheet2`. The last 48 runs (2 days) are kept. A CSV copy of Sheet2 also goes into the Drive folder **"IFFI Guest Desk Backups"** (last 48 files). Each run adds one `BACKUP` line to Activity. To back up right now, run **`backupNow`** in Apps Script.

**To restore** (e.g. Sheet2 was badly overwritten):
1. Open "IFFI Guest Desk – Backups" (link in `setup()`'s log, or search Drive) and pick the tab to go back to, e.g. `2026-11-19 14:00 Sheet2`.
2. In Apps Script add a small function and run it. It's a **dry run**: it only logs how many cells differ.
   ```js
   function doRestore() { restoreFromBackup('2026-11-19 14:00 Sheet2'); }
   ```
3. If the count looks right, change it to `restoreFromBackup('2026-11-19 14:00 Sheet2', true)` and run it again. Before writing, it saves the current state as a new backup, so the restore itself can be undone. Then Sheet2 is accepted as-is (one `RESYNCED` + one `RESTORED` entry, no per-guest noise).

The same works for `… _Ops_Track` and `… _Ops_Log` tabs.
