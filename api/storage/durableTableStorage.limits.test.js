"use strict";

/**
 * Azure Table property limits (plans/XSTATE-MERGE-PLAN.md, P-02). Runs against Azurite; skipped
 * locally when it is not configured, required in CI.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const skipAzurite =
  String(process.env.DURABLE_STORAGE_MODE || "").trim().toLowerCase() !== "azurite" ||
  !String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim() ||
  !String(process.env.DOSSIER_TABLE_NAME || "").trim();

if (skipAzurite && /^(1|true)$/i.test(process.env.CI || "")) {
  test("Azurite must be configured in CI (limits)", () => {
    assert.fail("Azurite environment is not configured; see .github/workflows/test.yml.");
  });
}

function newSessionId() {
  return `limits_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function roundTrip(threadTextChars, orchestrationChars) {
  const storage = require("./durableTableStorage");
  const client = storage.getTableClient();
  assert.ok(client, "TableClient required");
  const sessionId = newSessionId();
  await storage.saveThreadTurn(client, {
    sessionId,
    userId: "u_limits",
    seq: 1,
    events: [{ ts: 1, phase: "detective", kind: "detective", text: "x".repeat(threadTextChars), agent: "detective" }],
  });
  await storage.saveSessionCheckpoint(client, {
    sessionId,
    userId: "u_limits",
    sessionSeq: 1,
    baselineCompleted: true,
    detectiveIntroSent: true,
    conversationSummary: null,
    detectiveHistoryText: "",
    orchestrationRuntime: { v: 2, blob: "y".repeat(orchestrationChars) },
  });
  return storage.hydrateSession(client, sessionId);
}

test("checkpoint round-trips a session well under the property limit", { skip: skipAzurite }, async () => {
  const h = await roundTrip(5_000, 5_000);
  assert.equal(h.threadEvents.length, 1);
  assert.equal(h.threadEvents[0].text.length, 5_000);
  assert.equal(h.orchestrationRuntime.blob.length, 5_000);
});

test("P-02: a session larger than one table property (about 32K characters) round-trips", { skip: skipAzurite }, async () => {
  const h = await roundTrip(60_000, 60_000);
  assert.equal(h.threadEvents[0].text.length, 60_000);
  assert.equal(h.orchestrationRuntime.blob.length, 60_000);
});

test("P-02: a long thread is one small row per exchange, so no row nears the entity limit", { skip: skipAzurite }, async () => {
  const storage = require("./durableTableStorage");
  const client = storage.getTableClient();
  const sessionId = newSessionId();
  for (let seq = 1; seq <= 40; seq += 1) {
    await storage.saveThreadTurn(client, {
      sessionId,
      userId: "u_limits",
      seq,
      events: [
        { ts: seq, phase: "detective", kind: "user", text: "z".repeat(10_000), agent: "user" },
        { ts: seq, phase: "detective", kind: "detective", text: "d".repeat(3_000), agent: "detective" },
      ],
    });
  }
  const h = await storage.hydrateSession(client, sessionId);
  assert.equal(h.sessionSeq, 40);
  assert.equal(h.threadEvents.length, 80);
  assert.equal(h.threadEvents[h.threadEvents.length - 1].ts, 40);
});

test("P-02: an orchestration blob near the entity budget is saved, not rejected as EntityTooLarge", { skip: skipAzurite }, async () => {
  const storage = require("./durableTableStorage");
  const client = storage.getTableClient();
  const sessionId = newSessionId();
  const result = await storage.saveSessionCheckpoint(client, {
    sessionId,
    userId: "u_limits",
    sessionSeq: 1,
    baselineCompleted: true,
    detectiveIntroSent: true,
    conversationSummary: null,
    detectiveHistoryText: "",
    orchestrationRuntime: { v: 2, padding: "y".repeat(280_000), marker: "keep" },
  });
  assert.deepEqual(result.degraded, []);
  const h = await storage.hydrateSession(client, sessionId);
  assert.equal(h.orchestrationRuntime.marker, "keep");
});
