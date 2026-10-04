"use strict";

/**
 * Azure Table property limits (docs/XSTATE-MERGE-PLAN.md, P-02). Runs against Azurite; skipped
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
  await storage.saveSessionCheckpoint(client, {
    sessionId,
    userId: "u_limits",
    sessionSeq: 1,
    threadEvents: [{ ts: 1, phase: "detective", kind: "detective", text: "x".repeat(threadTextChars), agent: "detective" }],
    baselineCompleted: true,
    detectiveIntroSent: true,
    conversationSummaries: null,
    detectiveHistoryText: "",
    orchestrationRuntime: { v: 1, blob: "y".repeat(orchestrationChars) },
  });
  return storage.hydrateSession(client, sessionId);
}

test("checkpoint round-trips a session well under the property limit", { skip: skipAzurite }, async () => {
  const h = await roundTrip(5_000, 5_000);
  assert.equal(h.threadEvents.length, 1);
  assert.equal(h.threadEvents[0].text.length, 5_000);
  assert.equal(h.orchestrationRuntime.blob.length, 5_000);
});

test(
  "P-02: a session larger than one table property (about 32K characters) still round-trips",
  { skip: skipAzurite, todo: "P-02: values are written as single properties; Azure rejects them above about 32K characters" },
  async () => {
    const h = await roundTrip(60_000, 60_000);
    assert.equal(h.threadEvents[0].text.length, 60_000);
    assert.equal(h.orchestrationRuntime.blob.length, 60_000);
  }
);
