"use strict";

/**
 * The attaché session, the therapy phase and the phase-suggestion streak come back after a restart
 * from the state each log row carries, even when the orchestration blob is gone or a turn behind.
 * Runs against an in-memory table client, so no Azurite is needed.
 */

process.env.DURABLE_STORAGE_MODE = "azurite";
process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
process.env.DOSSIER_TABLE_NAME = "unitagentstate";
process.env.ENABLE_RETURN_POLICY = "0";
process.env.ENABLE_CONVERSATION_SUMMARY = "0";
process.env.SESSION_CHECKPOINT_EVERY_K_TURNS = "4";

const test = require("node:test");
const assert = require("node:assert/strict");

const storage = require("../storage/durableTableStorage");
const { startFakeOpenAI, generateFromSchema } = require("./fakeOpenAI");
const { createMemoryTableClient, freshServer } = require("./memoryTableClient");

const clone = (v) => JSON.parse(JSON.stringify(v));
const sessionRow = (table, id) => table.rows.get(`EDA_session\u0000${id}`);

function dropBlob(table, sessionId) {
  const row = sessionRow(table, sessionId);
  for (const k of Object.keys(row)) {
    if (k.startsWith("orchestrationRuntimeJson")) delete row[k];
  }
}

async function withStore(fn) {
  const table = createMemoryTableClient();
  const original = storage.getTableClient;
  storage.getTableClient = () => table;
  const fake = await startFakeOpenAI({ replyChars: 120 });
  try {
    await fn({ table, fake });
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
}

test("a session restarted in the middle of the attaché prelude gets its attaché session back", async () => {
  await withStore(async ({ table, fake }) => {
    const live = freshServer();
    const liveChat = require("../chatService");
    const { driveSession } = require("./driveSession");
    const { sessionId, userId } = await driveSession({ client: fake.createClient(), turns: 3 });
    const liveSession = clone(liveChat.getAttacheSessionForDevSession(sessionId));
    assert.equal(liveSession.attache_turn_count, 3, "still in the attaché prelude");
    assert.equal(liveSession.chat_history.length, 6);

    const blob = await storage.hydrateSession(table, sessionId);
    assert.ok(blob.orchestrationRuntime, "a checkpoint blob was written");
    assert.equal("attacheSession" in blob.orchestrationRuntime, false, "the blob holds no attaché session");
    assert.equal("detectiveChatHistory" in blob.orchestrationRuntime, false);
    assert.deepEqual(blob.agentState.attache.attache_turn_count, 3, "the newest log row has the live attaché state");
    assert.equal("chat_history" in blob.agentState.attache, false, "the transcript stays in the events");
    dropBlob(table, sessionId);

    const restarted = freshServer();
    const chat = require("../chatService");
    assert.equal(chat.getAttacheSessionForDevSession(sessionId), null);
    await restarted.hydrateSessionFromDurable(sessionId, userId);
    assert.deepEqual(chat.getAttacheSessionForDevSession(sessionId), liveSession, "same attaché session, history included");

    const next = { client: fake.createClient(), dailyUsageStore: live.createMemoryDailyUsageStore(), userId, debug: false };
    const a = await live.handleChatRequest(sessionId, "and then another thought", next);
    const b = await restarted.handleChatRequest(sessionId, "and then another thought", {
      ...next,
      dailyUsageStore: restarted.createMemoryDailyUsageStore(),
    });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const after = (c) => c.getAttacheSessionForDevSession(sessionId);
    assert.equal(after(chat).attache_turn_count, 4);
    assert.equal(after(chat).attacheState.phase, after(liveChat).attacheState.phase);
    assert.equal(after(chat).attacheState.question_index, after(liveChat).attacheState.question_index);
    assert.deepEqual(after(chat).baseline_question_order, after(liveChat).baseline_question_order);
  });
});

test("the therapy phase and the phase-suggestion streak come back, and the log row is fresher than the blob", async () => {
  await withStore(async ({ table, fake }) => {
    freshServer();
    const liveChat = require("../chatService");
    const { driveSession } = require("./driveSession");
    const { sessionId, userId } = await driveSession({ client: fake.createClient(), turns: 13 });
    const liveDetective = require("../agents/detective/detectiveExistentialSession");
    liveDetective.setExistentialTherapyPhaseForLabSession(sessionId, "middle");
    fake.configure({
      respond: (body) => {
        const schema = body.response_format && body.response_format.json_schema && body.response_format.json_schema.schema;
        if (!schema || !schema.properties || !schema.properties.suggest_existential_phase) return undefined;
        return { ...generateFromSchema(schema, { replyChars: 80, booleanOverrides: {} }), suggest_existential_phase: "final" };
      },
    });
    await driveSession({ client: fake.createClient(), turns: 1, sessionId, userId });
    const liveTherapy = clone(liveChat.exportTurnState(sessionId).therapy);
    assert.deepEqual(liveTherapy.phaseSuggestionStreak, { lastSuggested: "final", runLength: 1 });

    const stored = await storage.hydrateSession(table, sessionId);
    assert.deepEqual(stored.agentState.therapy, liveTherapy, "the newest log row carries the exact therapy state");
    assert.equal("detectiveRuntime" in (stored.orchestrationRuntime || {}), false, "the blob no longer carries therapy state");

    const restarted = freshServer();
    const chat = require("../chatService");
    await restarted.hydrateSessionFromDurable(sessionId, userId);
    assert.deepEqual(chat.exportTurnState(sessionId).therapy, liveTherapy);

    dropBlob(table, sessionId);
    const again = freshServer();
    const chat2 = require("../chatService");
    await again.hydrateSessionFromDurable(sessionId, userId);
    assert.deepEqual(chat2.exportTurnState(sessionId).therapy, liveTherapy, "and without a blob at all");
    const detective = require("../agents/detective/detectiveExistentialSession");
    assert.equal(liveDetective.getExistentialTherapyPhaseForSession(sessionId), "middle");
    assert.equal(detective.getExistentialTherapyPhaseForSession(sessionId), "middle");
  });
});

test("agent state on log rows: newest row per part wins, oversized state is left off and reported", async () => {
  const table = createMemoryTableClient();
  const sid = "state-rows";
  const ev = (text) => [{ ts: 1, phase: "baseline", kind: "user", text, agent: "user" }];
  await storage.saveThreadTurn(table, { sessionId: sid, seq: 1, events: ev("a"), state: { attache: { attacheState: { n: 1 } }, therapy: { orchestratorSnapshot: { n: 1 } } } });
  await storage.saveThreadTurn(table, { sessionId: sid, seq: 2, events: ev("b"), state: { therapy: { orchestratorSnapshot: { n: 2 } } } });
  await storage.saveThreadTurn(table, { sessionId: sid, seq: 3, events: ev("c") });
  const loaded = await storage.loadThread(table, sid);
  assert.deepEqual(loaded.agentState, { attache: { attacheState: { n: 1 } }, therapy: { orchestratorSnapshot: { n: 2 } } });

  const big = await storage.saveThreadTurn(table, { sessionId: sid, seq: 4, events: ev("d"), state: { attache: { attacheState: {}, pad: "x".repeat(50_000) } } });
  assert.deepEqual(big.degraded, ["turn_state_not_persisted"]);
  const after = await storage.loadThread(table, sid);
  assert.equal(after.events.length, 4, "the events were still written");
  assert.deepEqual(after.agentState.attache, { attacheState: { n: 1 } }, "the earlier state is kept");
});

test("exportTurnState leaves the attaché chat_history to the log, and restoreTurnState ignores state of the wrong shape", () => {
  const chat = require("../chatService");
  const id = "shape-session";
  chat.setAttacheSessionForDevSession(id, { attacheState: { phase: "baseline1" }, chat_history: [{ role: "user", content: "hi" }], attache_turn_count: 1 });
  assert.equal("chat_history" in chat.exportTurnState(id).attache, false);
  assert.equal(chat.exportTurnState(id).attache.attache_turn_count, 1, "attaché machine state is stored whenever the session exists");

  const other = "shape-other";
  assert.deepEqual(chat.restoreTurnState(other, { attache: { nope: true }, therapy: { orchestratorSnapshot: null } }, []), { attache: false, therapy: false });
  assert.equal(chat.getAttacheSessionForDevSession(other), null);
  assert.deepEqual(chat.restoreTurnState(other, null, []), { attache: false, therapy: false });
});

test("a legacy blob's attaché chat_history is ignored; the log is the transcript", () => {
  const chat = require("../chatService");
  const id = "legacy-attache-hist";
  chat.restoreSessionRuntimeFromDurable(id, {
    v: 2,
    attacheSession: {
      attacheState: { phase: "baseline1" },
      attache_turn_count: 1,
      chat_history: [
        { role: "user", content: "stale" },
        { role: "assistant", content: "stale-reply" },
      ],
    },
  });
  chat.restoreTurnState(
    id,
    {},
    [
      { kind: "user", text: "live" },
      { kind: "attache", text: "live-reply" },
    ]
  );
  const s = chat.getAttacheSessionForDevSession(id);
  assert.equal(s.attacheState.phase, "baseline1");
  assert.deepEqual(s.chat_history, [
    { role: "user", content: "live" },
    { role: "assistant", content: "live-reply" },
  ]);
  const blob = chat.exportSessionRuntimeForDurable(id);
  assert.equal("attacheSession" in blob, false);
  assert.equal("detectiveChatHistory" in blob, false);
  assert.equal("detectiveRuntime" in blob, false);
});

test("rebuildAttacheChatHistory returns the latest attaché run as user and assistant messages", () => {
  const chat = require("../chatService");
  const turn = (kind, n) => [
    { kind: "user", text: `u${n}` },
    { kind, text: `r${n}` },
  ];
  const events = [...turn("attache", 1), ...turn("attache", 2), ...turn("detective", 3), ...turn("attache", 4), ...turn("attache", 5), ...turn("detective", 6)];
  assert.deepEqual(chat.rebuildAttacheChatHistory(events), [
    { role: "user", content: "u4" },
    { role: "assistant", content: "r4" },
    { role: "user", content: "u5" },
    { role: "assistant", content: "r5" },
  ]);
  assert.deepEqual(chat.rebuildAttacheChatHistory([]), []);
  assert.deepEqual(chat.rebuildAttacheChatHistory(turn("detective", 1)), []);
});
