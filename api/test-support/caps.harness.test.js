"use strict";

/**
 * Cap behavior (docs/XSTATE-MERGE-PLAN.md, P-01). `shared.js` reads the limits when it loads, so they are set
 * here first and this lives in its own file (one process per test file). The session cap works when configured
 * (default 40); the daily cap (default 300) counts LLM-backed turns across sessions.
 */

process.env.MAX_USER_EXCHANGES = "3";
process.env.MAX_DAILY_USAGE = "2";

require("./noDurable");
const test = require("node:test");
const assert = require("node:assert/strict");

const { startFakeOpenAI } = require("./fakeOpenAI");
const { driveSession } = require("./driveSession");

test("per-session exchange cap: once exceeded the API answers 204 and makes no upstream calls", async () => {
  const fake = await startFakeOpenAI();
  try {
    const client = fake.createClient();
    const sessionId = "cap-session";
    const statuses = [];
    const callsPerTurn = [];
    for (let i = 0; i < 8; i += 1) {
      const before = fake.requests.length;
      const { results } = await driveSession({ client, turns: 1, sessionId });
      statuses.push(results[0].status);
      callsPerTurn.push(fake.requests.length - before);
    }
    const firstCap = statuses.indexOf(204);
    assert.ok(firstCap > 0, `no 204 in ${statuses.join(",")}`);
    assert.ok(statuses.slice(firstCap).every((s) => s === 204), statuses.join(","));
    assert.ok(callsPerTurn.slice(firstCap).every((n) => n === 0), callsPerTurn.join(","));
    assert.ok(firstCap <= 5, `cap of 3 let ${firstCap} turns through`);
  } finally {
    await fake.close();
  }
});

test("daily cap: turns past MAX_DAILY_USAGE answer 429 rate_limit and make no upstream calls", async () => {
  const shared = require("../shared");
  const { DAILY_LIMIT_MESSAGE } = require("../usage/usageLimits");
  const fake = await startFakeOpenAI();
  try {
    const client = fake.createClient();
    const store = shared.createMemoryDailyUsageStore();
    const statuses = [];
    const callsPerTurn = [];
    let lastBody;
    for (let i = 0; i < 5; i += 1) {
      const before = fake.requests.length;
      const { results } = await driveSession({ client, turns: 1, sessionId: `daily-${i}`, dailyUsageStore: store });
      statuses.push(results[0].status);
      callsPerTurn.push(fake.requests.length - before);
      lastBody = results[0].body;
    }
    assert.deepEqual(statuses, [200, 200, 429, 429, 429]);
    assert.deepEqual(callsPerTurn.slice(2), [0, 0, 0]);
    assert.ok(callsPerTurn[0] > 0 && callsPerTurn[1] > 0);
    assert.equal(lastBody.errorKind, "rate_limit");
    assert.equal(lastBody.error, DAILY_LIMIT_MESSAGE);
    assert.equal(store.readDailyUsage(), 2);
  } finally {
    await fake.close();
  }
});
