"use strict";

/**
 * Durable storage failures are non-fatal (plans/XSTATE-MERGE-PLAN.md, P-02). Storage calls are
 * replaced with stubs, so this needs no Azurite. The durable settings must be in the environment
 * before `shared.js` loads.
 */

process.env.DURABLE_STORAGE_MODE = "azurite";
process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
process.env.DOSSIER_TABLE_NAME = "unitdegraded";
process.env.SESSION_CHECKPOINT_EVERY_K_TURNS = "5";

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
    saveThreadTurn: async () => ({ degraded: [] }),
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
    const first = await driveSession({ client, turns: 7 });
    assert.deepEqual(first.results.map((r) => r.status), [200, 200, 200, 200, 200, 200, 200]);
    assert.equal(attempts, 7, "a checkpoint that never succeeds is retried on every turn");
    const degraded = shared.getDurableHealth();
    assert.equal(degraded.degraded, true);
    assert.equal(degraded.consecutiveFailures, 7);
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

test("every exchange is written as its own row with all agents, even between full checkpoints", async () => {
  const written = [];
  let checkpoints = 0;
  const stub = stubStorage({
    saveThreadTurn: async (_client, turn) => {
      written.push(turn);
      return { degraded: [] };
    },
    saveSessionCheckpoint: async () => {
      checkpoints += 1;
      return { degraded: [] };
    },
  });
  const fake = await startFakeOpenAI({ replyChars: 200 });
  try {
    const { sessionId, userId, results } = await driveSession({ client: fake.createClient(), turns: 4 });
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal(written.length, 4, "one row per exchange");
    assert.equal(checkpoints, 1, "only the first turn writes a full checkpoint; the next is five turns later");
    assert.deepEqual(written.map((w) => w.seq), [1, 2, 3, 4]);
    for (const w of written) {
      assert.equal(w.sessionId, sessionId);
      assert.equal(w.userId, userId);
      assert.equal(w.events[0].kind, "user");
      assert.ok(w.events.every((e) => typeof e.text === "string" && e.text.length > 0));
      assert.ok(w.events.length >= 2, "user message plus at least one agent reply");
    }
    assert.equal(written[0].events[0].text, results[0].message, "the user's message is stored verbatim");
  } finally {
    await fake.close();
    stub.restore();
  }
});

test("a failed exchange write is retried with the next turn and nothing is skipped", async () => {
  const shared = require("../shared");
  const written = [];
  let failing = true;
  const stub = stubStorage({
    saveThreadTurn: async (_client, turn) => {
      if (failing) throw new Error("503 Server Busy");
      written.push(turn.seq);
      return { degraded: [] };
    },
  });
  const fake = await startFakeOpenAI({ replyChars: 200 });
  try {
    const client = fake.createClient();
    const first = await driveSession({ client, turns: 3 });
    assert.deepEqual(first.results.map((r) => r.status), [200, 200, 200]);
    assert.deepEqual(written, []);
    assert.equal(shared.getDurableHealth().lastOperation, "thread_write");
    assert.equal(shared.getDurableHealth().degraded, true);

    failing = false;
    const second = await driveSession({ client, turns: 1, sessionId: first.sessionId, userId: first.userId });
    assert.equal(second.results[0].status, 200);
    assert.deepEqual(written, [1, 2, 3, 4], "the three missed exchanges are written first, in order");
    assert.equal(shared.getDurableHealth().degraded, false);
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
