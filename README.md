# Fantasy Golf 2026 — Refreshable Web App

A single-page mobile web app that all 7 league participants can open in Chrome/Safari to see the latest standings. Data lives in a Google Sheet so the admin updates one place and everyone sees it on next refresh.

## Architecture

```
[Admin's Google Sheet] --publish to web (CSV)--> [public CSV URL]
                                                       |
                                    fetch on load + Refresh button
                                                       v
   [GitHub Pages: index.html (static, single file)] <-- participants' phones
```

- Single static `index.html` — vanilla JS, no build step, no backend for reads.
- `fetch()` pulls the published CSV; client computes totals, ranks, reuse credits, locked golfers.
- Read-only by default; the admin edits the Google Sheet directly.
- **Optional**: enable participant pick submission by deploying the included `Code.gs` as a Google Apps Script Web App — see [Pick submission setup](#pick-submission-setup) below. The script validates reuse credits and deadlines server-side before writing to the sheet.

## One-time setup

### 1. Put the data in Google Sheets

1. Open Google Sheets and import (or paste) `Fantasy Golf 2026 - Compiled through Week 16.csv`.
2. Keep the same column layout — the parser depends on it:
   - Col A: week number (1–33)
   - Col B: tournament name
   - Cols C/D, E/F, G/H, I/J, K/L, M/N, O/P: each participant's `Pick / Payout` pair
   - Pick cells use the format `Player Name (Finish)` — e.g. `Cameron Young (1)`, `Robert MacIntyre (T4)`, `Jake Knapp (MC)`, `Justin Rose (WD)`.
   - Payout cells: `$1,234,567` or blank.
3. **File → Share → Publish to web** → choose the sheet → format **Comma-separated values (.csv)** → **Publish**.
4. Copy the resulting URL (looks like `https://docs.google.com/spreadsheets/d/e/.../pub?output=csv`).

### 2. Wire the URL into the app

Open `index.html`, find the `CONFIG` block near the top of the `<script>`, and paste your URL:

```js
const CONFIG = {
  CSV_URL: "https://docs.google.com/spreadsheets/d/e/.../pub?output=csv",
  ...
};
```

### 3. Deploy to GitHub Pages

1. Create a public repo (e.g. `fantasy-golf-2026`).
2. Commit these files to the `main` branch root: `index.html`, `manifest.json`, `icon.svg`, `README.md`.
3. **Settings → Pages → Source:** *Deploy from branch* → `main` → `/ (root)` → Save.
4. After ~1 min the site is live at `https://<your-username>.github.io/fantasy-golf-2026/`.
5. Text/iMessage the URL to the 7 participants. They tap **Share → Add to Home Screen** in Safari/Chrome to install it like an app.

## Weekly update workflow

After each tournament:

1. Open the Google Sheet and fill in that week's `Pick / Payout` cells. (Rule reminder: pick cells must include the finish in parentheses — `(1)` for the winner, `(T11)` for ties, `(MC)` / `(WD)` for missed-cut/withdrawn.)
2. Save. That's it — Google republishes automatically.
3. Participants tap **Refresh** in the app (or pull to refresh / reopen) and see the updated standings.

## What the app shows

- **Leaderboard** — total earnings, rank, winner count, credits remaining, and a cumulative-earnings chart. Tap any row (or a line) to expand a per-week breakdown / isolate a line.
- **Weekly Picks** — week selector defaulting to the most recent played week; all 7 picks side-by-side, winner highlighted with 🏆. Picks for a week stay hidden until that week's deadline passes (see [Hidden picks](#hidden-picks)).
- **Schedule** — all 33 tournaments with the winning golfer (and who picked them) auto-derived from the data.
- **Rosters** — per participant: full pick history with each golfer tagged Reusable / Locked / Winner, plus a summary line of credits earned, spent, and average finish.
- **The Chase** — end-of-season projections: remaining winner money, each player's ceiling and best/worst possible finish, and how many wins a trailing player needs to catch first (see [The Chase tab](#the-chase-tab)).
- **Average Finish** — the counterpart to earnings: how well each participant's picks *finish* on average, with a trend-over-time chart (see [Average Finish](#average-finish-tab)).

<a id="average-finish-tab"></a>
### Average Finish

A dedicated tab: the average finishing position of each participant's golfers across their scored picks, ranked best-first, plus a line chart of how that average has moved week by week (mirroring the cumulative-earnings chart, but with the axis inverted — **lower is better, so up = better**). Finishes convert to numbers: `1`→1, `T35`→35. A missed cut (`MC`/`WD`/`DQ`) counts as **(players who made the cut) + 1** — so it needs the cut size for that week (see [Cut column](#cut-column-average-place)). Any missed-cut pick whose cut size isn't available yet is left out of the average and marked with a `*`. The current average also appears on each participant's Rosters summary.

This is a genuinely different lens from earnings — a player who wins big occasionally but often misses cuts can top the money list while sitting near the bottom of Average Finish.

### Hidden picks

Before a week's submission deadline, the app shows only **that a participant has picked** — not who they chose — everywhere picks appear (Weekly Picks, Rosters, the Leaderboard breakdown). Names reveal automatically once the deadline passes. This is in-app hiding only: the picks still exist in the published CSV, so it deters casual peeking within the app but isn't cryptographically private. A week with no deadline set is treated as open history and shown normally.

## League logic implemented in the app

- **Total earnings** = sum of payout cells per participant.
- **Reuse credit earned** = picks where finish is exactly `1` (the tournament winner).
- **Reuse credit spent** = each time a golfer's name appears more than once in a participant's pick list (one credit per duplicate).
- **Reusable golfer** = first appeared on/before the participant's latest winner-pick week AND credits remaining > 0.
- **Locked golfer** = anything else (picked after the latest winner week, or no credits left).
- **Average Finish** = mean of finishing positions across scored picks; `MC`/`WD`/`DQ` = (made-cut count) + 1.

This matches the rules in `fantasy-golf-league-summary.md`.

## The Chase tab

An end-of-season projection view, driven by projected payouts you enter on the Schedule tab for the closing tournaments (see [Projected payouts](#projected-payouts-the-chase-tab)). Because scores accumulate independently (participants may pick the same golfer, and nobody's gain costs anyone else), the math is exact. Two cards:

- **Still on the table** — the remaining events and their per-place payouts, plus the total winner money left.
- **The chase** — one row per player: current **Total**, **Back** (behind 1st), and **Max** (today's total if they win every remaining event). A chip flags anyone who's clinched or is mathematically out of 1st.

The tab reads whatever payout columns you've filled in, so it naturally covers just "the last few tournaments." With no payout data entered it shows a short setup hint.

## Local development

```bash
cd fantasy_golf
python3 -m http.server 8000
# Open http://localhost:8000/
```

If `CONFIG.CSV_URL` is blank, the app falls back to loading `Fantasy Golf 2026 - Compiled through Week 16.csv` from the same directory — handy for testing locally before going live.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The whole app — HTML, CSS, JS, CSV parser, computed views, pick submission form. |
| `manifest.json` | PWA metadata for "Add to Home Screen". |
| `icon.svg` | Home-screen icon (golf ball on green, with flag). |
| `Code.gs` | Apps Script source for the pick-submission backend. Pasted into the bound script editor on the Google Sheet — not deployed to GitHub Pages. |
| `README.md` | This file. |

The CSV is **not** committed to the deployed repo — the live Google Sheet is the source of truth.

## Pick submission setup

This adds a **My Pick** tab to the app where each participant submits their own pick. The Google Apps Script in `Code.gs` runs validation server-side: PIN auth, deadline check, and the same reuse-credit rules the read-side enforces.

### Architecture

```
[Participant phone — index.html]
       |
       | POST { participant, pin, week, golfer }   (text/plain — avoids CORS preflight)
       v
[Apps Script Web App, bound to the sheet]
       |    1. Verify PIN (Auth tab)
       |    2. Verify week deadline not passed (Schedule tab)
       |    3. Verify reuse-credit rule (Picks tab)
       |    4. Write/update one cell on the Picks tab
       v
[Google Sheet] -- already published as CSV --> app re-fetches on next refresh
```

### 1. Add the supporting tabs to your Google Sheet

In the same spreadsheet, create two new tabs.

**Tab name: `Auth`** — assigns each participant a 4-digit PIN.

| Name      | PIN  |
|-----------|------|
| Dan Sr.   | 1234 |
| Dan Jr.   | …    |
| Matt W.   | …    |
| Jason     | …    |
| Gavin     | …    |
| Ankith    | …    |
| Matt K.   | …    |

**Tab name: `Schedule`** — sets the deadline per week, and optionally holds projected payouts and cut sizes (columns D onward, described below). Cell type for the Deadline column should be `Date time`.

| Week | Event               | Deadline           | 1         | 2         | 3         | Cut |
|-----:|---------------------|--------------------|----------:|----------:|----------:|----:|
| 17   | Truist Championship | 2026-05-08 7:00:00 |           |           |           | 72  |
| 27   | The Open Championship | 2026-07-16 7:00:00 | 3,100,000 | 1,759,000 | 1,128,000 |     |

Empty deadline = the week is not yet open for picks. Past deadline = the week is locked (and its picks reveal in the app).

Deadline times are interpreted as **America/New_York** (matches the `TZ` constant in `Code.gs` and `LEAGUE_TZ` in `index.html`). To avoid AM/PM ambiguity in the published CSV — Google Sheets often exports time-formatted cells without an AM/PM marker — either format the cell as 24-hour (e.g. `5/7/2026 19:00:00`) or include AM/PM explicitly (e.g. `5/7/2026 7:00:00 PM`). A bare `7:00:00` is read as 7 AM ET. **A date with no time defaults to 7:00 AM ET** rather than midnight, which also avoids a day-boundary shift when the sheet is read server-side.

Columns D onward are optional and read by name/position — order among them doesn't matter, and blank cells are fine:

<a id="projected-payouts-the-chase-tab"></a>
- **Projected payouts** — header cells are finishing positions (`1`, `2`, `3`, …) and body cells the prize money for that place (e.g. `3,100,000` or `$3,100,000`). Fill these for the closing tournaments to power [The Chase](#the-chase-tab). Only the `1` (winner) column drives the projection math; the rest are for display.

<a id="cut-column-average-place"></a>
- **`Cut`** — number of players who made the cut that week; used for the [average-place](#average-finishing-place) stat (a missed cut scores as this + 1). You don't fill this by hand — the results sync writes it automatically, and **⛳ Fantasy Golf → Backfill cut counts** fills past weeks in one go (see [Field & results sync](#field--results-sync-espn)). Weeks before the Schedule tab existed are baked into `index.html`.

> The main picks tab can stay named whatever you want — `Code.gs` defaults to `Picks`. If your tab has a different name, edit the `PICKS_TAB` constant near the top of `Code.gs`.

### 2. Deploy the Apps Script

1. From the Google Sheet menu: **Extensions → Apps Script**.
2. Replace the contents of the default `Code.gs` with the contents of `Code.gs` from this repo. Save.
3. **Deploy → New deployment** → click the gear icon → **Web app**.
4. Settings:
   - **Description:** any
   - **Execute as:** `Me (your-email)`
   - **Who has access:** `Anyone`
5. **Deploy** → authorize when prompted (Apps Script will ask for permission to access this spreadsheet on your behalf).
6. Copy the **Web app URL**. Looks like `https://script.google.com/macros/s/AKfycb…/exec`.

> Sanity check: open the URL in a browser. You should see `{"ok":true,"message":"Fantasy Golf submit endpoint is live..."}` — that confirms `doGet` is wired.

> **Updating `Code.gs` later:** paste the new code and Save, then **Deploy → Manage deployments → (edit the existing deployment) → Version: New version → Deploy**. Editing the existing deployment keeps the same `…/exec` URL, so `CONFIG.SUBMIT_URL` needs no change. Don't use "New deployment" — that mints a new URL and breaks submissions. Reload the spreadsheet afterward so the ⛳ menu rebuilds. Time-based triggers automatically run the latest saved code.

### 3. Publish the Schedule tab as CSV

So the app can read deadlines without going through the script.

1. **File → Share → Publish to web** → first dropdown: pick the `Schedule` tab → format: `Comma-separated values (.csv)` → Publish.
2. Copy the resulting URL (ends in `?output=csv`).

### 4. Wire both URLs into the app

In `index.html`, find the `CONFIG` block:

```js
const CONFIG = {
  CSV_URL: "https://docs.google.com/spreadsheets/d/e/.../pub?output=csv",
  SUBMIT_URL: "",          // ← paste the Apps Script Web app URL here
  SCHEDULE_CSV_URL: "",    // ← paste the Schedule-tab published CSV URL here
  ...
};
```

Setting `SUBMIT_URL` makes the **My Pick** tab appear in the navigation. Leaving it blank keeps the app read-only.

Commit + push. Pages redeploys in ~30 seconds.

### Weekly admin workflow

1. Before the tournament: enter the `Deadline` for that week's row in the `Schedule` tab. Participants can now submit picks via the app.
2. Picks land in the `Picks` tab as just the golfer name — `Cameron Young`. The leaderboard shows them but with `$0` and finish `—` until results are in.
3. After the tournament: annotate each pick cell with the finish — e.g. `Cameron Young (1)` — and fill the corresponding `Payout` cell with the prize money. Standings recompute on next refresh.

### What participants see

The **My Pick** tab is a simple form:

1. Pick your name (saved in `localStorage` so it remembers).
2. Enter your 4-digit PIN.
3. Choose a week (defaults to the next week with an open deadline).
4. Type a golfer's name (autocomplete suggests names already seen this season).

A status panel above the form shows their **earnings, winners, credits remaining**, and a live verdict — green check if the pick is allowed, red explanation if it's locked (gives the specific reason: "first picked Week 12, after your latest winner-pick (Week 9)").

The Submit button is disabled until inputs are valid. After a successful submit, the form clears, a green confirmation appears, and the leaderboard re-fetches automatically.

If a participant already has a pick for that week, the form pre-fills it and the button reads "Update pick" — submitting overwrites the cell (only their own row, gated by their PIN). They can keep editing until the deadline.

### Troubleshooting

- **"Wrong name or PIN"** — check the `Auth` tab in the sheet. Names must match the column headers in the Picks tab exactly (case-sensitive).
- **"Week N not yet open for picks"** — the Deadline cell for that week is empty in the `Schedule` tab.
- **"Server error..."** — open the Apps Script editor → Execution log to see the stack trace.
- **The form's status panel says credits remaining are wrong** — likely the parser regex isn't picking up a `(Finish)` annotation correctly. Confirm pick cells are `Name (Finish)` with a single space before the parenthesis.
- **Picks vanish from the sheet** — they don't; the Apps Script writes the golfer name without parens. Once results come in, the admin manually annotates `(Finish)` and fills the Payout column. The pick cell value never goes through any history erase.
- **The published CSV is stale by 1–2 minutes** — Google's publish cache. Wait, then refresh the app.

## Field & results sync (ESPN)

This automates two weekly admin chores: knowing who's actually playing this week (drives a soft warning in the Submit Pick form), and entering finishes/payouts after Sunday's final round (proposed values are staged for one-click apply).

Source: ESPN's public sports API at `site.api.espn.com` plus `sports.core.api.espn.com`. No API key, free, used widely by hobby projects.

### Sheet additions

Add two more tabs (the script auto-creates them on first sync, but you can pre-create them too):

**`Field`** — populated by the field sync. Columns:
| Week | Golfer            |
|-----:|-------------------|
| 17   | Scottie Scheffler |
| 17   | Rory McIlroy      |
| …    | …                 |

**`Pending Results`** — staging area for proposed finishes/payouts. Columns:
| Week | Golfer            | Finish | Payout    |
|-----:|-------------------|--------|----------:|
| 17   | Scottie Scheffler | 1      | 3,600,000 |
| …    | …                 | …      | …         |

A `Sync Log` tab is also auto-created and appended to on every sync.

### One-time setup

1. **Refresh `Code.gs`:** Extensions → Apps Script → replace the entire file with the latest `Code.gs` from this repo. Save.
2. **Reload the spreadsheet** (or run `onOpen` once manually). A new **⛳ Fantasy Golf** menu appears in the menubar.
3. **⛳ Fantasy Golf → Test ESPN connection.** Should pop an alert showing the most recent event name + field size. If this fails, ESPN may be down — wait and retry; otherwise check the Sync Log.
4. **⛳ Fantasy Golf → Install triggers.** Authorize when prompted. Creates two time-based triggers:
   - **Mon 8am ET → `syncFieldNextWeek`**
   - **Sun 9pm ET → `syncResultsLastWeek`**
5. **(Optional) Publish the `Field` tab as CSV** so the app can show the soft-warn in the Submit Pick form: File → Share → Publish to web → tab `Field`, format `Comma-separated values (.csv)` → Publish. Paste that URL into `CONFIG.FIELD_CSV_URL` in `index.html` and redeploy.
6. **⛳ Fantasy Golf → Backfill cut counts** (one-time). Fills the `Cut` column on the Schedule tab for every already-played week, powering the [average-place](#average-finishing-place) stat. It's idempotent — safe to re-run. Going forward the results sync keeps it up to date automatically.

Leave the `Pending Results` tab unpublished — admin-only. The `Schedule` tab (already published for deadlines) also carries the auto-filled `Cut` column.

### Weekly workflow (now)

- **Before the tournament:** field gets synced automatically Mon morning. The Submit Pick form will yellow-flag any pick that isn't on the list (still allowed — soft warn).
- **After the tournament:** results get staged automatically Sun night.
  1. Open the spreadsheet.
  2. Inspect the `Pending Results` tab. ESPN sometimes uses different name spellings (e.g., `J.J. Spaun` vs `JJ Spaun`) — the apply step matches case-insensitively after stripping punctuation, but you can edit any row in `Pending Results` before applying.
  3. **⛳ Fantasy Golf → Apply pending results.** The `Picks` tab gets `(Finish)` annotations and dollar payouts written for every cell that matches a pending row. Pending Results clears.
  4. App refreshes; leaderboard now reflects the new totals.

The results sync also writes that week's made-cut count to the Schedule `Cut` column automatically (counting amateurs, who make cuts with $0 winnings, correctly). No manual step needed.

### Manual override (any time)

Same custom menu has manual versions of both syncs:
- **Sync field (next week)** — recomputes the next-open week's roster.
- **Sync results (last week)** — re-stages results for the most-recently-closed week.

Both functions are idempotent — running twice is safe.

### Limitations

- **MC vs WD vs DQ:** ESPN's scoreboard alone doesn't distinguish these reliably, so any zero-earnings finisher is staged as `MC`. If you want `WD` instead, edit the row in `Pending Results` before clicking Apply.
- **Event matching:** the sync queries ESPN for the whole tournament week (a date range, not a single day) and picks the event whose name matches the Schedule row — so it's robust to date drift and correctly disambiguates two-event weeks (e.g. The Open + a same-week opposite-field event). A week whose name doesn't match anything ESPN returns is logged and skipped.
- **Field is best-effort:** ESPN's roster lags real-life late commitments by a day or two. The form warning is intentionally soft — submitting anyway is fine.
- **Apps Script time triggers run in your account's quotas.** Plenty for once-a-week syncs at our scale; never been a concern.

### Soft-warn behavior in the app

Once `CONFIG.FIELD_CSV_URL` is set:
- The Golfer field's autocomplete suggestions come from this week's published field (when available), falling back to historical picks.
- Typing a name that's not in the field shows a yellow callout: *"⚠ Sam Burns isn't in the Truist field — double-check before submitting."*
- Submit stays enabled — it's guidance, not a block. The server-side script never enforces field membership.
- Leaving `FIELD_CSV_URL` blank disables the warning entirely; everything else still works.

## Customizing

- **Admin password / private mode:** there isn't one — it's read-only by design. If you ever need to restrict access, switch from GitHub Pages to a host that supports Basic Auth (Netlify, Cloudflare Pages).
- **Theme:** edit the CSS variables at the top of `index.html` (`--accent`, `--gold`, etc.). Dark mode follows the OS automatically.
- **Icon:** replace `icon.svg`. For best iOS results add 180×180 and 192×192 PNGs and link them from `<head>`.
- **PIN reset:** edit the value in the `Auth` tab. Takes effect immediately on next submit.
- **Season-end lockdown:** clear all deadlines in the `Schedule` tab — the form will reject all weeks with "not yet open".
