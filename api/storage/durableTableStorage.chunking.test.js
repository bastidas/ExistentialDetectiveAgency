"use strict";

/**
 * Chunked session rows (plans/XSTATE-MERGE-PLAN.md, P-02). Uses an in-memory table client that
 * enforces Azure's limits (32K UTF-16 characters per string property, 1 MiB per entity, 255
 * properties), so it runs everywhere without Azurite.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const storage = require("./durableTableStorage");

const MAX_PROPERTY = 32 * 1024;
const MAX_ENTITY_BYTES = 1024 * 1024;

function makeLimitedClient() {
  const rows = new Map();
  return {
    rows,
    async createTable() {},
    async getEntity(pk, rk) {
      const e = rows.get(`${pk}|${rk}`);
      if (!e) {
        const err = new Error("not found");
        err.statusCode = 404;
        throw err;
      }
      return JSON.parse(JSON.stringify(e));
    },
    async upsertEntity(entity) {
      const keys = Object.keys(entity);
      assert.ok(keys.length <= 252, `too many properties: ${keys.length}`);
      let bytes = 0;
      for (const k of keys) {
        const v = entity[k];
        if (typeof v === "string") {
          assert.ok(v.length <= MAX_PROPERTY, `PropertyValueTooLarge: ${k} has ${v.length} characters`);
          bytes += v.length * 2;
        }
      }
      assert.ok(bytes <= MAX_ENTITY_BYTES, `EntityTooLarge: ${bytes} bytes`);
      rows.set(`${entity.partitionKey}|${entity.rowKey}`, JSON.parse(JSON.stringify(entity)));
    },
  };
}

function checkpoint(overrides) {
  return {
    sessionId: "s1",
    userId: "u1",
    sessionSeq: 3,
    threadEvents: [{ ts: 1, phase: "detective", kind: "detective", text: "hi", agent: "detective" }],
    baselineCompleted: true,
    detectiveIntroSent: true,
    conversationSummaries: null,
    detectiveHistoryText: "",
    orchestrationRuntime: { v: 2, blob: "ok" },
    ...overrides,
  };
}

test("splitIntoChunks never cuts a surrogate pair and rejoins losslessly", () => {
  const text = "a" + "\u{1F600}".repeat(40);
  const parts = storage.splitIntoChunks(text, 7);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(p.length <= 7);
    const first = p.charCodeAt(0);
    assert.ok(!(first >= 0xdc00 && first <= 0xdfff), "chunk starts with a lone low surrogate");
    const last = p.charCodeAt(p.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), "chunk ends with a lone high surrogate");
  }
  assert.equal(parts.join(""), text);
});

test("a session far larger than one property round-trips through chunked properties", async () => {
  const client = makeLimitedClient();
  const event = { ts: 1, phase: "detective", kind: "detective", text: "x".repeat(60_000), agent: "detective" };
  const result = await storage.saveSessionCheckpoint(
    client,
    checkpoint({ threadEvents: [event], orchestrationRuntime: { v: 2, blob: "y".repeat(60_000) } })
  );
  assert.deepEqual(result.degraded, []);
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.threadEvents[0].text.length, 60_000);
  assert.equal(h.orchestrationRuntime.blob.length, 60_000);
  assert.equal(h.schemaV, storage.SESSION_SCHEMA_V);
  assert.deepEqual(h.problems, []);
});

test("a small session stays in single properties", async () => {
  const client = makeLimitedClient();
  await storage.saveSessionCheckpoint(client, checkpoint());
  const row = client.rows.get("EDA_session|s1");
  assert.equal(row.threadEventsJsonChunks, 1);
  assert.equal(row.threadEventsJson__1, undefined);
});

test("an oversized thread keeps the newest events within the entity budget and says so", async () => {
  const client = makeLimitedClient();
  const events = [];
  for (let i = 0; i < 600; i += 1) {
    events.push({ ts: i, phase: "detective", kind: "user", text: `${i}:` + "z".repeat(2000), agent: "user" });
  }
  const result = await storage.saveSessionCheckpoint(client, checkpoint({ threadEvents: events }));
  assert.ok(result.degraded.some((r) => r.startsWith("thread_oldest_")), JSON.stringify(result.degraded));
  const h = await storage.hydrateSession(client, "s1");
  assert.ok(h.threadEvents.length > 0 && h.threadEvents.length < events.length);
  assert.equal(h.threadEvents[h.threadEvents.length - 1].ts, 599, "newest event is kept");
  assert.match(client.rows.get("EDA_session|s1").degradedReason, /thread_oldest_/);
});

test("an oversized orchestration blob sheds history instead of being replaced by a truncated marker", async () => {
  const client = makeLimitedClient();
  const history = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "h".repeat(2000) + i }));
  const orch = { v: 2, detectiveChatHistory: history, lumenChatHistory: [], umbraChatHistory: [], marker: "keep" };
  const result = await storage.saveSessionCheckpoint(client, checkpoint({ orchestrationRuntime: orch }));
  assert.deepEqual(result.degraded, ["orchestration_history_trimmed"]);
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.orchestrationRuntime.truncated, undefined);
  assert.equal(h.orchestrationRuntime.marker, "keep");
  const kept = h.orchestrationRuntime.detectiveChatHistory;
  assert.ok(kept.length > 0 && kept.length < history.length);
  assert.equal(kept[kept.length - 1].content, history[history.length - 1].content, "newest history kept");
});

test("an orchestration blob that cannot be shrunk is not persisted, explicitly", async () => {
  const client = makeLimitedClient();
  const result = await storage.saveSessionCheckpoint(
    client,
    checkpoint({ orchestrationRuntime: { v: 2, huge: "q".repeat(300_000) } })
  );
  assert.deepEqual(result.degraded, ["orchestration_not_persisted"]);
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.orchestrationRuntime, null);
  assert.equal(h.threadEvents.length, 1);
});

test("rewriting a smaller session leaves no stale chunks readable", async () => {
  const client = makeLimitedClient();
  const big = { ts: 1, phase: "detective", kind: "detective", text: "x".repeat(100_000), agent: "detective" };
  await storage.saveSessionCheckpoint(client, checkpoint({ threadEvents: [big] }));
  await storage.saveSessionCheckpoint(client, checkpoint());
  const row = client.rows.get("EDA_session|s1");
  assert.equal(row.threadEventsJson__1, undefined);
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.threadEvents.length, 1);
  assert.equal(h.threadEvents[0].text, "hi");
});

test("a row written before chunking (single property, no schemaV) still hydrates", async () => {
  const client = makeLimitedClient();
  client.rows.set("EDA_session|old", {
    partitionKey: "EDA_session",
    rowKey: "old",
    updatedAt: "2026-01-01T00:00:00.000Z",
    userId: "u_old",
    sessionSeq: 4,
    threadEventsJson: JSON.stringify([{ ts: 1, phase: "baseline", kind: "user", text: "legacy" }]),
    orchestrationRuntimeJson: JSON.stringify({ v: 1 }),
  });
  const h = await storage.hydrateSession(client, "old");
  assert.equal(h.threadEvents[0].text, "legacy");
  assert.equal(h.schemaV, null);
  assert.equal(h.orchestrationRuntime.v, 1);
});

test("a row with a missing chunk is reported, not thrown or half-read", async () => {
  const client = makeLimitedClient();
  const big = { ts: 1, phase: "detective", kind: "detective", text: "x".repeat(100_000), agent: "detective" };
  await storage.saveSessionCheckpoint(client, checkpoint({ threadEvents: [big] }));
  delete client.rows.get("EDA_session|s1").threadEventsJson__2;
  const h = await storage.hydrateSession(client, "s1");
  assert.deepEqual(h.threadEvents, []);
  assert.deepEqual(h.problems, ["threadEventsJson_missing_chunk"]);
});

test("a large dossier is chunked and read back whole", async () => {
  const client = makeLimitedClient();
  const dossier = { notes: "d".repeat(90_000) };
  await storage.saveDossierByUserId(client, "u1", dossier);
  const row = await storage.getDossierByUserId(client, "u1");
  assert.equal(JSON.parse(row.dossierJson).notes.length, 90_000);
});
