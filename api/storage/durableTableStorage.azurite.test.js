"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const skipAzurite =
  String(process.env.DURABLE_STORAGE_MODE || "").trim().toLowerCase() !== "azurite" ||
  !String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim() ||
  !String(process.env.DOSSIER_TABLE_NAME || "").trim();

// A silently skipped storage test is a green build that proves nothing: fail in CI instead.
if (skipAzurite && /^(1|true)$/i.test(process.env.CI || "")) {
  test("Azurite must be configured in CI", () => {
    assert.fail(
      "Set DURABLE_STORAGE_MODE=azurite, AZURE_STORAGE_CONNECTION_STRING and DOSSIER_TABLE_NAME (see .github/workflows/test.yml)."
    );
  });
}

test(
  "durable Table round-trip (Azurite): session + orchestration JSON",
  { skip: skipAzurite },
  async () => {
    require("dotenv").config({ path: path.join(__dirname, "..", "..", "..", ".env") });
    if (
      String(process.env.DURABLE_STORAGE_MODE || "").trim().toLowerCase() !== "azurite" ||
      !String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim() ||
      !String(process.env.DOSSIER_TABLE_NAME || "").trim()
    ) {
      return;
    }
    const durableTableStorage = require("./durableTableStorage");
    const client = durableTableStorage.getTableClient();
    assert.ok(client, "TableClient required (AZURE_STORAGE_CONNECTION_STRING + DOSSIER_TABLE_NAME)");
    const sid = `test_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orch = { v: 1, chatMachineSnapshot: null, truncated: false };
    await durableTableStorage.saveSessionCheckpoint(client, {
      sessionId: sid,
      userId: "u_test",
      sessionSeq: 3,
      threadEvents: [{ ts: 1, phase: "detective", kind: "user", text: "hi", agent: "user" }],
      baselineCompleted: true,
      detectiveIntroSent: true,
      conversationSummaries: null,
      detectiveHistoryText: "",
      orchestrationRuntime: orch,
    });
    const hydrated = await durableTableStorage.hydrateSession(client, sid);
    assert.equal(hydrated.sessionSeq, 3);
    assert.equal(hydrated.userId, "u_test");
    assert.ok(hydrated.orchestrationRuntime && hydrated.orchestrationRuntime.v === 1);
    assert.ok(Array.isArray(hydrated.threadEvents) && hydrated.threadEvents.length === 1);
  }
);
