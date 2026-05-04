/**
 * Fantasy Golf 2026 — Pick Submission Backend
 *
 * Paste this entire file into the Apps Script editor bound to your Google Sheet:
 *   Sheet → Extensions → Apps Script → replace default Code.gs → Save
 *   Then: Deploy → New deployment → Web app
 *     - Execute as: Me
 *     - Who has access: Anyone
 *   Copy the Web App URL into CONFIG.SUBMIT_URL in index.html.
 *
 * Required tabs in the spreadsheet:
 *   - Picks    (your existing main tab — same layout as the published CSV)
 *   - Auth     (columns: Name | PIN)
 *   - Schedule (columns: Week | Event | Deadline)   Deadline is a Date/timestamp cell.
 */

const PICKS_TAB    = 'Picks';
const AUTH_TAB     = 'Auth';
const SCHEDULE_TAB = 'Schedule';

// =========================================================================
// HTTP entry points
// =========================================================================

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const participant = String(req.participant || '').trim();
    const pin         = String(req.pin || '').trim();
    const week        = parseInt(req.week, 10);
    const golfer      = String(req.golfer || '').trim();

    if (!participant || !pin || !week || !golfer) {
      return json({ ok: false, error: 'Missing field (participant, pin, week, golfer all required)' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Auth
    if (!checkPin(ss, participant, pin)) {
      return json({ ok: false, error: 'Wrong name or PIN' });
    }

    // 2. Deadline
    const ddl = getDeadline(ss, week);
    if (!ddl) return json({ ok: false, error: `Week ${week} not yet open for picks` });
    if (new Date() > ddl) return json({ ok: false, error: `Week ${week} deadline has passed` });

    // 3. Reuse-rule validation (mirror of client-side rules)
    const v = validatePick(ss, participant, week, golfer);
    if (!v.ok) return json(v);

    // 4. Write
    writePick(ss, participant, week, golfer);
    return json({ ok: true, message: `Saved: ${golfer} for Week ${week}` });
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + (err && err.message ? err.message : err) });
  }
}

// Optional: a simple GET endpoint so you can sanity-check the deployment in a browser.
function doGet() {
  return json({ ok: true, message: 'Fantasy Golf submit endpoint is live. POST to submit a pick.' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =========================================================================
// Sheet helpers
// =========================================================================

function getSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Sheet tab "${name}" not found`);
  return sh;
}

function checkPin(ss, name, pin) {
  const sh = getSheet_(ss, AUTH_TAB);
  const rows = sh.getDataRange().getValues(); // [[Name, PIN], ...]
  for (let i = 1; i < rows.length; i++) {
    const n = String(rows[i][0] || '').trim();
    const p = String(rows[i][1] || '').trim();
    if (n === name && p === pin) return true;
  }
  return false;
}

function getDeadline(ss, week) {
  const sh = getSheet_(ss, SCHEDULE_TAB);
  const rows = sh.getDataRange().getValues(); // [[Week, Event, Deadline], ...]
  for (let i = 1; i < rows.length; i++) {
    const w = parseInt(rows[i][0], 10);
    if (w === week) {
      const d = rows[i][2];
      if (!d) return null;
      return d instanceof Date ? d : new Date(d);
    }
  }
  return null;
}

/**
 * Locate a participant's column on the Picks tab and read their pick history.
 * Returns:
 *   { col, rowForWeek: {weekNum: rowIdx}, picks: [{week, golfer, finish, isWinner}], stats }
 */
function readPicksFor(ss, participant) {
  const sh = getSheet_(ss, PICKS_TAB);
  const rows = sh.getDataRange().getValues();
  if (!rows.length) throw new Error('Picks tab is empty');
  const header = rows[0];

  // Header layout: ['', 'Event', name1, 'Payout', name2, 'Payout', ...]
  let col = -1;
  for (let c = 2; c + 1 < header.length; c += 2) {
    if (String(header[c] || '').trim() === participant) { col = c; break; }
  }
  if (col < 0) throw new Error(`Participant column for "${participant}" not found on ${PICKS_TAB} tab`);

  const picks = [];
  const rowForWeek = {};
  for (let r = 1; r < rows.length; r++) {
    const wkCell = rows[r][0];
    const wk = parseInt(wkCell, 10);
    if (!wk) continue;
    rowForWeek[wk] = r; // 0-based; +1 when calling getRange
    const cell = String(rows[r][col] || '').trim();
    if (!cell) continue;
    const m = cell.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const golfer = m ? m[1].trim() : cell;
    const finish = m ? m[2].trim() : '';
    picks.push({ week: wk, golfer, finish, isWinner: finish === '1' });
  }
  return { col, rowForWeek, picks };
}

function computeStats(picks) {
  let winners = 0;
  let latestWinnerWeek = 0;
  const golferFirstWeek = {};
  const golferCounts = {};
  for (const p of picks) {
    golferCounts[p.golfer] = (golferCounts[p.golfer] || 0) + 1;
    if (golferFirstWeek[p.golfer] == null || p.week < golferFirstWeek[p.golfer]) {
      golferFirstWeek[p.golfer] = p.week;
    }
    if (p.isWinner) {
      winners++;
      if (p.week > latestWinnerWeek) latestWinnerWeek = p.week;
    }
  }
  let reusesSpent = 0;
  for (const c of Object.values(golferCounts)) if (c > 1) reusesSpent += (c - 1);
  return {
    winners,
    latestWinnerWeek,
    reusesSpent,
    creditsRemaining: winners - reusesSpent,
    golferFirstWeek
  };
}

/**
 * Validate a proposed pick against the league's reuse rule.
 * Allows replacing the participant's own pick for the same week.
 */
function validatePick(ss, participant, week, golfer) {
  const { picks } = readPicksFor(ss, participant);
  // Drop their own existing pick for this week (treat as edit).
  const others = picks.filter(p => p.week !== week);
  const stats = computeStats(others);

  const previouslyPicked = others.some(p => p.golfer.toLowerCase() === golfer.toLowerCase());
  if (!previouslyPicked) return { ok: true };

  // Repeat pick — only allowed if first-use week ≤ latestWinnerWeek AND credits remain.
  const firstWeek = stats.golferFirstWeek[golfer]
    ?? Object.keys(stats.golferFirstWeek).find(k => k.toLowerCase() === golfer.toLowerCase());
  // Resolve case-insensitively
  let resolvedFirstWeek = null;
  for (const [name, wk] of Object.entries(stats.golferFirstWeek)) {
    if (name.toLowerCase() === golfer.toLowerCase()) { resolvedFirstWeek = wk; break; }
  }

  if (stats.latestWinnerWeek === 0) {
    return { ok: false, error: `${golfer} already used (no reuse credits earned yet)` };
  }
  if (resolvedFirstWeek > stats.latestWinnerWeek) {
    return {
      ok: false,
      error: `${golfer} is locked: first picked Week ${resolvedFirstWeek}, after your latest winner-pick (Week ${stats.latestWinnerWeek})`
    };
  }
  if (stats.creditsRemaining <= 0) {
    return { ok: false, error: `No reuse credits remaining (${stats.winners} earned, ${stats.reusesSpent} spent)` };
  }
  return { ok: true };
}

function writePick(ss, participant, week, golfer) {
  const sh = getSheet_(ss, PICKS_TAB);
  const { col, rowForWeek } = readPicksFor(ss, participant);
  const rIdx = rowForWeek[week];
  if (rIdx == null) {
    throw new Error(`Week ${week} row not found on ${PICKS_TAB} tab — admin needs to add it`);
  }
  // getRange uses 1-based row/col; col is already 0-based index, so +1.
  sh.getRange(rIdx + 1, col + 1).setValue(golfer);
}
