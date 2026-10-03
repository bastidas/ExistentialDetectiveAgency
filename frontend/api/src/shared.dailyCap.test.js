"use strict";

process.env.MAX_DAILY_USAGE = "2";
process.env.MAX_USER_EXCHANGES = "100";
delete process.env.OFFLINE;

const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("./shared");
const { createStubOpenAiClient } = require("./testLlmStub");

function opts(client, store) {
  return { openaiClient: client, dailyUsageStore: store, debug: false };
}

test("daily cap: turns reach the LLM until the cap, then 429 with no LLM call", async () => {
  assert.equal(shared.MAX_DAILY_USAGE, 2);
  const client = createStubOpenAiClient();
  const store = shared.createMemoryDailyUsageStore();

  const r1 = await shared.handleChatRequest("cap-a", "hello", opts(client, store));
  assert.equal(r1.status, 200);
  assert.equal(store.readDailyUsage(), 1);
  const r2 = await shared.handleChatRequest("cap-a", "again", opts(client, store));
  assert.equal(r2.status, 200);
  assert.equal(store.readDailyUsage(), 2);

  const callsBefore = client.calls;
  assert.ok(callsBefore > 0, "stub should have been called by allowed turns");

  const r3 = await shared.handleChatRequest("cap-a", "over the cap", opts(client, store));
  assert.equal(r3.status, 429);
  assert.equal(r3.body.errorKind, "rate_limit");
  assert.match(r3.body.error, /Daily system limit reached/);
  assert.equal(client.calls, callsBefore, "no LLM call once the daily cap is hit");
  assert.equal(store.readDailyUsage(), 2, "refused turn does not consume budget");
});

test("daily cap is global across sessions", async () => {
  const client = createStubOpenAiClient();
  const store = shared.createMemoryDailyUsageStore();
  await shared.handleChatRequest("cap-b1", "hi", opts(client, store));
  await shared.handleChatRequest("cap-b2", "hi", opts(client, store));
  const r = await shared.handleChatRequest("cap-b3", "hi", opts(client, store));
  assert.equal(r.status, 429);
});

test("a refused turn does not advance session counters", async () => {
  const client = createStubOpenAiClient();
  const store = shared.createMemoryDailyUsageStore();
  store.incrementDailyUsage();
  store.incrementDailyUsage();
  const r = await shared.handleChatRequest("cap-c", "hi", opts(client, store));
  assert.equal(r.status, 429);
  assert.equal(shared.userExchangeCounts.get("cap-c") ?? 0, 0);
});

test("without an LLM client (offline/mock) the daily budget is not consumed", async () => {
  const store = shared.createMemoryDailyUsageStore();
  for (let i = 0; i < 4; i += 1) {
    const r = await shared.handleChatRequest("cap-d", `m${i}`, opts(null, store));
    assert.equal(r.status, 200);
  }
  assert.equal(store.readDailyUsage(), 0);
});
