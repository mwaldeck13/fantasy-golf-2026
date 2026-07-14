/**
 * Fantasy Golf 2026 — Apps Script (pick submission + ESPN sync)
 *
 * Paste this entire file into the Apps Script editor bound to your Google Sheet:
 *   Sheet → Extensions → Apps Script → replace default Code.gs → Save
 *
 * Then deploy as a Web App for pick submission:
 *   Deploy → New deployment → Web app
 *     - Execute as: Me
 *     - Who has access: Anyone
 *   Copy the Web App URL into CONFIG.SUBMIT_URL in index.html.
 *
 * For the ESPN field/results sync, also do:
 *   1. Reopen the spreadsheet (or run onOpen manually) so the ⛳ Fantasy Golf menu appears.
 *   2. ⛳ Fantasy Golf → Install triggers (one-time, authorize when prompted).
 *
 * Required tabs:
 *   - Picks            (your existing main tab — Week | Event | <Name> | Payout | <Name> | Payout | …)
 *   - Auth             (Name | PIN)
 *   - Schedule         (Week | Event | Deadline (datetime cell) | [projected payouts 1,2,3…] | [Cut])
 *                       Cut = # who made the cut, auto-filled by the results sync / Backfill cut counts.
 *   - Field            (Week | Golfer)                                  [created by ESPN sync]
 *   - Pending Results  (Week | Golfer | Finish | Payout)                [created by ESPN sync]
 *   - Sync Log         (Timestamp | Function | Week | Status | Message) [created by ESPN sync]
 */

const PICKS_TAB    = 'Picks';
const AUTH_TAB     = 'Auth';
const SCHEDULE_TAB = 'Schedule';
const FIELD_TAB    = 'Field';
const PENDING_TAB  = 'Pending Results';
const LOG_TAB      = 'Sync Log';

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
const ESPN_CORE_EVENT = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/';

const TZ = 'America/New_York';

// Hour (ET, 24h) to assume when a Schedule deadline cell has a date but no time.
// Matches the morning deadlines used for every other week and, crucially, avoids
// a bare date being read as midnight — which Apps Script can shift a day earlier.
const DEFAULT_DEADLINE_HOUR = 7;

// =========================================================================
// HTTP entry points (pick submission)
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

    if (!checkPin(ss, participant, pin)) {
      return json({ ok: false, error: 'Wrong name or PIN' });
    }

    const ddl = getDeadline(ss, week);
    if (!ddl) return json({ ok: false, error: `Week ${week} not yet open for picks` });
    if (new Date() > ddl) return json({ ok: false, error: `Week ${week} deadline has passed` });

    const v = validatePick(ss, participant, week, golfer);
    if (!v.ok) return json(v);

    writePick(ss, participant, week, golfer);
    return json({ ok: true, message: `Saved: ${golfer} for Week ${week}` });
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + (err && err.message ? err.message : err) });
  }
}

function doGet() {
  return json({ ok: true, message: 'Fantasy Golf submit endpoint is live. POST to submit a pick.' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =========================================================================
// Pick-submission helpers (unchanged from prior version)
// =========================================================================

function getSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Sheet tab "${name}" not found`);
  return sh;
}

function checkPin(ss, name, pin) {
  const sh = getSheet_(ss, AUTH_TAB);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === name && String(rows[i][1] || '').trim() === pin) return true;
  }
  return false;
}

// Parse a Schedule deadline into an instant, treating the wall-clock components as
// Eastern time. `displayStr` is the cell's displayed text (getDisplayValues) —
// preferred, because reading the underlying Date value can land a day early when
// the project timezone differs from the sheet. `rawVal` is the fallback cell value.
// Date-only cells default to DEFAULT_DEADLINE_HOUR rather than midnight.
function parseDeadlineET_(displayStr, rawVal) {
  const s = String(displayStr == null ? '' : displayStr).trim();
  if (!s) return (rawVal instanceof Date) ? rawVal : null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (!m) {
    if (rawVal instanceof Date) return rawVal;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  let h = (m[4] != null) ? parseInt(m[4], 10) : DEFAULT_DEADLINE_HOUR;
  const min = (m[5] != null) ? parseInt(m[5], 10) : 0;
  const sec = (m[6] != null) ? parseInt(m[6], 10) : 0;
  const ap = m[7];
  if (ap) {
    if (/PM/i.test(ap) && h < 12) h += 12;
    if (/AM/i.test(ap) && h === 12) h = 0;
  }
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const canonical = `${m[3]}/${pad(+m[1])}/${pad(+m[2])} ${pad(h)}:${pad(min)}:${pad(sec)}`;
  return Utilities.parseDate(canonical, TZ, 'yyyy/MM/dd HH:mm:ss');
}

function getDeadline(ss, week) {
  const row = getSchedule(ss).find(r => r.week === week);
  return row ? row.deadline : null;
}

function getSchedule(ss) {
  const sh = getSheet_(ss, SCHEDULE_TAB);
  const rng = sh.getDataRange();
  const values = rng.getValues();
  const display = rng.getDisplayValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const wk = parseInt(values[i][0], 10);
    if (!wk) continue;
    const event = String(values[i][1] || '').trim();
    const ddl = parseDeadlineET_(display[i][2], values[i][2]);
    out.push({ week: wk, event, deadline: ddl });
  }
  return out;
}

function readPicksFor(ss, participant) {
  const sh = getSheet_(ss, PICKS_TAB);
  const rows = sh.getDataRange().getValues();
  if (!rows.length) throw new Error('Picks tab is empty');
  const header = rows[0];

  let col = -1;
  for (let c = 2; c + 1 < header.length; c += 2) {
    if (String(header[c] || '').trim() === participant) { col = c; break; }
  }
  if (col < 0) throw new Error(`Participant column for "${participant}" not found on ${PICKS_TAB} tab`);

  const picks = [];
  const rowForWeek = {};
  for (let r = 1; r < rows.length; r++) {
    const wk = parseInt(rows[r][0], 10);
    if (!wk) continue;
    rowForWeek[wk] = r;
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
  let winners = 0, latestWinnerWeek = 0;
  const golferFirstWeek = {};
  const golferCounts = {};
  for (const p of picks) {
    golferCounts[p.golfer] = (golferCounts[p.golfer] || 0) + 1;
    if (golferFirstWeek[p.golfer] == null || p.week < golferFirstWeek[p.golfer]) golferFirstWeek[p.golfer] = p.week;
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

function validatePick(ss, participant, week, golfer) {
  const { picks } = readPicksFor(ss, participant);
  const others = picks.filter(p => p.week !== week);
  const stats = computeStats(others);

  const previously = others.find(p => p.golfer.toLowerCase() === golfer.toLowerCase());
  if (!previously) return { ok: true };

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
  if (rIdx == null) throw new Error(`Week ${week} row not found on ${PICKS_TAB} tab`);
  sh.getRange(rIdx + 1, col + 1).setValue(golfer);
}

// =========================================================================
// Sheet menu + triggers
// =========================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⛳ Fantasy Golf')
    .addItem('Sync field (next week)', 'syncFieldNextWeek')
    .addItem('Sync results (last week)', 'syncResultsLastWeek')
    .addSeparator()
    .addItem('Sync field for specific week…', 'syncFieldPrompt')
    .addItem('Sync results for specific week…', 'syncResultsPrompt')
    .addSeparator()
    .addItem('Apply pending results', 'applyPendingResults')
    .addSeparator()
    .addItem('Backfill cut counts', 'backfillCutCounts')
    .addItem('Install triggers', 'installTriggers')
    .addItem('Test ESPN connection', 'testEspnConnection')
    .addToUi();
}

function syncFieldPrompt() { withLog_('syncFieldPrompt', () => syncField(promptForWeek_('field'))); }
function syncResultsPrompt() { withLog_('syncResultsPrompt', () => syncResults(promptForWeek_('results'))); }

function promptForWeek_(label) {
  const resp = SpreadsheetApp.getUi().prompt(
    `Sync ${label} for which week?`,
    'Enter the week number (1–33).',
    SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== SpreadsheetApp.getUi().Button.OK) {
    throw new Error('Cancelled');
  }
  const wk = parseInt(resp.getResponseText().trim(), 10);
  if (!wk || wk < 1 || wk > 33) throw new Error('Invalid week number: ' + resp.getResponseText());
  return wk;
}

function installTriggers() {
  // Remove any pre-existing triggers we previously installed (avoid duplicates on re-run).
  const wanted = new Set(['syncFieldNextWeek', 'syncResultsLastWeek']);
  for (const t of ScriptApp.getProjectTriggers()) {
    if (wanted.has(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  }
  // Monday 8am ET: field sync
  ScriptApp.newTrigger('syncFieldNextWeek').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone(TZ).create();
  // Sunday 9pm ET: results sync
  ScriptApp.newTrigger('syncResultsLastWeek').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(21).inTimezone(TZ).create();
  SpreadsheetApp.getUi().alert('Installed: Mon 8am field sync + Sun 9pm results sync (Eastern).');
}

function testEspnConnection() {
  try {
    const lb = fetchEspnScoreboard();
    SpreadsheetApp.getUi().alert(
      `ESPN OK\n\nMost recent event: ${lb.eventName}\nField size: ${lb.athletes.length}\nCompleted: ${lb.completed}`
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('ESPN error: ' + e.message);
  }
}

// =========================================================================
// ESPN fetch
// =========================================================================

// ESPN indexes each golf event on its Thursday start date and a scoreboard query for
// a single wrong day returns nothing. Query the whole tournament week (deadline ±3
// days) so the event is found regardless of small date drift or which day it starts.
function espnDateRange_(deadline) {
  const start = new Date(deadline.getTime() - 3 * 86400000);
  const end   = new Date(deadline.getTime() + 3 * 86400000);
  return Utilities.formatDate(start, TZ, 'yyyyMMdd') + '-' + Utilities.formatDate(end, TZ, 'yyyyMMdd');
}

/**
 * Returns {eventId, eventName, completed, dateISO, athletes:[{id,name,order,score}]}.
 * `dates` may be a single YYYYMMDD or a YYYYMMDD-YYYYMMDD range. When `matchName` is
 * given, selects the event whose name matches it (handles two-event weeks, e.g. The
 * Open + Corales Puntacana); otherwise takes the first event.
 */
function fetchEspnScoreboard(dates, matchName) {
  const url = ESPN_SCOREBOARD + (dates ? '?dates=' + dates : '');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error(`ESPN scoreboard HTTP ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }
  const json = JSON.parse(res.getContentText());
  const events = json.events || [];
  if (!events.length) {
    throw new Error('No event in ESPN scoreboard for ' + (dates || 'current'));
  }
  let e;
  if (matchName) {
    e = events.find(ev => nameMatch_(ev.name, matchName));
    if (!e) {
      throw new Error(`No ESPN event matching '${matchName}' in ${dates} (found: ${events.map(ev => ev.name).join(', ')})`);
    }
  } else {
    e = events[0];
  }
  const competitors = (e.competitions[0].competitors || []).map(c => ({
    id: c.id,
    name: (c.athlete && c.athlete.displayName) || '',
    order: c.order,
    score: c.score
  })).filter(c => c.name);
  return {
    eventId: e.id,
    eventName: e.name,
    dateISO: e.date,
    completed: !!(e.status && e.status.type && e.status.type.completed),
    athletes: competitors
  };
}

/** Returns map { athleteId: earningsNumber } for the event */
function fetchEspnEarnings(eventId) {
  const res = UrlFetchApp.fetch(ESPN_CORE_EVENT + eventId, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error(`ESPN core HTTP ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }
  const json = JSON.parse(res.getContentText());
  const earnings = {};
  for (const c of json.competitions[0].competitors || []) {
    const ref = (c.athlete && c.athlete.$ref) || '';
    const m = ref.match(/\/athletes\/(\d+)/);
    if (m) earnings[m[1]] = Number(c.earnings || 0);
  }
  return earnings;
}

/** Compute "1", "T4", "MC" per athlete given scoreboard order/score and earnings map. */
function computeDisplayPositions(athletes, earnings) {
  const sorted = athletes.slice().sort((a, b) => a.order - b.order);
  const out = {};
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
    const tied = (j - i) > 1;
    const pos = sorted[i].order;
    for (let k = i; k < j; k++) {
      const e = earnings[sorted[k].id] || 0;
      out[sorted[k].id] = e > 0 ? (tied ? `T${pos}` : String(pos)) : 'MC';
    }
    i = j;
  }
  return out;
}

// =========================================================================
// Sync workflows
// =========================================================================

function syncFieldNextWeek() { withLog_('syncFieldNextWeek', () => syncField(nextOpenWeek_())); }
function syncResultsLastWeek() { withLog_('syncResultsLastWeek', () => syncResults(lastClosedWeek_())); }

// Count players who made the cut for an event. Pros who make the cut always earn
// money, so earnings > 0 catches them — but amateurs make the cut with $0, so
// earnings alone undercounts. We add any amateur whose finishing position is a real
// place. Amateurs are few (usually zero), so the extra status lookups are cheap.
function computeMadeCut_(eventId) {
  const res = UrlFetchApp.fetch(ESPN_CORE_EVENT + eventId, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error(`ESPN core HTTP ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }
  const json = JSON.parse(res.getContentText());
  const comps = (json.competitions && json.competitions[0] && json.competitions[0].competitors) || [];
  let made = 0;
  for (const c of comps) {
    if (Number(c.earnings || 0) > 0) { made++; continue; }
    // $0 earnings: only an amateur could still have made the cut — check their place.
    const ref = c.amateur && c.status && c.status.$ref;
    if (!ref) continue;
    try {
      const st = JSON.parse(UrlFetchApp.fetch(ref, { muteHttpExceptions: true }).getContentText());
      const pos = String((st.position && st.position.displayName) || st.displayValue || '').trim();
      if (/^T?\d+$/i.test(pos)) made++;   // a numeric finishing place = made the cut
    } catch (e) { /* couldn't confirm — leave uncounted */ }
  }
  return made;
}

// Write the made-cut count for a week into a "Cut" column on the Schedule tab
// (creating the column if it doesn't exist). Powers the app's Avg-Place stat.
function writeCutCount_(ss, week, madeCut) {
  const sh = getSheet_(ss, SCHEDULE_TAB);
  const rng = sh.getDataRange();
  const values = rng.getValues();
  const header = values[0] || [];
  let cutCol = header.findIndex(h => /^(made\s*)?cut$/i.test(String(h || '').trim()));
  if (cutCol < 0) {
    cutCol = header.length;                         // append a new "Cut" column
    sh.getRange(1, cutCol + 1).setValue('Cut').setFontWeight('bold');
  }
  for (let i = 1; i < values.length; i++) {
    if (parseInt(values[i][0], 10) === week) {
      sh.getRange(i + 1, cutCol + 1).setValue(madeCut);
      return;
    }
  }
}

// One-time (idempotent) backfill: fill the Cut column for every Schedule week that
// has a deadline, by pulling each event's field from ESPN. Weeks before the
// Schedule tab (1–15) are baked into the app itself, so this covers 16 onward.
function backfillCutCounts() {
  withLog_('backfillCutCounts', () => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sched = getSchedule(ss).filter(r => r.deadline);
    let filled = 0, skipped = 0;
    for (const r of sched) {
      try {
        const lb = fetchEspnScoreboard(espnDateRange_(r.deadline), r.event);
        const madeCut = computeMadeCut_(lb.eventId);
        if (madeCut > 0) { writeCutCount_(ss, r.week, madeCut); filled++; }
        else skipped++;
      } catch (e) {
        skipped++;   // event not found / not yet played — leave blank
      }
    }
    return `Cut counts filled for ${filled} week(s); ${skipped} skipped (not played / no data).`;
  });
}

function syncField(week) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sched = getSchedule(ss).find(r => r.week === week);
  if (!sched) throw new Error(`Schedule row for Week ${week} not found`);
  if (!sched.deadline) throw new Error(`Week ${week} has no deadline set`);

  const lb = fetchEspnScoreboard(espnDateRange_(sched.deadline), sched.event);

  const sh = ensureSheet_(ss, FIELD_TAB, ['Week', 'Golfer']);
  // Clear existing rows for this week, then append.
  const existing = sh.getDataRange().getValues();
  const keep = [existing[0]]; // header
  for (let i = 1; i < existing.length; i++) {
    if (parseInt(existing[i][0], 10) !== week) keep.push(existing[i]);
  }
  sh.clear();
  sh.getRange(1, 1, keep.length, 2).setValues(keep);
  const newRows = lb.athletes.map(a => [week, a.name]);
  if (newRows.length) {
    sh.getRange(keep.length + 1, 1, newRows.length, 2).setValues(newRows);
  }
  return `Field synced for Week ${week}: ${lb.eventName} (${lb.athletes.length} golfers)`;
}

function syncResults(week) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sched = getSchedule(ss).find(r => r.week === week);
  if (!sched) throw new Error(`Schedule row for Week ${week} not found`);
  if (!sched.deadline) throw new Error(`Week ${week} has no deadline set`);

  const lb = fetchEspnScoreboard(espnDateRange_(sched.deadline), sched.event);
  const earnings = fetchEspnEarnings(lb.eventId);
  const positions = computeDisplayPositions(lb.athletes, earnings);

  // Record how many made the cut (amateur-aware) for the Avg-Place stat in the app.
  const madeCut = computeMadeCut_(lb.eventId);
  if (madeCut > 0) writeCutCount_(ss, week, madeCut);

  const sh = ensureSheet_(ss, PENDING_TAB, ['Week', 'Golfer', 'Finish', 'Payout']);
  // Clear existing rows for this week, then append.
  const existing = sh.getDataRange().getValues();
  const keep = [existing[0]];
  for (let i = 1; i < existing.length; i++) {
    if (parseInt(existing[i][0], 10) !== week) keep.push(existing[i]);
  }
  sh.clear();
  sh.getRange(1, 1, keep.length, 4).setValues(keep);
  const newRows = lb.athletes.map(a => [week, a.name, positions[a.id] || '', earnings[a.id] || 0]);
  if (newRows.length) {
    sh.getRange(keep.length + 1, 1, newRows.length, 4).setValues(newRows);
  }
  return `Results staged for Week ${week}: ${lb.eventName} (${lb.athletes.length} rows). Review on '${PENDING_TAB}' tab and click Apply.`;
}

function applyPendingResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PENDING_TAB);
  if (!sh) throw new Error(`No '${PENDING_TAB}' tab — run a results sync first`);
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) {
    SpreadsheetApp.getUi().alert('Pending Results is empty — nothing to apply.');
    return;
  }
  // Index pending by (week, golfer-lower)
  const pending = {};
  for (let i = 1; i < rows.length; i++) {
    const wk = parseInt(rows[i][0], 10);
    const golfer = String(rows[i][1] || '').trim();
    const finish = String(rows[i][2] || '').trim();
    const payout = Number(rows[i][3] || 0);
    if (!wk || !golfer) continue;
    pending[wk + '|' + nameKey_(golfer)] = { finish, payout, golfer };
  }

  // Walk the picks tab and update matching cells
  const psh = getSheet_(ss, PICKS_TAB);
  const pdata = psh.getDataRange().getValues();
  const header = pdata[0];
  const partCols = [];
  for (let c = 2; c + 1 < header.length; c += 2) {
    const name = String(header[c] || '').trim();
    if (name && name.toLowerCase() !== 'payout') partCols.push({ name, col: c });
  }

  let updates = 0, skipped = 0;
  for (let r = 1; r < pdata.length; r++) {
    const wk = parseInt(pdata[r][0], 10);
    if (!wk) continue;
    for (const p of partCols) {
      const cell = String(pdata[r][p.col] || '').trim();
      if (!cell) continue;
      const m = cell.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      const pickedName = m ? m[1].trim() : cell;
      const alreadyAnnotated = !!m;
      const key = wk + '|' + nameKey_(pickedName);
      const upd = pending[key];
      if (!upd) continue;
      if (alreadyAnnotated) { skipped++; continue; }
      // Write pick cell with finish, write payout cell with formatted dollars
      const newPickValue = `${upd.golfer} (${upd.finish})`;
      psh.getRange(r + 1, p.col + 1).setValue(newPickValue);
      if (upd.payout > 0) {
        psh.getRange(r + 1, p.col + 2).setValue(upd.payout);
        psh.getRange(r + 1, p.col + 2).setNumberFormat('"$"#,##0');
      }
      updates++;
    }
  }

  // Clear pending rows, keep header
  sh.clear();
  sh.getRange(1, 1, 1, 4).setValues([['Week', 'Golfer', 'Finish', 'Payout']]);

  appendLog_('applyPendingResults', '', 'OK', `${updates} pick cells updated, ${skipped} already annotated.`);
  SpreadsheetApp.getUi().alert(`Applied ${updates} updates. ${skipped} already-annotated cells skipped.`);
}

// =========================================================================
// Helpers — week selection, name matching, log, ensure-sheet
// =========================================================================

function nextOpenWeek_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sched = getSchedule(ss).filter(r => r.deadline).sort((a, b) => a.deadline - b.deadline);
  const now = new Date();
  const next = sched.find(r => r.deadline > now);
  if (!next) throw new Error('No upcoming week with a future deadline in Schedule');
  return next.week;
}

function lastClosedWeek_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sched = getSchedule(ss).filter(r => r.deadline).sort((a, b) => b.deadline - a.deadline);
  // "last closed" = most recent deadline that's at least 24h in the past
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const last = sched.find(r => r.deadline < cutoff);
  if (!last) throw new Error('No completed week (deadline ≥24h ago) in Schedule');
  return last.week;
}

function nameKey_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nameMatch_(a, b) {
  const ak = nameKey_(a), bk = nameKey_(b);
  return ak === bk || ak.includes(bk) || bk.includes(ak);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

function appendLog_(fn, week, status, message) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ensureSheet_(ss, LOG_TAB, ['Timestamp', 'Function', 'Week', 'Status', 'Message']);
  sh.appendRow([new Date(), fn, week, status, message]);
}

function withLog_(fn, body) {
  try {
    const msg = body();
    appendLog_(fn, '', 'OK', msg || 'OK');
    return msg;
  } catch (e) {
    appendLog_(fn, '', 'ERROR', e && e.message ? e.message : String(e));
    // Re-throw so manual menu runs surface the error in the UI
    throw e;
  }
}
