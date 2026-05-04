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

- Single static `index.html` — vanilla JS, no build step, no backend.
- `fetch()` pulls the published CSV; client computes totals, ranks, reuse credits, locked golfers.
- Read-only for everyone; the admin edits the Google Sheet directly.

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

- **Leaderboard** — total earnings, rank, winner count, credits remaining. Tap any row to expand a per-week breakdown.
- **Weekly Picks** — week selector defaulting to the most recent played week; all 7 picks side-by-side, winner highlighted with 🏆.
- **Schedule** — all 33 tournaments with the winning golfer (and who picked them) auto-derived from the data.
- **Rosters** — per participant: full pick history with each golfer tagged Reusable / Locked / Winner, plus a summary line of credits earned and spent.

## League logic implemented in the app

- **Total earnings** = sum of payout cells per participant.
- **Reuse credit earned** = picks where finish is exactly `1` (the tournament winner).
- **Reuse credit spent** = each time a golfer's name appears more than once in a participant's pick list (one credit per duplicate).
- **Reusable golfer** = first appeared on/before the participant's latest winner-pick week AND credits remaining > 0.
- **Locked golfer** = anything else (picked after the latest winner week, or no credits left).

This matches the rules in `fantasy-golf-league-summary.md`.

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
| `index.html` | The whole app — HTML, CSS, JS, CSV parser, computed views. |
| `manifest.json` | PWA metadata for "Add to Home Screen". |
| `icon.svg` | Home-screen icon (golf ball on green, with flag). |
| `README.md` | This file. |

The CSV is **not** committed to the deployed repo — the live Google Sheet is the source of truth.

## Customizing

- **Admin password / private mode:** there isn't one — it's read-only by design. If you ever need to restrict access, switch from GitHub Pages to a host that supports Basic Auth (Netlify, Cloudflare Pages).
- **Theme:** edit the CSS variables at the top of `index.html` (`--accent`, `--gold`, etc.). Dark mode follows the OS automatically.
- **Icon:** replace `icon.svg`. For best iOS results add 180×180 and 192×192 PNGs and link them from `<head>`.
