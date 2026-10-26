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
    conversationSummary: null,
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

test("an oversized blob is dropped without touching the detective transcript column", async () => {
  const client = makeLimitedClient();
  const transcript = Array.from({ length: 40 }, (_, i) => `${i % 2 ? "assistant" : "user"}\t${JSON.stringify("h".repeat(500) + i)}`).join("\n");
  const orch = { v: 2, marker: "keep", padding: "p".repeat(390_000) };
  const result = await storage.saveSessionCheckpoint(client, checkpoint({ orchestrationRuntime: orch, detectiveHistoryText: transcript }));
  assert.deepEqual(result.degraded, ["orchestration_not_persisted"]);
  const h = await storage.hydrateSession(client, "s1");
  assert.equal(h.orchestrationRuntime, null);
  assert.equal(h.detectiveHistoryText, transcript, "the transcript has its own column and is unaffected");
});

test("the detective transcript column keeps the newest whole lines when over its cap", async () => {
  const client = makeLimitedClient();
  const lines = Array.from({ length: 200 }, (_, i) => `user\t${JSON.stringify(String(i).padStart(4, "0") + "x".repeat(996))}`);
  const written = await storage.saveSessionCheckpoint(client, checkpoint({ detectiveHistoryText: lines.join("\n") }));
  assert.deepEqual(written.degraded, ["detective_text_truncated"]);
  const h = await storage.hydrateSession(client, "s1");
  assert.ok(h.detectiveHistoryText.length <= 60_000);
  const kept = h.detectiveHistoryText.split("\n");
  assert.equal(kept[kept.length - 1], lines[lines.length - 1], "newest line kept");
  assert.deepEqual(kept, lines.slice(-kept.length), "no line is cut in half");
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

test("every checkpoint column round-trips through hydrate, including a transcript past one property", async () => {
  const { renderDetectiveHistoryText, parseDetectiveHistoryText } = require("./detectiveHistoryText");
  const { SUMMARY_SCHEMA_V } = require("../dossier/conversationSummary");
  const client = makeLimitedClient();
  const history = [];
  for (let i = 0; i < 400; i += 1) {
    history.push({ role: i % 2 ? "assistant" : "user", content: `line ${i}\nwith a newline\tand a tab ` + "w".repeat(100) });
  }
  const text = renderDetectiveHistoryText(history);
  assert.ok(text.length > 40_000, "the transcript spans more than one chunk");
  const record = {
    v: SUMMARY_SCHEMA_V,
    userId: "u1",
    sessionId: "s1",
    fromSeq: 1,
    throughSeq: 9,
    text: "the querent keeps circling a stalled career",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const result = await storage.saveSessionCheckpoint(
    client,
    checkpoint({ detectiveHistoryText: text, conversationSummary: record })
  );
  assert.deepEqual(result.degraded, []);
  const row = client.rows.get("EDA_session|s1");
  assert.ok(row.detectiveHistoryTextChunks > 1);

  const hydrated = await storage.hydrateSession(client, "s1");
  assert.equal(hydrated.baselineCompleted, true);
  assert.equal(hydrated.detectiveIntroSent, true);
  assert.deepEqual(hydrated.degraded, []);
  assert.deepEqual(hydrated.conversationSummary, record);
  const restored = parseDetectiveHistoryText(hydrated.detectiveHistoryText);
  assert.ok(restored.length >= 100);
  assert.deepEqual(restored, history.slice(-restored.length));
});

test("degraded reasons come back as a list, and an empty summary column reads as no summary", async () => {
  const client = makeLimitedClient();
  const big = { v: 2, padding: "y".repeat(390_000) };
  const written = await storage.saveSessionCheckpoint(client, checkpoint({ orchestrationRuntime: big, detectiveHistoryText: "z".repeat(50_000) }));
  assert.deepEqual(written.degraded, ["orchestration_not_persisted"]);
  const hydrated = await storage.hydrateSession(client, "s1");
  assert.deepEqual(hydrated.degraded, written.degraded);
  assert.equal(client.rows.get("EDA_session|s1").degradedReason, written.degraded.join(";"));
  assert.equal(hydrated.conversationSummary, null);
  assert.equal(client.rows.get("EDA_session|s1").conversationSummariesJson, "null");
});

test("the per-user summary row round-trips and ignores rows in another layout", async () => {
  const { SUMMARY_SCHEMA_V } = require("../dossier/conversationSummary");
  const client = makeLimitedClient();
  assert.equal(await storage.getUserSummary(client, "u9"), null);
  const record = {
    v: SUMMARY_SCHEMA_V,
    userId: "u9",
    sessionId: "old-session",
    fromSeq: 1,
    throughSeq: 4,
    text: "summary text ".repeat(2_500),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  await storage.saveUserSummary(client, "u9", { ...record, text: record.text.slice(0, 6_000) });
  assert.equal((await storage.getUserSummary(client, "u9")).sessionId, "old-session");
  await client.upsertEntity({ partitionKey: "EDA_userSummary", rowKey: "u8", summaryJson: JSON.stringify({ v: 99, text: "x" }) });
  assert.equal(await storage.getUserSummary(client, "u8"), null);
});
