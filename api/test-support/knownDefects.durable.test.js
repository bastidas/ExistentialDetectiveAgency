"use strict";

/**
 * Durable-storage defects that need Azurite (plans/XSTATE-MERGE-PLAN.md, P-02). Skipped locally
 * when Azurite is not configured; required in CI.
 */


const test = require("node:test");
const assert = require("node:assert/strict");

const { startFakeOpenAI } = require("./fakeOpenAI");
const { driveSession } = require("./driveSession");

const skipAzurite =
  String(process.env.DURABLE_STORAGE_MODE || "").trim().toLowerCase() !== "azurite" ||
  !String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim() ||
  !String(process.env.DOSSIER_TABLE_NAME || "").trim();

if (skipAzurite && /^(1|true)$/i.test(process.env.CI || "")) {
  test("Azurite must be configured in CI (durable defects)", () => {
    assert.fail("Azurite environment is not configured; see .github/workflows/test.yml.");
  });
}

test("P-02: 30 long-reply turns all succeed and the whole chat history reads back", { skip: skipAzurite }, async () => {
  const fake = await startFakeOpenAI({ replyChars: 1500 });
  try {
    const { sessionId, results } = await driveSession({ client: fake.createClient(), turns: 30 });
    assert.deepEqual(
      results.map((r) => r.status).filter((s) => s !== 200),
      []
    );
    const storage = require("../storage/durableTableStorage");
    const hydrated = await storage.hydrateSession(storage.getTableClient(), sessionId);
    assert.deepEqual(hydrated.problems, []);
    assert.equal(hydrated.sessionSeq, 30);
    const users = hydrated.threadEvents.filter((e) => e.kind === "user");
    assert.equal(users.length, 30, "every user message is stored");
    assert.deepEqual(users.map((e) => e.text), results.map((r) => r.message));
    assert.equal(require("../shared").getDurableHealth().degraded, false);
  } finally {
    await fake.close();
  }
});

test("P-02: the chat history is current after every turn while the full checkpoint trails by its interval", { skip: skipAzurite }, async () => {
  const fake = await startFakeOpenAI({ replyChars: 300 });
  try {
    const { sessionId, results } = await driveSession({ client: fake.createClient(), turns: 7 });
    assert.deepEqual(results.map((r) => r.status), Array(7).fill(200));
    const storage = require("../storage/durableTableStorage");
    const client = storage.getTableClient();
    const hydrated = await storage.hydrateSession(client, sessionId);
    assert.equal(hydrated.sessionSeq, 7, "history includes the latest exchange");
    assert.equal(hydrated.threadEvents.filter((e) => e.kind === "user").length, 7);
    const kinds = new Set(hydrated.threadEvents.map((e) => e.kind));
    for (const k of ["user", "detective", "lumen_user", "umbra_user"]) {
      if (k !== "detective") assert.ok(kinds.has(k), `missing ${k}`);
    }
    assert.ok(kinds.has("attache") || kinds.has("detective"));
    const row = await storage.getEntity(client, storage.PK.session, sessionId);
    assert.equal(row.sessionSeq, 6, "the full checkpoint was last written at the sixth exchange (first turn, then every fifth)");
    assert.equal(hydrated.orchestrationRuntime && hydrated.orchestrationRuntime.v, 2);
  } finally {
    await fake.close();
  }
});
