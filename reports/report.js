// Turns raw tour events (see the README's Reporting section) into the numbers the report pages show.
// Pure: no storage, no network, so the tests can feed it events directly.

const DAY = 86400000;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// One record per run of a tour, from its events.
function runsOf(events) {
  const runs = new Map();
  for (const e of events) {
    if (!e || !e.runId || !e.tourId) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    let r = runs.get(e.runId);
    if (!r) {
      r = { tourId: e.tourId, status: e.tourStatus, start: t, total: 0, how: null, shown: new Map(), failed: new Set(), clues: new Set(), end: null, paused: null };
      runs.set(e.runId, r);
    }
    r.start = Math.min(r.start, t);
    if (e.total) r.total = e.total;
    if (e.type === 'tour_started') r.how = e.how;
    else if (e.type === 'step_shown') {
      // the first time each step showed in this run, in ms since the run started
      if (!r.shown.has(e.step) || e.ms < r.shown.get(e.step)) r.shown.set(e.step, e.ms);
      if (e.anchor === 'clues') r.clues.add(e.step);
    } else if (e.type === 'step_failed') r.failed.add(e.step);
    else if (e.type === 'tour_paused') r.paused = e.step;
    else if (e.type === 'tour_finished' || e.type === 'tour_closed') r.end = { type: e.type, step: e.step, how: e.how, ms: e.ms, at: t };
  }
  return [...runs.values()];
}

// days: the period shown; the period before it is used for the trend. previews: count the builder's previews.
export function report(events, { days = 30, now = Date.now(), previews = false } = {}) {
  const since = now - days * DAY;
  const before = since - days * DAY;
  const all = runsOf(events).filter((r) => previews || r.how !== 'preview');
  const current = all.filter((r) => r.start >= since && r.start <= now);
  const earlier = all.filter((r) => r.start >= before && r.start < since);
  const byTour = new Map();
  for (const r of current) {
    if (!byTour.has(r.tourId)) byTour.set(r.tourId, []);
    byTour.get(r.tourId).push(r);
  }
  const tours = [...byTour].map(([tourId, runs]) => {
    const total = Math.max(...runs.map((r) => r.total));
    const finished = runs.filter((r) => r.end && r.end.type === 'tour_finished');
    const steps = Array.from({ length: total }, (_, i) => {
      const n = i + 1;
      const reached = runs.filter((r) => r.shown.has(n));
      // time on a step: until the next step showed or the run ended
      const times = reached.map((r) => {
        const next = r.shown.get(n + 1) ?? (r.end ? r.end.ms : null);
        return next == null ? null : next - r.shown.get(n);
      }).filter((x) => x != null && x >= 0);
      const failedRuns = runs.filter((r) => r.failed.has(n));
      const failTimes = failedRuns.map((r) => r.start);
      return {
        step: n, reached: reached.length, medianMs: median(times),
        failed: failedRuns.length, clues: runs.filter((r) => r.clues.has(n)).length,
        firstFailed: failTimes.length ? new Date(Math.min(...failTimes)).toISOString() : null,
        lastFailed: failTimes.length ? new Date(Math.max(...failTimes)).toISOString() : null,
      };
    });
    // Why runs that didn't finish ended: × , Stop tour, left the page, or no end at all (tab closed, another tour)
    const exits = { close: 0, stop: 0, left_page: 0, no_end: 0 };
    const leftAt = {};
    for (const r of runs) {
      if (r.end && r.end.type === 'tour_finished') continue;
      const reason = r.end ? r.end.how || 'close' : r.paused ? 'left_page' : 'no_end';
      exits[reason] = (exits[reason] || 0) + 1;
      const last = r.end ? r.end.step : Math.max(0, ...r.shown.keys());
      leftAt[last] = (leftAt[last] || 0) + 1;
    }
    const prev = earlier.filter((r) => r.tourId === tourId).length;
    return {
      tourId, status: runs.some((r) => r.status === 'live') ? 'live' : runs[0].status, totalSteps: total,
      views: runs.length, previousViews: prev, trend: prev ? Math.round(((runs.length - prev) / prev) * 100) : null,
      finished: finished.length, finishRate: Math.round((finished.length / runs.length) * 100),
      medianFinishMs: median(finished.map((r) => r.end.ms)),
      failures: steps.reduce((s, x) => s + x.failed, 0), brokenSteps: steps.filter((x) => x.failed).map((x) => x.step),
      lastRun: new Date(Math.max(...runs.map((r) => r.start))).toISOString(),
      steps, exits, leftAt,
    };
  });
  tours.sort((a, b) => b.views - a.views);
  const views = current.length;
  return {
    days, since: new Date(since).toISOString(), now: new Date(now).toISOString(),
    totals: {
      views, tours: tours.length,
      finishRate: views ? Math.round((current.filter((r) => r.end && r.end.type === 'tour_finished').length / views) * 100) : null,
      toursWithFailures: tours.filter((t) => t.failures).length,
    },
    tours,
  };
}
