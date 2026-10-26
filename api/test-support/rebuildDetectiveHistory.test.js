"use strict";

/**
 * Detective history is the log: mock, fallback and empty replies that reached the querent are
 * appended live and come back on hydrate. No Azurite.
 */

process.env.DURABLE_STORAGE_MODE = "azurite";
process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
process.env.DOSSIER_TABLE_NAME = "unitdetlog";
process.env.ENABLE_RETURN_POLICY = "0";
process.env.ENABLE_CONVERSATION_SUMMARY = "0";

const test = require("node:test");
const assert = require("node:assert/strict");

const storage = require("../storage/durableTableStorage");
const { startFakeOpenAI, generateFromSchema } = require("./fakeOpenAI");
const { createMemoryTableClient, freshServer } = require("./memoryTableClient");
const { buildTurnEvents } = require("../storage/threadEvents");

const clone = (v) => JSON.parse(JSON.stringify(v));

async function withStore(fn) {
  const table = createMemoryTableClient();
  const original = storage.getTableClient;
  storage.getTableClient = () => table;
  const fake = await startFakeOpenAI({ replyChars: 80 });
  try {
    await fn({ table, fake });
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
}

test("rebuildDetectiveHistory pairs querent and detective lines after the last attaché run, including empty replies", () => {
  const chat = require("../chatService");
  const ev = (kind, text, phase) => ({ kind, text, phase: phase || (kind === "attache" ? "baseline" : "detective") });
  assert.deepEqual(
    chat.rebuildDetectiveHistory([
      ev("user", "b", "baseline"),
      ev("attache", "ok", "baseline"),
      ev("user", "q1"),
      ev("detective", "a1"),
      ev("lumen_user", "l1"),
      ev("user", "q2"),
      ev("detective", ""),
      ev("user", "q3"),
    ]),
    [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "" },
    ]
  );
  assert.deepEqual(chat.rebuildDetectiveHistory([]), []);
});

test("buildTurnEvents keeps an empty detective reply so the log can rebuild it", () => {
  const events = buildTurnEvents({
    phase: "detective",
    userMessage: "q",
    reply: "",
    lumenUserResponse: "",
    umbraUserResponse: "",
  });
  assert.ok(events.some((e) => e.kind === "detective" && e.text === ""));
  assert.equal(events.find((e) => e.kind === "user").text, "q");
});

test("a mock detective reply is in the live history and comes back after hydrate", async () => {
  await withStore(async ({ fake }) => {
    const shared = freshServer();
    const chat = require("../chatService");
    const sessionId = "mock-det-restart";
    const userId = "u-mock-det";
    chat.restoreSessionFromRowColumns(sessionId, { baselineCompleted: true });
    const r = await shared.handleChatRequest(sessionId, "I feel stuck about my work", {
      openaiClient: null,
      dailyUsageStore: shared.createMemoryDailyUsageStore(),
      userId,
      debug: false,
    });
    assert.equal(r.status, 200);
    const live = clone(chat.peekDetectiveHistory(sessionId));
    assert.equal(live.length, 2);
    assert.equal(live[0].content, "I feel stuck about my work");
    assert.ok(live[1].content.length > 0, "the mock stand-in reached history");

    const restarted = freshServer();
    const again = require("../chatService");
    await restarted.hydrateSessionFromDurable(sessionId, userId);
    assert.deepEqual(again.peekDetectiveHistory(sessionId), live);
    void fake;
  });
});

test("a fallback detective reply (empty model output) survives restart", async () => {
  await withStore(async ({ fake }) => {
    const shared = freshServer();
    const chat = require("../chatService");
    const sessionId = "fallback-det-restart";
    const userId = "u-fallback-det";
    chat.restoreSessionFromRowColumns(sessionId, { baselineCompleted: true });
    fake.configure({
      respond: (body) => {
        const schema = body.response_format && body.response_format.json_schema && body.response_format.json_schema.schema;
        if (!schema || !schema.properties || !schema.properties.detective_response) return undefined;
        return {
          ...generateFromSchema(schema, { replyChars: 40, booleanOverrides: {} }),
          detective_response: "",
        };
      },
    });
    const r = await shared.handleChatRequest(sessionId, "tell me what you see", {
      openaiClient: fake.createClient(),
      dailyUsageStore: shared.createMemoryDailyUsageStore(),
      userId,
      debug: false,
    });
    assert.equal(r.status, 200);
    const live = clone(chat.peekDetectiveHistory(sessionId));
    assert.equal(live.length, 2);
    assert.equal(live[0].content, "tell me what you see");
    assert.ok(live[1].content.length > 0, "the fallback stand-in reached history");
    assert.notEqual(live[1].content, "", "fallback is not the empty model string");

    const restarted = freshServer();
    const again = require("../chatService");
    await restarted.hydrateSessionFromDurable(sessionId, userId);
    assert.deepEqual(again.peekDetectiveHistory(sessionId), live);
  });
});

test("an empty detective reply is logged and comes back after hydrate", async () => {
  await withStore(async ({ table }) => {
    const sessionId = "empty-det-restart";
    const userId = "u-empty-det";
    await storage.saveSessionCheckpoint(table, {
      sessionId,
      userId,
      sessionSeq: 1,
      baselineCompleted: true,
      detectiveIntroSent: true,
      conversationSummary: null,
      detectiveHistoryText: "",
      orchestrationRuntime: { v: 2 },
    });
    await storage.saveThreadTurn(table, {
      sessionId,
      userId,
      seq: 1,
      events: [
        { ts: 1, phase: "detective", kind: "user", text: "quiet turn", agent: "user" },
        { ts: 1, phase: "detective", kind: "detective", text: "", agent: "detective" },
      ],
    });

    const restarted = freshServer();
    const chat = require("../chatService");
    await restarted.hydrateSessionFromDurable(sessionId, userId);
    assert.deepEqual(chat.peekDetectiveHistory(sessionId), [
      { role: "user", content: "quiet turn" },
      { role: "assistant", content: "" },
    ]);
  });
});
