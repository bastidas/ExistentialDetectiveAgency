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
    listEntities(opts) {
      const filter = String((opts && opts.queryOptions && opts.queryOptions.filter) || "");
      const m = /PartitionKey eq '(.*)'$/.exec(filter);
      assert.ok(m, `unsupported filter: ${filter}`);
      const pk = m[1].replace(/''/g, "'");
      const matches = [...rows.values()].filter((e) => e.partitionKey === pk).map((e) => JSON.parse(JSON.stringify(e)));
      return (async function* () {
        for (const e of matches) yield e;
      })();
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

function ev(kind, text, extra) {
  return { ts: 1, phase: "detective", kind, text, agent: kind, ...extra };
}

function exchange(seq, textChars) {
  return [
    ev("user", `u${seq}:` + "m".repeat(textChars)),
    ev("detective", `d${seq}`),
    ev("lumen_user", `l${seq}`),
    ev("umbra_user", `x${seq}`),
  ];
}

test("an exchange row holds the user message and every agent reply, and little else", async () => {
  const client = makeLimitedClient();
  const events = [
    ev("user", "hello"),
    ev("attache", "welcome"),
    ev("lumen_user", "lumen says"),
    ev("umbra_user", "umbra says"),
  ];
  const result = await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq: 1, events });
  assert.deepEqual(result.degraded, []);
  const [key, row] = [...client.rows.entries()][0];
  assert.equal(key, "EDA_thread_s1|00000001");
  assert.deepEqual(
    Object.keys(row).sort(),
    ["eventsJson", "eventsJsonChunks", "partitionKey", "rowKey", "schemaV", "ts", "userId"].sort()
  );
  assert.deepEqual(JSON.parse(row.eventsJson).map((e) => e.kind), ["user", "attache", "lumen_user", "umbra_user"]);
});

test("exchanges read back in order across rows, and sessions never mix", async () => {
  const client = makeLimitedClient();
  for (let seq = 1; seq <= 12; seq += 1) {
    await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq, events: exchange(seq, 10) });
  }
  await storage.saveThreadTurn(client, { sessionId: "s2", userId: "u2", seq: 1, events: exchange(99, 10) });
  const t = await storage.loadThread(client, "s1");
  assert.equal(t.rows, 12);
  assert.equal(t.lastSeq, 12);
  assert.equal(t.userId, "u1");
  assert.deepEqual(t.events.filter((e) => e.kind === "user").map((e) => e.text.split(":")[0]), Array.from({ length: 12 }, (_, i) => `u${i + 1}`));
  assert.ok(t.events.every((e) => !String(e.text).startsWith("u99")));
});

test("writing the same exchange twice is idempotent", async () => {
  const client = makeLimitedClient();
  await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq: 1, events: exchange(1, 5) });
  await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq: 1, events: exchange(1, 5) });
  const t = await storage.loadThread(client, "s1");
  assert.equal(t.rows, 1);
  assert.equal(t.events.length, 4);
});

test("an exchange larger than one property round-trips through chunked properties", async () => {
  const client = makeLimitedClient();
  await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq: 1, events: exchange(1, 60_000) });
  const t = await storage.loadThread(client, "s1");
  assert.equal(t.events[0].text.length, 60_000 + 3);
  assert.deepEqual(t.problems, []);
});

test("a session id with partition-key-hostile characters is encoded, not rejected", async () => {
  const client = makeLimitedClient();
  const sid = "a/b#c?d\\e";
  await storage.saveThreadTurn(client, { sessionId: sid, userId: "u", seq: 1, events: exchange(1, 3) });
  const [key] = [...client.rows.keys()];
  assert.ok(!/[\/\\#?]/.test(key.split("|")[0]), key);
  assert.equal((await storage.loadThread(client, sid)).rows, 1);
});

test("hydrate rebuilds a session from exchange rows alone, before any full checkpoint exists", async () => {
  const client = makeLimitedClient();
  for (let seq = 1; seq <= 3; seq += 1) {
    await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq, events: exchange(seq, 5) });
  }
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.sessionSeq, 3);
  assert.equal(h.userId, "u1");
  assert.equal(h.threadEvents.length, 12);
  assert.equal(h.orchestrationRuntime, null);
});

test("hydrate uses the exchange rows for history and the checkpoint for orchestration, which may lag", async () => {
  const client = makeLimitedClient();
  await storage.saveSessionCheckpoint(client, checkpoint({ sessionSeq: 2, orchestrationRuntime: { v: 2, turns: 2 } }));
  for (let seq = 1; seq <= 5; seq += 1) {
    await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq, events: exchange(seq, 5) });
  }
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.sessionSeq, 5, "history is ahead of the checkpoint");
  assert.equal(h.orchestrationRuntime.turns, 2);
  assert.equal(h.threadEvents.filter((e) => e.kind === "user").length, 5);
});

test("the full checkpoint does not write the chat history", async () => {
  const client = makeLimitedClient();
  await storage.saveSessionCheckpoint(client, checkpoint());
  const row = client.rows.get("EDA_session|s1");
  assert.equal(row.threadEventsJson, undefined);
  assert.equal(row.threadEventsJsonChunks, undefined);
});

test("an oversized exchange keeps its newest events within the entity budget and says so", async () => {
  const client = makeLimitedClient();
  const events = [];
  for (let i = 0; i < 300; i += 1) events.push(ev("user", `${i}:` + "z".repeat(2000)));
  const result = await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq: 1, events });
  assert.ok(result.degraded.some((r) => r.startsWith("turn_oldest_")), JSON.stringify(result.degraded));
  const t = await storage.loadThread(client, "s1");
  assert.ok(t.events.length > 0 && t.events.length < events.length);
  assert.equal(t.events[t.events.length - 1].text.startsWith("299:"), true, "newest event is kept");
});

test("a small checkpoint stays in single properties", async () => {
  const client = makeLimitedClient();
  await storage.saveSessionCheckpoint(client, checkpoint());
  const row = client.rows.get("EDA_session|s1");
  assert.equal(row.orchestrationRuntimeJsonChunks, 1);
  assert.equal(row.orchestrationRuntimeJson__1, undefined);
});

test("an oversized orchestration blob sheds history instead of being replaced by a truncated marker", async () => {
  const client = makeLimitedClient();
  const history = Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "h".repeat(2000) + i }));
  const orch = { v: 2, detectiveChatHistory: history, marker: "keep" };
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
    checkpoint({ orchestrationRuntime: { v: 2, huge: "q".repeat(390_000) } })
  );
  assert.deepEqual(result.degraded, ["orchestration_not_persisted"]);
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.orchestrationRuntime, null);
});

test("rewriting a smaller checkpoint leaves no stale chunks readable", async () => {
  const client = makeLimitedClient();
  await storage.saveSessionCheckpoint(client, checkpoint({ orchestrationRuntime: { v: 2, blob: "x".repeat(100_000) } }));
  await storage.saveSessionCheckpoint(client, checkpoint());
  const row = client.rows.get("EDA_session|s1");
  assert.equal(row.orchestrationRuntimeJson__1, undefined);
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.orchestrationRuntime.blob, "ok");
});

test("a session row written before exchange rows (history inside the row) still hydrates", async () => {
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

test("an exchange row with a missing chunk is reported, not thrown or half-read", async () => {
  const client = makeLimitedClient();
  await storage.saveThreadTurn(client, { sessionId: "s1", userId: "u1", seq: 1, events: exchange(1, 100_000) });
  delete client.rows.get("EDA_thread_s1|00000001").eventsJson__2;
  const t = await storage.loadThread(client, "s1");
  assert.deepEqual(t.events, []);
  assert.deepEqual(t.problems, ["eventsJson_missing_chunk"]);
});

test("a large dossier is chunked and read back whole", async () => {
  const client = makeLimitedClient();
  const dossier = { notes: "d".repeat(90_000) };
  await storage.saveDossierByUserId(client, "u1", dossier);
  const row = await storage.getDossierByUserId(client, "u1");
  assert.equal(JSON.parse(row.dossierJson).notes.length, 90_000);
});
