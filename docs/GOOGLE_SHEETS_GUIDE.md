# Tracking Sheet2 in Google Sheets

**Sheet2 is the single source of truth.** Your form sync keeps filling it. The app only reads Sheet2 and writes back into its own columns. Nothing important lives anywhere else.

## 1. How each column is read

| Sheet2 column (in your file now) | What the app does with it |
|---|---|
| **B Department, C First Name, D Last Name** | Identify the guest. A row needs at least one of these. |
| **E–H** Designation, Email, Mobile, Photo URL | Shown on the guest card. Edits are tracked. |
| **I User ID** | No ID → "Waiting for ID". When an ID appears, Activity shows **ID ASSIGNED**. |
| **J Accreditation** | Card type. Typos such as "Offcial Invitee" or "Add-Onn" are flagged under Data checks. |
| **K Remark** | `Delivered`, `Deleverd` or `collected` in Remark counts as **delivered** (152 rows are marked this way today). |
| **L Printed** | **Any value = printed** (normally a date like `15/11/26`). Blank = not printed. |
| **M Delivered** | **A date = delivered**, or one of the words `Yes`, `Y`, `Done`, `OK`, `True`, `✓`, `✔`, `Delivered`, `Deleverd`, `Delivred`, `Collected`, `Handed over`. Anything else, such as **`Paid`** or **`Check`**, is **not** a delivery (it's kept as a note). Blank = not delivered, unless Remark says delivered. |

**Type dates as `dd/mm/yy`** (or `dd/mm/yyyy`), e.g. `19/11/26`. That's what the app writes too. Under **Data checks**, the app flags anything else in Printed/Delivered as *Odd value*, e.g. `PRINTED`, `18/11/17` (wrong year), `11/17/2026` (month/day swapped), `Check`, `Paid`.

### Accepted header names
Columns are found **by header name** (upper/lower case doesn't matter), so moving columns around is fine. These names are all understood. The first one is what `setup()` uses if it has to add the column:

| Column | Accepted headers |
|---|---|
| Printed | **Printed**, To Print, Print, Printed Date, Print Date, Card Printed |
| Delivered | **Delivered**, Delivery, Delivered Date, Delivery Date, Handed Over, Collected |
| Designation | **Designation/Job Title**, Designation |
| Email | **Official Email Address**, Email |
| Mobile | **Mobile Number**, Mobile |
| Photo | **Photograph URL**, Photo |
| User ID | **User ID**, UserID |
| Card type | **Accreditation**, Card Type |
| Remark | **Remark**, Remarks |
| Department / First Name / Last Name | exactly these |

If the Printed or Delivered header is renamed to something **not** in this list, the app **doesn't treat the statuses as cleared**. It freezes them at their last known values, shows a red banner on every phone, and blocks marking cards until the header is back. Rename it back and everything resumes (see *Safety nets* below).

## 2. What happens when someone uses the app

| Action on a phone | What appears in Sheet2 |
|---|---|
| Mark card printed | Today's date in **Printed** (`17/11/26`) |
| Hand over card | Today's date in **Delivered** (and in Printed if it was empty). A note such as `Paid` in Delivered is replaced by the date. |
| Undo printed | Printed and Delivered cleared (a note such as `Paid` in Delivered is kept) |
| Undo delivery | Delivered cleared. A "Deleverd" word in Remark is removed, and the rest of the remark is kept. |
| Team note | Not written to Sheet2. Kept in the helper tab and shown in the app. |

Dates are written as **plain text** in the same `dd/mm/yy` style the team already uses.

## 3. What happens when someone edits Sheet2 directly

Changes typed by hand are picked up within about 10 seconds while a phone has the app open, and every minute in the background. They appear in **Activity → Sheet2 changes**:

| You do this in Sheet2 | Activity shows |
|---|---|
| Type a date in Printed / Delivered | `Sheet2 marked printed` / `handed over` |
| Clear Printed / Delivered | `Sheet2 undid printed / delivery` |
| The sync adds a new row | `Sheet2 new registration` (and the dashboard's "New today" goes up) |
| A User ID is filled in | `User ID assigned to …` |
| Any other field changes | `details changed for … (Accreditation: Offcial Invitee → Official Invitee)` |
| A row has been gone for 10 minutes | `row removed for …` |

### Safety nets
- **Renamed / deleted status header.** If the Printed or Delivered header can't be found, statuses are **frozen** at their last known values, never read as "all blank". Phones show a red banner, marking cards is blocked, Activity shows `System can't find the "Printed" column` (at most once per 30 minutes), and **nothing is written to Sheet2**. When the header is back, Sheet2 is **accepted exactly as it is**: dates typed meanwhile count, marks cleared meanwhile stay cleared, nothing is written back, and Activity shows one `System re-read Sheet2: X added · Y cleared`.
- **Re-sync wipes.** If a re-sync blanks **10 or more** Printed/Delivered values at once (and they make up ≥ 80 % of the changes), they're **written back once**, and Activity shows `System restored N statuses`. If fewer than 10 are cleared, it's treated as an intentional edit.
- **Wipe loops.** If values are blanked again within **30 minutes** of a restore, the app **stops writing to Sheet2**. It keeps the last known values in the app and in `_Ops_Track`, and Activity shows `System stopped a wipe loop` (at most once per 30 minutes). A card handed over at the desk and then cleared by another script stays delivered in the app. When the other script is fixed, run **`rewriteStatusesToSheet2`** in Apps Script. It fills only **empty** cells and never overwrites a value someone typed.
- **Rows that vanish briefly.** A row has to be missing for **10 minutes** before it's logged as removed. A sync that drops a department for a moment and puts it back leaves no trace in Activity.
- **Half-written sheet.** If Sheet2 is caught **half-written** during a sync (less than half the known guests), the app waits for the next scan instead of treating everyone as removed.
- **Matching.** Each guest is matched by **Department + email** (or mobile/name if there's no email), not by row number. Re-sorting or re-syncing rows doesn't mix up statuses.
- **`setup()` is always safe.** It accepts Sheet2 as it is (no restore), clears the loop-protection flags, and refuses to add an empty Printed/Delivered column when guests already have values on record (that would mean the header was renamed; it tells you to rename it back instead). Run it after every code update.
- **Hourly backups.** See section 8.

## 4. The two hidden helper tabs

`setup()` creates these. Don't edit them. To view them, use **View → Hidden sheets**.

- **_Ops_Track**: what Sheet2 looked like at the last scan, plus who/when for each card and team notes. Used for change detection.
- **_Ops_Log**: the full audit trail (time, who, action, guest, details). Use this tab to answer "who handed over card 4614?"

Tip: protect both tabs so only you can edit them: right-click the tab → **Protect sheet**.

## 5. Make Sheet2 itself easy to read (optional, 2 minutes)

**Colour rows by status.** Select columns A:M from row 2 down → **Format → Conditional formatting → Custom formula is**:

| Rule | Custom formula | Colour |
|---|---|---|
| Delivered | `=OR($M2<>"", REGEXMATCH(LOWER($K2), "del[ie]v[ae]?re?d"))` | light green |
| Printed, not delivered | `=AND($L2<>"", $M2="")` | light blue |
| No User ID | `=AND($B2<>"", $I2="")` | light grey |

Put the Delivered rule **first** in the list.

**Live totals anywhere** (e.g. at the top of your Summary tab):

```
Registered   =COUNTIF(Sheet2!B2:B, "<>")
With User ID =COUNTIFS(Sheet2!B2:B, "<>", Sheet2!I2:I, "<>")
Printed      =COUNTIFS(Sheet2!B2:B, "<>", Sheet2!L2:L, "<>")
Delivered    =SUMPRODUCT((Sheet2!B2:B<>"") * (((Sheet2!M2:M<>"") + REGEXMATCH(LOWER(Sheet2!K2:K), "del[ie]v[ae]?re?d")) > 0))
Printed today =COUNTIF(Sheet2!L2:L, TEXT(TODAY(), "dd/mm/yy"))
```

**Per-department table:**

```
=QUERY(Sheet2!B2:M, "select B, count(C), count(I), count(L), count(M) where B is not null group by B
  label count(C) 'Registered', count(I) 'With ID', count(L) 'Printed', count(M) 'Delivered (column M)'", 0)
```

**Filter views for each desk** (no one disturbs anyone else's view): **Data → Filter views → Create new filter view**:
- *To print*: User ID is not empty, Printed is empty
- *To hand over*: Printed is not empty, Delivered is empty

## 6. Your existing sync script

Your workbook has a hidden **_Status_DB** tab with User ID / Printed / Delivered, so your sync seems to keep Printed and Delivered across re-syncs by User ID. That works with the app as-is. Two things to check once:

1. After a re-sync, open the app's **Activity → Sheet2 changes**. If you see a burst of `undid printed`, your sync isn't keeping column M (Delivered) or rows without a User ID. The app restores a burst of 10 or more automatically, but it's better to fix it in the sync.
2. If your sync script is in the **same** Apps Script project, add `guestDeskDataChanged();` as its last line. New rows then show on phones immediately instead of within a minute.

## 7. Moving to the "Delivered" column

The app writes deliveries into **Delivered (M)**. Old "Deleverd" remarks keep working, so nothing needs migrating. To stop desks typing "Deleverd" in Remark, ask them to use the app or type the date in column M.

## 8. Backups: where they are and how to restore

- **Where:** a separate spreadsheet **"IFFI Guest Desk – Backups"** in the script owner's Drive (created by the first backup; its ID is in Script properties → `BACKUP_SS_ID`). Each hourly run adds three tabs: `YYYY-MM-DD HH:mm Sheet2`, `… _Ops_Track` and `… _Ops_Log`. All cells are plain text, and Sheet2 is copied exactly as displayed. The last **48 runs** (2 days) are kept. Older tabs are deleted automatically.
- **Also:** a CSV copy of Sheet2 in the Drive folder **"IFFI Guest Desk Backups"** (last 48 files).
- **When:** every hour (trigger installed by `setup()`), every time `setup()` runs, or whenever you run `backupNow`. Each run adds one `BACKUP` line to Activity.
- **Restore:** run `restoreFromBackup('<tab name>')` from a small wrapper function. The first run is a **dry run** that only reports how many cells differ. Add `, true` to actually write. The current state is backed up first. Full steps in the README → *Backups*.
