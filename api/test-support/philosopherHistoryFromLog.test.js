"use strict";

/**
 * The full checkpoint does not copy the Lumen and Umbra chat histories. It carries a pointer to the
 * per-exchange log rows, and the histories are rebuilt from those rows on a cold start. Storage is
 * replaced by an in-memory table, so this runs without Azurite.
 */

process.env.DURABLE_STORAGE_MODE = "azurite";
process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
process.env.DOSSIER_TABLE_NAME = "unitrebuild";
process.env.ENABLE_RETURN_POLICY = "0";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const storage = require("../storage/durableTableStorage");
const { startFakeOpenAI } = require("./fakeOpenAI");

function ev(kind, text, phase = "detective") {
  return { ts: 1, phase, kind, text, agent: kind };
}

function freshServer() {
  const apiDir = path.resolve(__dirname, "..");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(apiDir + path.sep) && !key.includes(`${path.sep}node_modules${path.sep}`) && !key.includes(`${path.sep}test-support${path.sep}`) && !key.endsWith(`${path.sep}durableTableStorage.js`)) {
      delete require.cache[key];
    }
  }
  return require("../shared");
}

test("rebuildPhilosopherHistory pairs each querent message with that philosopher's reply, detective phase only", () => {
  const chatService = require("../chatService");
  const events = [
    ev("user", "baseline answer", "baseline"),
    ev("attache", "ok", "baseline"),
    ev("user", "first"),
    ev("detective", "d1"),
    ev("lumen_user", "lumen 1"),
    ev("umbra_user", "umbra 1"),
    ev("user", "second"),
    ev("detective", "d2"),
    ev("umbra_user", "umbra 2"),
  ];
  assert.deepEqual(chatService.rebuildPhilosopherHistory(events, "lumen_user"), [
    { role: "user", content: "first" },
    { role: "assistant", content: "lumen 1" },
    { role: "user", content: "second" },
    { role: "assistant", content: "" },
  ]);
  assert.deepEqual(chatService.rebuildPhilosopherHistory(events, "umbra_user"), [
    { role: "user", content: "first" },
    { role: "assistant", content: "umbra 1" },
    { role: "user", content: "second" },
    { role: "assistant", content: "umbra 2" },
  ]);
});

test("the checkpoint omits both philosopher histories and points at the log rows instead", async () => {
  const shared = freshServer();
  const checkpoints = [];
  const originals = {};
  const stubs = {
    hydrateSession: async () => ({ threadEvents: [], updatedAt: null, sessionSeq: 0, userId: null, orchestrationRuntime: null, schemaV: null, problems: [] }),
    saveThreadTurn: async () => ({ degraded: [] }),
    saveSessionCheckpoint: async (_c, payload) => {
      checkpoints.push(payload);
      return { degraded: [] };
    },
    saveDossierByUserId: async () => {},
    getDossierByUserId: async () => null,
  };
  for (const [name, fn] of Object.entries(stubs)) {
    originals[name] = storage[name];
    storage[name] = fn;
  }
  const fake = await startFakeOpenAI({ replyChars: 200 });
  try {
    const { driveSession } = require("./driveSession");
    const { sessionId } = await driveSession({ client: fake.createClient(), turns: 3 });
    assert.ok(checkpoints.length >= 1);
    const blob = checkpoints[checkpoints.length - 1].orchestrationRuntime;
    assert.equal("lumenChatHistory" in blob, false);
    assert.equal("umbraChatHistory" in blob, false);
    assert.equal("attacheSession" in blob, false);
    assert.equal("detectiveChatHistory" in blob, false);
    assert.deepEqual(Object.keys(blob.historyRef).sort(), ["fromSeq", "sessionId", "toSeq"]);
    assert.equal(blob.historyRef.sessionId, sessionId);
    assert.equal(blob.historyRef.fromSeq, 1);
    assert.ok(blob.historyRef.toSeq >= 1);
    assert.equal(typeof shared.getDurableHealth().degraded, "boolean");
  } finally {
    await fake.close();
    Object.assign(storage, originals);
  }
});

test("after a cold start the philosophers see the earlier exchanges, rebuilt from the log", async () => {
  const rows = [];
  let checkpoint = null;
  const originals = {};
  const stubs = {
    hydrateSession: async () => ({
      threadEvents: rows.flatMap((r) => r.events),
      updatedAt: new Date().toISOString(),
      sessionSeq: rows.length,
      userId: "u_cold",
      orchestrationRuntime: checkpoint,
      schemaV: 2,
      problems: [],
    }),
    saveThreadTurn: async (_c, turn) => {
      rows.push({ seq: turn.seq, events: turn.events });
      return { degraded: [] };
    },
    saveSessionCheckpoint: async (_c, payload) => {
      checkpoint = JSON.parse(JSON.stringify(payload.orchestrationRuntime));
      return { degraded: [] };
    },
    saveDossierByUserId: async () => {},
    getDossierByUserId: async () => null,
  };
  const sessionId = "cold-session-1";
  const userId = "u_cold";
  const turnText = (i) => `cold start turn ${i + 1}`;

  const fakeA = await startFakeOpenAI({ replyChars: 120 });
  freshServer();
  for (const [name, fn] of Object.entries(stubs)) {
    originals[name] = storage[name];
    storage[name] = fn;
  }
  try {
    const { driveSession } = require("./driveSession");
    await driveSession({ client: fakeA.createClient(), turns: 12, sessionId, userId, message: turnText });
  } finally {
    await fakeA.close();
  }

  try {
    const live = require("../chatService").peekPhilosopherHistories(sessionId);
    assert.ok(live.lumen.length >= 2, "the first process holds Lumen history");
    const expectedLumen = live.lumen;
    const expectedUmbra = live.umbra;

    const restarted = freshServer();
    const chatService = require("../chatService");
    assert.deepEqual(chatService.peekPhilosopherHistories(sessionId), { lumen: [], umbra: [] }, "a fresh process starts empty");
    await restarted.hydrateSessionFromDurable(sessionId);
    const after = chatService.peekPhilosopherHistories(sessionId);
    assert.deepEqual(after.lumen, expectedLumen, "Lumen history rebuilt from the log matches the live one");
    assert.deepEqual(after.umbra, expectedUmbra, "Umbra history rebuilt from the log matches the live one");
  } finally {
    Object.assign(storage, originals);
  }
});

test("a stored blob that still carries philosopher histories does not supply them", () => {
  const chatService = require("../chatService");
  const sessionId = "stored-history-ignored";
  chatService.restoreSessionRuntimeFromDurable(sessionId, {
    v: 2,
    lumenChatHistory: [{ role: "user", content: "stale" }],
    umbraChatHistory: [{ role: "user", content: "stale" }],
    detectiveTurnCount: 3,
  });
  assert.deepEqual(chatService.peekPhilosopherHistories(sessionId), { lumen: [], umbra: [] });
});
