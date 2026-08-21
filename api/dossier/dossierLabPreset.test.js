"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getTimeAwayThresholds } = require("../orchestration/timeAwayClassification");
const {
  resolveLabLastBaselineCompletedAt,
  validateLabDossierBaselinePreset,
} = require("./dossierLabPreset");

test("resolveLabLastBaselineCompletedAt: custom offset", () => {
  const now = 1_000_000;
  const t = resolveLabLastBaselineCompletedAt(
    {
      hasDossier: true,
      dossierBaselineAge: "custom",
      dossierLastBaselineCompletedAtOffsetMs: 50_000,
      baselineCompleted: true,
    },
    now
  );
  assert.equal(t, now - 50_000);
});

test("resolveLabLastBaselineCompletedAt: auto attaché → stale", () => {
  const { longMs } = getTimeAwayThresholds();
  const now = Date.now();
  const t = resolveLabLastBaselineCompletedAt(
    {
      hasDossier: true,
      baselineCompleted: false,
    },
    now
  );
  assert.ok(typeof t === "number");
  assert.ok(now - t > longMs);
});

test("resolveLabLastBaselineCompletedAt: auto detective → fresh", () => {
  const now = Date.now();
  const t = resolveLabLastBaselineCompletedAt(
    {
      hasDossier: true,
      baselineCompleted: true,
    },
    now
  );
  assert.equal(t, now);
});

test("validateLabDossierBaselinePreset: rejects bad age", () => {
  const e = validateLabDossierBaselinePreset({ dossierBaselineAge: "nope" });
  assert.ok(e && e.error);
});

test("validateLabDossierBaselinePreset: custom requires non-negative offset", () => {
  const e = validateLabDossierBaselinePreset({
    dossierBaselineAge: "custom",
    dossierLastBaselineCompletedAtOffsetMs: -1,
  });
  assert.ok(e && e.error);
});
