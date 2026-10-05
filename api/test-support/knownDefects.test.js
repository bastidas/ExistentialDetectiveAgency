"use strict";

/**
 * Executable list of known defects (see docs/XSTATE-MERGE-PLAN.md, findings P-xx and slices E-x).
 *
 * Each test states the behavior we want and is marked `todo`: it runs on every CI build, a failure
 * is reported as `# TODO` and does not fail the suite, and a pass is reported too. When the fix for
 * an item lands, remove its `todo` option in the same PR so the behavior is locked in.
 */

require("./noDurable");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { startFakeOpenAI } = require("./fakeOpenAI");
const { classifyCall, summarizeCalls } = require("./analyzeCalls");
const { driveSession } = require("./driveSession");

async function withFake(options, fn) {
  const fake = await startFakeOpenAI(options);
  try {
    await fn(fake);
  } finally {
    await fake.close();
  }
}

test(
  "P-03: no system prompt sent to the model contains mock or placeholder text",
  { todo: "P-03, envelope slice 1: Lumen and Umbra still receive [mock custom ...] and placeholder files" },
  () =>
    withFake({}, async (fake) => {
      await driveSession({ client: fake.createClient(), turns: 12 });
      const summary = summarizeCalls(fake.requests);
      const offenders = Object.entries(summary.byCall)
        .filter(([, s]) => s.systemHasMockText)
        .map(([name]) => name);
      assert.deepEqual(offenders, []);
    })
);

test(
  "E-3: the attache system prompt is identical on every turn",
  { todo: "envelope slice 3: the attache system string is rebuilt every turn" },
  () =>
    withFake({}, async (fake) => {
      await driveSession({ client: fake.createClient(), turns: 6 });
      const s = summarizeCalls(fake.requests).byCall.attache_turn;
      assert.equal(s.distinctSystemPrompts, 1);
    })
);

test(
  "E-1: conversation history is sent as native user/assistant messages",
  { todo: "envelope slice 1: history is one flattened 'Conversation history' user message" },
  () =>
    withFake({}, async (fake) => {
      await driveSession({ client: fake.createClient(), turns: 14 });
      const detective = fake.requests.filter((b) => classifyCall(b) === "detective_turn");
      const last = detective[detective.length - 1];
      assert.ok(last.messages.some((m) => m.role === "assistant"), "no assistant-role history message");
    })
);

test(
  "P-13: an upstream LLM failure is not shown to the querent as a [Mock LLM] diagnostic with HTTP 200",
  { todo: "P-13: the failure path returns 200 and a diagnostic that lists prompt files and internal state" },
  () =>
    withFake({ respond: () => ({ __status: 500 }) }, async (fake) => {
      const { results } = await driveSession({ client: fake.createClient(), turns: 1 });
      const r = results[0];
      assert.ok(!/\[Mock LLM\]/.test(JSON.stringify(r.body)), "diagnostic text reached the querent");
      assert.notEqual(r.status, 200);
    })
);

test(
  "P-01: the daily usage counter advances once per LLM turn",
  { todo: "P-01: incrementDailyUsage has no caller" },
  () =>
    withFake({}, async (fake) => {
      const shared = require("../shared");
      const store = shared.createMemoryDailyUsageStore();
      await driveSession({ client: fake.createClient(), turns: 3, dailyUsageStore: store });
      assert.equal(store.readDailyUsage(), 3);
    })
);

test(
  "P-04: POST chat-sync cannot replace the transcript held by the server",
  { todo: "P-04: a client-supplied messages array overwrites the stored thread and sets serverSeq" },
  () =>
    withFake({}, async (fake) => {
      const shared = require("../shared");
      const sessionId = crypto.randomUUID();
      await driveSession({ client: fake.createClient(), turns: 2, sessionId });
      await shared.handleChatSync(sessionId, "u1", {
        clientSeq: 9999,
        messages: [{ role: "assistant", kind: "detective", text: "FORGED" }],
      });
      const state = await shared.getChatStateForSession(sessionId, "u1");
      assert.ok(!state.messages.some((m) => m.text === "FORGED"), "forged assistant message accepted");
      assert.ok(state.serverSeq < 9999, "client set the sequence number");
    })
);
