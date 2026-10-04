"use strict";

/**
 * Cap behavior (see docs/XSTATE-MERGE-PLAN.md, P-01). Needs the limits set before `shared.js` is loaded (it reads them at require time),
 * so it lives in its own file (one process per test file). The session cap works when configured
 * (its default is 1,000,000); the daily cap is a known defect and is marked `todo`.
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

test(
  "P-01: the daily cap answers 429 with errorKind rate_limit and makes no upstream call",
  { todo: "P-01: the daily counter is never incremented" },
  async () => {
    const shared = require("../shared");
    const fake = await startFakeOpenAI();
    try {
      const store = shared.createMemoryDailyUsageStore();
      const { results } = await driveSession({
        client: fake.createClient(),
        turns: 5,
        dailyUsageStore: store,
      });
      const limited = results.find((r) => r.status === 429);
      assert.ok(limited, `statuses: ${results.map((r) => r.status).join(",")}`);
      assert.equal(limited.body.errorKind, "rate_limit");
    } finally {
      await fake.close();
    }
  }
);
