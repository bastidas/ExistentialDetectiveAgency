"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DEFAULT_MAX_USER_EXCHANGES,
  DEFAULT_MAX_DAILY_USAGE,
  parsePositiveInt,
  resolveMaxUserExchanges,
  resolveMaxDailyUsage,
  createFileDailyUsageStore,
  createMemoryDailyUsageStore,
  reserveDailyTurn,
} = require("./usageLimits");

test("defaults are finite, small caps (not effectively unlimited)", () => {
  assert.equal(resolveMaxUserExchanges({}), DEFAULT_MAX_USER_EXCHANGES);
  assert.equal(resolveMaxDailyUsage({}), DEFAULT_MAX_DAILY_USAGE);
  assert.ok(DEFAULT_MAX_USER_EXCHANGES <= 1000);
  assert.ok(DEFAULT_MAX_DAILY_USAGE <= 10_000);
});

test("env overrides parse as positive integers; junk falls back", () => {
  assert.equal(resolveMaxUserExchanges({ MAX_USER_EXCHANGES: "12" }), 12);
  assert.equal(resolveMaxDailyUsage({ MAX_DAILY_USAGE: " 7 " }), 7);
  assert.equal(parsePositiveInt("abc", 5), 5);
  assert.equal(parsePositiveInt("0", 5), 5);
  assert.equal(parsePositiveInt("-3", 5), 5);
  assert.equal(parsePositiveInt("", 5), 5);
  assert.equal(parsePositiveInt(undefined, 5), 5);
  assert.equal(parsePositiveInt("2.9", 5), 2);
});

test("memory store counts and resets at the UTC day boundary", () => {
  let t = Date.parse("2026-01-01T23:59:00Z");
  const store = createMemoryDailyUsageStore({ now: () => t });
  assert.equal(store.readDailyUsage(), 0);
  store.incrementDailyUsage();
  store.incrementDailyUsage();
  assert.equal(store.readDailyUsage(), 2);
  t = Date.parse("2026-01-02T00:00:01Z");
  assert.equal(store.readDailyUsage(), 0);
  assert.equal(store.incrementDailyUsage(), 1);
});

test("file store persists { date, count } and ignores a previous day", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eda-usage-"));
  try {
    let t = Date.parse("2026-03-10T12:00:00Z");
    const store = createFileDailyUsageStore(dir, { now: () => t });
    assert.equal(store.readDailyUsage(), 0);
    store.incrementDailyUsage();
    store.incrementDailyUsage();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "daily_usage.json"), "utf8"));
    assert.deepEqual(saved, { date: "2026-03-10", count: 2 });
    assert.equal(createFileDailyUsageStore(dir, { now: () => t }).readDailyUsage(), 2);
    t = Date.parse("2026-03-11T00:00:00Z");
    assert.equal(store.readDailyUsage(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reserveDailyTurn increments until the cap, then refuses without incrementing", () => {
  const store = createMemoryDailyUsageStore();
  assert.deepEqual(reserveDailyTurn(store, 2), { allowed: true, dailyUsage: 1 });
  assert.deepEqual(reserveDailyTurn(store, 2), { allowed: true, dailyUsage: 2 });
  assert.deepEqual(reserveDailyTurn(store, 2), { allowed: false, dailyUsage: 2 });
  assert.equal(store.readDailyUsage(), 2);
});

test("reserveDailyTurn without a store allows the turn", () => {
  assert.deepEqual(reserveDailyTurn(null, 1), { allowed: true, dailyUsage: 0 });
});
