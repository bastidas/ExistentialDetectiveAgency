"use strict";

/**
 * Durable storage failures are non-fatal (plans/XSTATE-MERGE-PLAN.md, P-02). Storage calls are
 * replaced with stubs, so this needs no Azurite. The durable settings must be in the environment
 * before `shared.js` loads.
 */

process.env.DURABLE_STORAGE_MODE = "azurite";
process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
process.env.DOSSIER_TABLE_NAME = "unitdegraded";
process.env.SESSION_CHECKPOINT_EVERY_K_TURNS = "1";

const test = require("node:test");
const assert = require("node:assert/strict");

const storage = require("../storage/durableTableStorage");
const { startFakeOpenAI } = require("./fakeOpenAI");
const { driveSession } = require("./driveSession");

function stubStorage(overrides) {
  const originals = {};
  const stubs = {
    hydrateSession: async () => {
      return { threadEvents: [], updatedAt: null, sessionSeq: 0, userId: null, orchestrationRuntime: null, schemaV: null, problems: [] };
    },
    saveSessionCheckpoint: async () => ({ degraded: [] }),
    saveDossierByUserId: async () => {},
    getDossierByUserId: async () => null,
    ...overrides,
  };
  for (const [name, fn] of Object.entries(stubs)) {
    originals[name] = storage[name];
    storage[name] = fn;
  }
  return {
    restore() {
      for (const [name, fn] of Object.entries(originals)) storage[name] = fn;
    },
  };
}

test("a checkpoint that throws never fails the turn, and the next turn retries it", async () => {
  const shared = require("../shared");
  let attempts = 0;
  let failing = true;
  const stub = stubStorage({
    saveSessionCheckpoint: async () => {
      attempts += 1;
      if (failing) {
        const err = new Error("PropertyValueTooLarge");
        err.statusCode = 400;
        throw err;
      }
      return { degraded: [] };
    },
  });
  const fake = await startFakeOpenAI({ replyChars: 1500 });
  try {
    const client = fake.createClient();
    const first = await driveSession({ client, turns: 4 });
    assert.deepEqual(first.results.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal(attempts, 4, "every turn retries because the session stays dirty");
    const degraded = shared.getDurableHealth();
    assert.equal(degraded.degraded, true);
    assert.equal(degraded.consecutiveFailures, 4);
    assert.equal(degraded.lastOperation, "checkpoint");
    assert.match(degraded.lastError, /PropertyValueTooLarge/);

    failing = false;
    const second = await driveSession({ client, turns: 1, sessionId: first.sessionId, userId: first.userId });
    assert.equal(second.results[0].status, 200);
    const healthy = shared.getDurableHealth();
    assert.equal(healthy.degraded, false);
    assert.equal(healthy.consecutiveFailures, 0);
    assert.ok(healthy.lastOkAt);
  } finally {
    await fake.close();
    stub.restore();
  }
});

test("a failed read does not fail the turn, and nothing is written until it succeeds", async () => {
  const shared = require("../shared");
  let readFails = true;
  const stub = stubStorage({
    hydrateSession: async () => {
      if (readFails) throw new Error("storage unreachable");
      return { threadEvents: [], updatedAt: null, sessionSeq: 0, userId: null, orchestrationRuntime: null, schemaV: null, problems: [] };
    },
  });
  const fake = await startFakeOpenAI({ replyChars: 200 });
  let saves = 0;
  const realSave = storage.saveSessionCheckpoint;
  storage.saveSessionCheckpoint = async (...a) => {
    saves += 1;
    return realSave(...a);
  };
  try {
    const client = fake.createClient();
    const first = await driveSession({ client, turns: 3 });
    assert.deepEqual(first.results.map((r) => r.status), [200, 200, 200]);
    assert.equal(saves, 0, "an unhydrated session must not overwrite the stored row");
    assert.equal(shared.getDurableHealth().lastOperation, "hydrate");
    assert.equal(shared.getDurableHealth().degraded, true);

    readFails = false;
    const second = await driveSession({ client, turns: 1, sessionId: first.sessionId, userId: first.userId });
    assert.equal(second.results[0].status, 200);
    assert.ok(saves >= 1, "checkpointing resumes once the session has been read");
    assert.equal(shared.getDurableHealth().degraded, false);
  } finally {
    await fake.close();
    storage.saveSessionCheckpoint = realSave;
    stub.restore();
  }
});

test("a lossy write is reported in health but is not a degraded failure", async () => {
  const shared = require("../shared");
  const stub = stubStorage({
    saveSessionCheckpoint: async () => ({ degraded: ["thread_oldest_12_events_not_persisted"] }),
  });
  const fake = await startFakeOpenAI({ replyChars: 200 });
  try {
    const { results } = await driveSession({ client: fake.createClient(), turns: 1 });
    assert.equal(results[0].status, 200);
    const health = shared.getDurableHealth();
    assert.equal(health.degraded, false);
    assert.deepEqual(health.lastReducedContent, ["thread_oldest_12_events_not_persisted"]);
  } finally {
    await fake.close();
    stub.restore();
  }
});
