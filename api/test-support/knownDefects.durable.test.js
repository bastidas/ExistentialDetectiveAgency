"use strict";

/**
 * Durable-storage defects that need Azurite (docs/XSTATE-MERGE-PLAN.md, P-02). Skipped locally
 * when Azurite is not configured; required in CI. Checkpoint settings must be in the environment
 * before `shared.js` loads, hence the separate file.
 */

process.env.SESSION_CHECKPOINT_EVERY_K_TURNS = "1";

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

test(
  "P-02: a failing storage checkpoint does not fail the user's turn",
  {
    skip: skipAzurite,
    todo: "P-02: the checkpoint is awaited without a catch; long conversations exceed one table property and the request throws",
  },
  async () => {
    const fake = await startFakeOpenAI({ replyChars: 1500 });
    try {
      const { results } = await driveSession({ client: fake.createClient(), turns: 30 });
      assert.deepEqual(
        results.map((r) => r.status).filter((s) => s !== 200),
        []
      );
    } finally {
      await fake.close();
    }
  }
);
