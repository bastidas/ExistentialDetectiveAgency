"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  utcDayKey,
  createMemoryDailyUsageStore,
  createFileDailyUsageStore,
  createTableDailyUsageStore,
} = require("./dailyUsageStore");

const DAY = 24 * 3600 * 1000;

test("utcDayKey uses the UTC date", () => {
  assert.equal(utcDayKey(Date.UTC(2026, 9, 4, 23, 59, 59)), "2026-10-04");
  assert.equal(utcDayKey(Date.UTC(2026, 9, 5, 0, 0, 0)), "2026-10-05");
});

test("memory store: reserves up to max, refuses after, resets on the next UTC day", () => {
  let t = Date.UTC(2026, 9, 4, 12);
  const s = createMemoryDailyUsageStore({ now: () => t });
  assert.deepEqual(s.reserveTurn(2), { allowed: true, count: 1 });
  assert.deepEqual(s.reserveTurn(2), { allowed: true, count: 2 });
  assert.deepEqual(s.reserveTurn(2), { allowed: false, count: 2 });
  assert.equal(s.readDailyUsage(), 2);
  t += DAY;
  assert.equal(s.readDailyUsage(), 0);
  assert.deepEqual(s.reserveTurn(2), { allowed: true, count: 1 });
});

test("file store: persists across instances, ignores a stale date, tolerates garbage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eda-daily-"));
  try {
    let t = Date.UTC(2026, 9, 4, 12);
    const a = createFileDailyUsageStore(dir, { now: () => t });
    assert.equal(a.readDailyUsage(), 0);
    assert.equal(a.reserveTurn(2).allowed, true);
    const b = createFileDailyUsageStore(dir, { now: () => t });
    assert.equal(b.readDailyUsage(), 1);
    assert.equal(b.reserveTurn(2).allowed, true);
    assert.equal(a.reserveTurn(2).allowed, false);
    t += DAY;
    assert.equal(a.readDailyUsage(), 0);
    fs.writeFileSync(path.join(dir, "daily_usage.json"), "not json");
    assert.equal(a.readDailyUsage(), 0);
    assert.equal(a.reserveTurn(2).allowed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("file store: an old-format file (count without date) does not count against today", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eda-daily-"));
  try {
    fs.writeFileSync(path.join(dir, "daily_usage.json"), JSON.stringify({ count: 999 }));
    assert.equal(createFileDailyUsageStore(dir).readDailyUsage(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("table store: a storage failure falls back to the per-process counter and still enforces the cap", async () => {
  const broken = {
    createTable: async () => {
      throw Object.assign(new Error("storage down"), { statusCode: 503 });
    },
  };
  const errors = [];
  const s = createTableDailyUsageStore(broken, { onError: (e) => errors.push(e.message) });
  assert.deepEqual(await s.reserveTurn(2), { allowed: true, count: 1 });
  assert.deepEqual(await s.reserveTurn(2), { allowed: true, count: 2 });
  assert.deepEqual(await s.reserveTurn(2), { allowed: false, count: 2 });
  assert.equal(await s.readDailyUsage(), 2);
  assert.ok(errors.length >= 3);
});

// Azurite-backed checks (skipped locally without Azurite, required in CI).
const azuriteConfigured =
  String(process.env.DURABLE_STORAGE_MODE || "").trim().toLowerCase() === "azurite" &&
  String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim() &&
  String(process.env.DOSSIER_TABLE_NAME || "").trim();

if (!azuriteConfigured && /^(1|true)$/i.test(process.env.CI || "")) {
  test("Azurite must be configured in CI (daily usage)", () => {
    assert.fail("Azurite environment is not configured; see .github/workflows/test.yml.");
  });
}

test("table store (Azurite): counts per day, refuses at max, resets on a new day", { skip: !azuriteConfigured }, async () => {
  const client = require("../storage/durableTableStorage").getTableClient();
  let t = Date.UTC(2090, 0, 1 + Math.floor(Math.random() * 300), 12);
  const s = createTableDailyUsageStore(client, { now: () => t });
  assert.equal(await s.readDailyUsage(), 0);
  assert.deepEqual(await s.reserveTurn(3), { allowed: true, count: 1 });
  assert.deepEqual(await s.reserveTurn(3), { allowed: true, count: 2 });
  assert.deepEqual(await s.reserveTurn(3), { allowed: true, count: 3 });
  assert.deepEqual(await s.reserveTurn(3), { allowed: false, count: 3 });
  assert.equal(await s.readDailyUsage(), 3);
  const other = createTableDailyUsageStore(client, { now: () => t });
  assert.equal(await other.readDailyUsage(), 3, "a second instance sees the same counter");
  t += DAY;
  assert.equal(await s.readDailyUsage(), 0);
});

test(
  "table store (Azurite): concurrent reservations from several instances never exceed the cap",
  { skip: !azuriteConfigured },
  async () => {
    const client = require("../storage/durableTableStorage").getTableClient();
    const t = Date.UTC(2091, 0, 1 + Math.floor(Math.random() * 300), 12);
    const instances = Array.from({ length: 4 }, () =>
      createTableDailyUsageStore(client, {
        now: () => t,
        onError: () => {
          throw new Error("unexpected storage error");
        },
      })
    );
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => instances[i % 4].reserveTurn(10)));
    const allowed = results.filter((r) => r.allowed).length;
    assert.equal(allowed, 10);
    assert.equal(await instances[0].readDailyUsage(), 10);
  }
);
