"use strict";

/**
 * Spend and abuse controls on handleChatRequest (docs/XSTATE-MERGE-PLAN.md, P-01): message length,
 * per-client burst limit, and that a closed session never spends a daily-cap reservation.
 * Limits are read when shared.js loads, so they are set first.
 */

process.env.MAX_USER_EXCHANGES = "3";
process.env.MAX_DAILY_USAGE = "100";
process.env.MAX_MESSAGE_CHARS = "50";
process.env.MAX_REQUESTS_PER_MINUTE = "4";

require("./noDurable");
const test = require("node:test");
const assert = require("node:assert/strict");

const { startFakeOpenAI } = require("./fakeOpenAI");
const { driveSession } = require("./driveSession");
const shared = require("../shared");
const { RATE_LIMIT_MESSAGE } = require("../usage/usageLimits");

test("a message over MAX_MESSAGE_CHARS is rejected with 400 before any model call or reservation", async () => {
  const fake = await startFakeOpenAI();
  try {
    let reservations = 0;
    const store = {
      reserveTurn: () => {
        reservations += 1;
        return { allowed: true, count: reservations };
      },
      readDailyUsage: () => reservations,
    };
    const r = await shared.handleChatRequest("len-1", "x".repeat(51), {
      openaiClient: fake.createClient(),
      dailyUsageStore: store,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.errorKind, "bad_request");
    assert.match(r.body.error, /50 characters/);
    assert.equal(fake.requests.length, 0);
    assert.equal(reservations, 0);

    const ok = await shared.handleChatRequest("len-1", "x".repeat(50), {
      openaiClient: fake.createClient(),
      dailyUsageStore: store,
    });
    assert.equal(ok.status, 200);
  } finally {
    await fake.close();
  }
});

test("per-client burst limit: requests past the limit get 429 rate_limit and cost nothing", async () => {
  const fake = await startFakeOpenAI();
  try {
    const client = fake.createClient();
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const before = fake.requests.length;
      const r = await shared.handleChatRequest(`burst-${i}`, "hello", {
        openaiClient: client,
        dailyUsageStore: shared.createMemoryDailyUsageStore(),
        clientKey: "203.0.113.7",
      });
      statuses.push(r.status);
      if (r.status === 429) {
        assert.equal(r.body.errorKind, "rate_limit");
        assert.equal(r.body.error, RATE_LIMIT_MESSAGE);
        assert.equal(fake.requests.length, before, "no upstream call when rate limited");
      }
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);

    const other = await shared.handleChatRequest("burst-other", "hello", {
      openaiClient: client,
      dailyUsageStore: shared.createMemoryDailyUsageStore(),
      clientKey: "198.51.100.9",
    });
    assert.equal(other.status, 200, "a different client is unaffected");
  } finally {
    await fake.close();
  }
});

test("requests without a client key are not burst limited (tests, internal callers)", async () => {
  const fake = await startFakeOpenAI();
  try {
    const { results } = await driveSession({ client: fake.createClient(), turns: 3 });
    assert.ok(results.every((r) => r.status === 200 || r.status === 204));
  } finally {
    await fake.close();
  }
});

test("a closed session answers 204 without spending a daily reservation", async () => {
  const fake = await startFakeOpenAI();
  try {
    let reservations = 0;
    const store = {
      reserveTurn: () => {
        reservations += 1;
        return { allowed: true, count: reservations };
      },
      readDailyUsage: () => reservations,
    };
    const statuses = [];
    for (let i = 0; i < 8; i += 1) {
      const { results } = await driveSession({
        client: fake.createClient(),
        turns: 1,
        sessionId: "closed-1",
        dailyUsageStore: store,
      });
      statuses.push(results[0].status);
    }
    const modelTurns = statuses.filter((s) => s === 200).length;
    assert.ok(statuses.includes(204), statuses.join(","));
    assert.equal(reservations, modelTurns, `reservations ${reservations} vs 200s ${modelTurns}`);
  } finally {
    await fake.close();
  }
});

test("offline mode (no model client) does not spend daily reservations", async () => {
  let reservations = 0;
  const store = {
    reserveTurn: () => {
      reservations += 1;
      return { allowed: true, count: reservations };
    },
    readDailyUsage: () => reservations,
  };
  const r = await shared.handleChatRequest("offline-1", "hello", { openaiClient: null, dailyUsageStore: store });
  assert.ok([200, 204].includes(r.status));
  assert.equal(reservations, 0);
});
