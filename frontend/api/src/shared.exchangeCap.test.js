"use strict";

process.env.MAX_USER_EXCHANGES = "3";
process.env.MAX_DAILY_USAGE = "1000";
delete process.env.OFFLINE;

const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("./shared");
const { seedSessionScenario } = require("./chatTestSeed");
const { createStubOpenAiClient } = require("./testLlmStub");

test("exchange cap: closure replies, then 204 with no LLM call and no daily budget used", async () => {
  assert.equal(shared.MAX_USER_EXCHANGES, 3);
  const sid = "exchange-cap-session";
  seedSessionScenario(sid, { activeAgent: "detective", hasDossier: true });

  const client = createStubOpenAiClient();
  const store = shared.createMemoryDailyUsageStore();
  const o = { openaiClient: client, dailyUsageStore: store, debug: false };

  const bodies = [];
  for (let i = 1; i <= 3; i += 1) {
    const r = await shared.handleChatRequest(sid, `turn ${i}`, o);
    assert.equal(r.status, 200, `turn ${i}`);
    bodies.push(r.body);
  }
  assert.equal(bodies[0].closureUltimate, undefined);
  assert.equal(bodies[1].closureUltimate, undefined);
  assert.equal(bodies[2].closureUltimate, undefined);

  const ultimate = await shared.handleChatRequest(sid, "turn 4", o);
  assert.equal(ultimate.status, 200);
  assert.equal(ultimate.body.closureUltimate, true);

  const callsAfterUltimate = client.calls;
  const usageAfterUltimate = store.readDailyUsage();
  assert.equal(usageAfterUltimate, 4);

  const closed = await shared.handleChatRequest(sid, "turn 5", o);
  assert.equal(closed.status, 204);
  assert.equal(client.calls, callsAfterUltimate, "closed session never reaches the LLM");
  assert.equal(store.readDailyUsage(), usageAfterUltimate, "closed session does not consume budget");
});
