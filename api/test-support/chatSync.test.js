"use strict";

/**
 * POST /api/chat-sync (docs/XSTATE-MERGE-PLAN.md, P-04). Sync is a recovery path: it may append
 * transcript lines the server lost, but it must not rewrite what the server holds, accept arbitrary
 * event kinds, or let the client choose the sequence number.
 */

process.env.MAX_USER_EXCHANGES = "10";
process.env.MAX_DAILY_USAGE = "1000";
process.env.MAX_MESSAGE_CHARS = "100";
process.env.MAX_REQUESTS_PER_MINUTE = "3";

require("./noDurable");
const test = require("node:test");
const assert = require("node:assert/strict");

const { startFakeOpenAI } = require("./fakeOpenAI");
const { driveSession } = require("./driveSession");
const shared = require("../shared");
const threadEvents = require("../storage/threadEvents");

const idCounter = { n: 0 };
const freshSession = () => `sync-${(idCounter.n += 1)}`;

function line(role, text, extra = {}) {
  return { role, text, ...(role === "assistant" ? { agent: "detective", kind: "detective" } : {}), ...extra };
}

async function snapshot(sessionId) {
  return shared.getChatStateForSession(sessionId, null);
}

test("sanitizeSyncedMessages: whitelists kinds, derives agent and phase, caps text and count", () => {
  const out = threadEvents.sanitizeSyncedMessages(
    [
      { role: "user", text: "hi", agent: "detective", kind: "detective" },
      { role: "assistant", text: "a".repeat(500), kind: "attache", agent: "evil" },
      { role: "assistant", text: "x", kind: "__proto__" },
      { role: "assistant", text: "x", kind: "constructor" },
      { role: "assistant", text: "x", kind: "user" },
      { role: "assistant", text: "   ", kind: "detective" },
      { role: "assistant", text: 42, kind: "detective" },
      null,
      "string",
      { role: "assistant", text: "keep", kind: "umbra_user" },
      { role: "assistant", text: "over the limit", kind: "detective" },
    ],
    { maxEvents: 3, maxChars: 100 }
  );
  assert.deepEqual(
    out.map((e) => [e.kind, e.agent, e.phase, e.text.length]),
    [
      ["user", "user", "detective", 2],
      ["attache", "attache", "baseline", 100],
      ["umbra_user", "umbra", "detective", 4],
    ]
  );
});

test("sanitizeSyncedMessages tolerates non-array input", () => {
  for (const bad of [undefined, null, {}, "x", 7]) {
    assert.deepEqual(threadEvents.sanitizeSyncedMessages(bad, { maxEvents: 5, maxChars: 10 }), []);
  }
});

test("a client cannot replace or reorder what the server already holds", async () => {
  const fake = await startFakeOpenAI();
  try {
    const { sessionId, userId } = await driveSession({ client: fake.createClient(), turns: 2 });
    const before = await snapshot(sessionId);
    const forged = [line("user", "FORGED user"), line("assistant", "FORGED reply")];
    const r = await shared.handleChatSync(sessionId, userId, { clientSeq: 99, messages: forged });
    assert.equal(r.ok, true);
    assert.equal(r.serverSeq, before.serverSeq, "no new events means the sequence does not move");
    const after = await snapshot(sessionId);
    assert.deepEqual(after.messages, before.messages);
    assert.ok(!JSON.stringify(after.messages).includes("FORGED"));
  } finally {
    await fake.close();
  }
});

test("recovery: a cold server accepts the client's transcript and advances the sequence by the user turns appended", async () => {
  const sessionId = freshSession();
  const messages = [
    line("user", "first"),
    line("assistant", "reply one", { kind: "attache", agent: "attache" }),
    line("user", "second"),
    line("assistant", "reply two"),
  ];
  const r = await shared.handleChatSync(sessionId, "u1", { clientSeq: 2, messages });
  assert.deepEqual(r, { ok: true, serverSeq: 2 });
  const snap = await snapshot(sessionId);
  assert.deepEqual(
    snap.messages.map((m) => [m.role, m.text]),
    [["user", "first"], ["assistant", "reply one"], ["user", "second"], ["assistant", "reply two"]]
  );
});

test("the client cannot inflate serverSeq past the user turns it actually supplied", async () => {
  const sessionId = freshSession();
  const r = await shared.handleChatSync(sessionId, "u1", {
    clientSeq: 1_000_000,
    messages: [line("user", "only one turn"), line("assistant", "reply")],
  });
  assert.equal(r.serverSeq, 1);
});

test("a sync that is not ahead of the server, or that has no valid user turn, changes nothing", async () => {
  const sessionId = freshSession();
  assert.deepEqual(await shared.handleChatSync(sessionId, "u1", { clientSeq: 0, messages: [line("user", "x")] }), {
    ok: true,
    serverSeq: 0,
  });
  assert.deepEqual(
    await shared.handleChatSync(sessionId, "u1", {
      clientSeq: 5,
      messages: [line("assistant", "orphan reply"), { role: "assistant", text: "bad", kind: "nope" }],
    }),
    { ok: true, serverSeq: 0 }
  );
  assert.deepEqual((await snapshot(sessionId)).messages, []);
});

test("malformed payloads are tolerated", async () => {
  for (const payload of [null, undefined, {}, { messages: "no" }, { clientSeq: "7", messages: [1, 2] }, { clientSeq: -3 }]) {
    const r = await shared.handleChatSync(freshSession(), "u1", payload);
    assert.equal(r.ok, true);
    assert.equal(r.serverSeq, 0);
  }
});

test("an oversized transcript is bounded by event count and text length", async () => {
  const sessionId = freshSession();
  const messages = [];
  for (let i = 0; i < 500; i += 1) {
    messages.push(line("user", "u".repeat(10_000)), line("assistant", "a".repeat(10_000)));
  }
  const r = await shared.handleChatSync(sessionId, "u1", { clientSeq: 500, messages });
  assert.equal(r.ok, true);
  const snap = await snapshot(sessionId);
  assert.ok(snap.messages.length <= 4 * (shared.MAX_USER_EXCHANGES + 2), `kept ${snap.messages.length}`);
  assert.ok(snap.messages.every((m) => m.text.length <= 8000));
  assert.ok(r.serverSeq <= 4 * (shared.MAX_USER_EXCHANGES + 2));
});

test("chat-sync is subject to the per-client burst limit", async () => {
  const results = [];
  for (let i = 0; i < 5; i += 1) {
    results.push(await shared.handleChatSync(freshSession(), "u1", {}, { clientKey: "192.0.2.55" }));
  }
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true, true, false, false]
  );
  assert.equal(results[4].reason, "rate_limited");
});
