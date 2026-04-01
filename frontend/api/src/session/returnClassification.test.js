"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config");
const {
  classifySessionReturn,
  classifyFromSessionAndDossier,
} = require("./returnClassification");

function isoMs(ms) {
  return new Date(ms).toISOString();
}

describe("classifySessionReturn", () => {
  const nowMs = Date.UTC(2025, 5, 10, 12, 0, 0);
  const now = new Date(nowMs);

  it("UNKNOWN when last activity is missing", () => {
    const r = classifySessionReturn({
      lastActivityAtIso: null,
      now,
      baselineCompleted: true,
      baselineDossierRecorded: true,
      lastBaselineCompletedAtMs: nowMs,
    });
    assert.equal(r.returnCategory, "UNKNOWN");
    assert.equal(r.needsBaselineRefresh, false);
    assert.equal(r.baselineReason, "no_last_activity_or_unparsed");
    assert.equal(r.timeAwayMs, null);
  });

  it("JUST_STEPPED_AWAY when within TIME_AWAY_BRIEF_MS", () => {
    const lastMs = nowMs - Math.floor(config.TIME_AWAY_BRIEF_MS / 2);
    const r = classifySessionReturn({
      lastActivityAtIso: isoMs(lastMs),
      now,
      baselineCompleted: true,
      baselineDossierRecorded: true,
      lastBaselineCompletedAtMs: lastMs,
    });
    assert.equal(r.returnCategory, "JUST_STEPPED_AWAY");
    assert.equal(r.needsBaselineRefresh, false);
    assert.equal(r.baselineReason, "quick_return");
    assert.ok(r.timeAwayMs != null && r.timeAwayMs <= config.TIME_AWAY_BRIEF_MS);
  });

  it("DAY_OR_SO when between quick and long-gone thresholds", () => {
    const lastMs = nowMs - (config.TIME_AWAY_BRIEF_MS + 60_000);
    assert.ok(lastMs < nowMs - config.TIME_AWAY_BRIEF_MS);
    assert.ok(nowMs - lastMs < config.TIME_AWAY_LONG_MS);
    const r = classifySessionReturn({
      lastActivityAtIso: isoMs(lastMs),
      now,
      baselineCompleted: true,
      baselineDossierRecorded: true,
      lastBaselineCompletedAtMs: lastMs,
    });
    assert.equal(r.returnCategory, "DAY_OR_SO");
  });

  it("LONG_GONE when away >= TIME_AWAY_LONG_MS", () => {
    const lastMs = nowMs - config.TIME_AWAY_LONG_MS - 3_600_000;
    const r = classifySessionReturn({
      lastActivityAtIso: isoMs(lastMs),
      now,
      baselineCompleted: true,
      baselineDossierRecorded: true,
      lastBaselineCompletedAtMs: lastMs,
    });
    assert.equal(r.returnCategory, "LONG_GONE");
    assert.equal(r.needsBaselineRefresh, true);
    assert.equal(r.baselineReason, "long_gone_refresh_baseline");
  });

  it("LONG_GONE + still in baseline (attache not completed) does not require refresh", () => {
    const lastMs = nowMs - config.TIME_AWAY_LONG_MS - 3_600_000;
    const r = classifySessionReturn({
      lastActivityAtIso: isoMs(lastMs),
      now,
      baselineCompleted: false,
      baselineDossierRecorded: false,
      lastBaselineCompletedAtMs: null,
    });
    assert.equal(r.returnCategory, "LONG_GONE");
    assert.equal(r.needsBaselineRefresh, false);
    assert.equal(r.baselineReason, "long_gone_still_in_baseline");
  });

  it("DAY_OR_SO + detective + fresh baseline → no refresh", () => {
    const lastMs = nowMs - 20 * 3_600_000;
    const baselineDoneMs = nowMs - Math.floor(config.TIME_AWAY_STALE_MS / 2);
    const r = classifySessionReturn({
      lastActivityAtIso: isoMs(lastMs),
      now,
      baselineCompleted: true,
      baselineDossierRecorded: true,
      lastBaselineCompletedAtMs: baselineDoneMs,
    });
    assert.equal(r.returnCategory, "DAY_OR_SO");
    assert.equal(r.needsBaselineRefresh, false);
    assert.equal(r.baselineReason, "day_or_so_fresh_baseline");
  });

  it("DAY_OR_SO + detective + stale baseline → refresh", () => {
    const lastMs = nowMs - 20 * 3_600_000;
    const baselineDoneMs = nowMs - config.TIME_AWAY_STALE_MS - 3_600_000;
    const r = classifySessionReturn({
      lastActivityAtIso: isoMs(lastMs),
      now,
      baselineCompleted: true,
      baselineDossierRecorded: true,
      lastBaselineCompletedAtMs: baselineDoneMs,
    });
    assert.equal(r.returnCategory, "DAY_OR_SO");
    assert.equal(r.needsBaselineRefresh, true);
    assert.equal(r.baselineReason, "day_or_so_stale_baseline");
  });

  it("DAY_OR_SO + detective + missing baseline timestamp → refresh", () => {
    const lastMs = nowMs - 20 * 3_600_000;
    const r = classifySessionReturn({
      lastActivityAtIso: isoMs(lastMs),
      now,
      baselineCompleted: true,
      baselineDossierRecorded: true,
      lastBaselineCompletedAtMs: null,
    });
    assert.equal(r.needsBaselineRefresh, true);
    assert.equal(r.baselineReason, "day_or_so_missing_baseline_timestamp");
  });
});

describe("classifyFromSessionAndDossier", () => {
  const nowMs = Date.UTC(2025, 7, 1, 8, 0, 0);
  const now = new Date(nowMs);

  it("reads returnPolicyLastActivityAt and dossier meta", () => {
    const lastMs = nowMs - config.TIME_AWAY_LONG_MS - 1;
    const session = {
      returnPolicyLastActivityAt: isoMs(lastMs),
      attacheCompleted: true,
    };
    const dossier = {
      meta: {
        baselineQuestionsAnswered: 2,
        lastBaselineCompletedAt: nowMs - 5 * 3_600_000,
      },
    };
    const r = classifyFromSessionAndDossier(session, dossier, now);
    assert.equal(r.returnCategory, "LONG_GONE");
    assert.equal(r.needsBaselineRefresh, true);
  });

  it("baselineDossierRecorded false when baselineQuestionsAnswered is 0", () => {
    const lastMs = nowMs - 20 * 3_600_000;
    const session = {
      returnPolicyLastActivityAt: isoMs(lastMs),
      attacheCompleted: true,
    };
    const dossier = {
      meta: {
        baselineQuestionsAnswered: 0,
        lastBaselineCompletedAt: nowMs,
      },
    };
    const r = classifyFromSessionAndDossier(session, dossier, now);
    assert.equal(r.needsBaselineRefresh, true);
    assert.equal(r.baselineReason, "day_or_so_no_dossier_baseline");
  });
});
