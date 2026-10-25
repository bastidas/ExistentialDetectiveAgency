"use strict";

/**
 * Every column the checkpoint writes is read back on hydrate and changes what the session does.
 * The real storage code runs against an in-memory table client, so no Azurite is needed.
 *
 *   baselineCompleted      -> routing is rebuilt when the orchestration blob is missing
 *   detectiveIntroSent     -> the detective's turn count is at least 1, and /api/chat-state reports it
 *   detectiveHistoryText   -> the detective transcript when the blob has none (or a trimmed copy)
 *   degradedReason         -> durable health reports a reduced stored checkpoint; drives the choice above
 *   conversationSummariesJson -> `preceding_conversation_summary` in the model packets
 */

process.env.DURABLE_STORAGE_MODE = "azurite";
process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
process.env.DOSSIER_TABLE_NAME = "unitcolumns";
process.env.ENABLE_RETURN_POLICY = "0";
process.env.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY = "300";
process.env.SESSION_CHECKPOINT_EVERY_K_TURNS = "2";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const storage = require("../storage/durableTableStorage");
const { startFakeOpenAI } = require("./fakeOpenAI");

const SUMMARY_TEXT = "EARLIER TALK SUMMARY: the querent keeps circling a stalled career.";

function createMemoryTableClient() {
  const rows = new Map();
  const key = (pk, rk) => `${pk}\u0000${rk}`;
  return {
    rows,
    async createTable() {},
    async getEntity(pk, rk) {
      const found = rows.get(key(pk, rk));
      if (!found) {
        const err = new Error("not found");
        err.statusCode = 404;
        throw err;
      }
      return JSON.parse(JSON.stringify(found));
    },
    async upsertEntity(entity) {
      rows.set(key(entity.partitionKey, entity.rowKey), JSON.parse(JSON.stringify(entity)));
    },
    async *listEntities(opts) {
      const filter = String(opts && opts.queryOptions && opts.queryOptions.filter);
      const m = /PartitionKey eq '(.*)'$/.exec(filter);
      const pk = m ? m[1].replace(/''/g, "'") : null;
      for (const row of rows.values()) {
        if (pk == null || row.partitionKey === pk) yield JSON.parse(JSON.stringify(row));
      }
    },
  };
}

function freshServer() {
  const apiDir = path.resolve(__dirname, "..");
  for (const k of Object.keys(require.cache)) {
    if (
      k.startsWith(apiDir + path.sep) &&
      !k.includes(`${path.sep}node_modules${path.sep}`) &&
      !k.includes(`${path.sep}test-support${path.sep}`) &&
      !k.endsWith(`${path.sep}durableTableStorage.js`)
    ) {
      delete require.cache[k];
    }
  }
  return require("../shared");
}

function summarizerAwareFake() {
  return startFakeOpenAI({
    replyChars: 200,
    respond: (body) => {
      const first = body.messages && body.messages[0] && String(body.messages[0].content || "");
      if (first && first.includes("Summarize the following conversation")) return SUMMARY_TEXT;
      return undefined;
    },
  });
}

const sessionRow = (table, sessionId) => table.rows.get(`EDA_session\u0000${sessionId}`);

test("a conversation long enough to summarize writes real values to all five columns", async () => {
  const table = createMemoryTableClient();
  const original = storage.getTableClient;
  storage.getTableClient = () => table;
  const fake = await summarizerAwareFake();
  try {
    freshServer();
    const { driveSession } = require("./driveSession");
    const { sessionId, userId } = await driveSession({ client: fake.createClient(), turns: 14 });
    const row = sessionRow(table, sessionId);
    assert.ok(row, "a checkpoint row exists");

    assert.equal(row.baselineCompleted, true);
    assert.equal(row.detectiveIntroSent, true);
    assert.ok(row.detectiveHistoryText.length > 0, "detective transcript is stored");
    assert.equal(typeof row.degradedReason, "string");

    const { parseSummaryJson } = require("../dossier/conversationSummary");
    const stored = parseSummaryJson(row.conversationSummariesJson);
    assert.ok(stored, "conversationSummariesJson holds a summary record, not the literal null");
    assert.equal(stored.text, SUMMARY_TEXT);
    assert.equal(stored.sessionId, sessionId);
    assert.equal(stored.userId, userId);
    assert.equal(stored.fromSeq, 1);
    assert.ok(stored.throughSeq >= 1);

    const userRow = table.rows.get(`EDA_userSummary\u0000${userId}`);
    assert.ok(userRow, "the user's own summary row exists");
    assert.equal(parseSummaryJson(userRow.summaryJson).text, SUMMARY_TEXT);
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
});

test("hydrate reads the columns back when the orchestration blob is gone", async () => {
  const table = createMemoryTableClient();
  const original = storage.getTableClient;
  storage.getTableClient = () => table;
  const fake = await summarizerAwareFake();
  try {
    freshServer();
    const { driveSession } = require("./driveSession");
    const { sessionId, userId } = await driveSession({ client: fake.createClient(), turns: 14 });
    const live = require("../chatService");
    const liveHistory = JSON.parse(JSON.stringify(live.peekDetectiveHistory(sessionId)));
    assert.ok(liveHistory.length >= 2, "the first process holds a detective transcript");

    const row = sessionRow(table, sessionId);
    for (const k of Object.keys(row)) {
      if (k.startsWith("orchestrationRuntimeJson")) delete row[k];
    }
    row.degradedReason = "orchestration_not_persisted";
    await new Promise((r) => setTimeout(r, 15));

    const restarted = freshServer();
    const chatService = require("../chatService");
    const { getChatEnvelopeForSession } = require("../orchestration/chatMachine");
    assert.equal(getChatEnvelopeForSession(sessionId), null, "a fresh process knows nothing");
    assert.equal(chatService.getConversationSummaryForSession(sessionId), "");

    await restarted.hydrateSessionFromDurable(sessionId);

    const env = getChatEnvelopeForSession(sessionId);
    assert.ok(env, "routing was rebuilt from baselineCompleted");
    assert.equal(env.active_agent, "detective");
    assert.equal(env.baseline_completed, true);

    assert.ok(chatService.getDetectiveTurnCountForSession(sessionId) >= 1, "detectiveIntroSent floors the turn count");
    assert.equal(chatService.getDetectiveIntroSentForSession(sessionId), true);

    const { parseDetectiveHistoryText } = require("../storage/detectiveHistoryText");
    const storedHistory = parseDetectiveHistoryText(row.detectiveHistoryText);
    assert.ok(storedHistory.length >= 2);
    assert.deepEqual(
      chatService.peekDetectiveHistory(sessionId),
      storedHistory,
      "the detective transcript came from detectiveHistoryText"
    );
    const liveJson = JSON.stringify(liveHistory);
    assert.ok(
      liveJson.includes(JSON.stringify(storedHistory).slice(1, -1)),
      "and it is a contiguous slice of what the first process held (the checkpoint trails by its interval)"
    );

    assert.equal(chatService.getConversationSummaryForSession(sessionId), SUMMARY_TEXT);

    assert.ok(
      restarted.getDurableHealth().lastReducedContent.includes("stored_checkpoint_orchestration_not_persisted"),
      "degradedReason is surfaced in durable health"
    );
    assert.ok(restarted.getMsSinceLastVisitForSession(sessionId) > 0, "last activity is seeded from the stored row");

    const state = await restarted.getChatStateForSession(sessionId, userId);
    assert.equal(state.detectiveIntroSent, true);
    assert.equal(state.userProgress.baselineCompleted, true);
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
});

test("a trimmed blob history is replaced by the longer stored transcript, an intact one is kept", () => {
  const chatService = require("../chatService");
  const { renderDetectiveHistoryText } = require("../storage/detectiveHistoryText");
  const long = [];
  for (let i = 0; i < 10; i += 1) long.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });
  const text = renderDetectiveHistoryText(long);
  const blob = { v: 2, detectiveChatHistory: long.slice(-4), detectiveTurnCount: 5 };

  chatService.restoreSessionRuntimeFromDurable("trimmed-session", blob);
  chatService.restoreSessionFromRowColumns("trimmed-session", {
    detectiveHistoryText: text,
    degraded: ["orchestration_history_trimmed"],
  });
  assert.equal(chatService.peekDetectiveHistory("trimmed-session").length, 10);

  chatService.restoreSessionRuntimeFromDurable("intact-session", blob);
  chatService.restoreSessionFromRowColumns("intact-session", { detectiveHistoryText: text, degraded: [] });
  assert.equal(chatService.peekDetectiveHistory("intact-session").length, 4);
});

test("a returning user's new session sees the summary from their earlier session", async () => {
  const table = createMemoryTableClient();
  const original = storage.getTableClient;
  storage.getTableClient = () => table;
  const fake = await summarizerAwareFake();
  try {
    freshServer();
    const { driveSession } = require("./driveSession");
    const { userId } = await driveSession({ client: fake.createClient(), turns: 14 });

    const next = freshServer();
    const chatService = require("../chatService");
    const newSession = "a-brand-new-session";
    fake.reset();
    // Lumen and Umbra only run once the detective has the floor.
    chatService.restoreSessionFromRowColumns(newSession, { baselineCompleted: true });
    const r = await next.handleChatRequest(newSession, "I am back again", {
      openaiClient: fake.createClient(),
      dailyUsageStore: next.createMemoryDailyUsageStore(),
      userId,
      debug: false,
    });
    assert.equal(r.status, 200);
    assert.equal(chatService.getConversationSummaryForSession(newSession), SUMMARY_TEXT);
    const lumenAndUmbra = fake.requests
      .map((b) => JSON.stringify(b.messages))
      .filter((m) => m.includes("narrative_phase"));
    assert.ok(lumenAndUmbra.length >= 2, "Lumen and Umbra were called");
    for (const m of lumenAndUmbra) {
      assert.ok(m.includes("EARLIER TALK SUMMARY"), "the Lumen and Umbra packets carry the summary");
    }
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
});

test("a failed summarizer call keeps the old summary and never stores raw transcript", async () => {
  const table = createMemoryTableClient();
  const original = storage.getTableClient;
  storage.getTableClient = () => table;
  const fake = await startFakeOpenAI({
    replyChars: 200,
    respond: (body) => {
      const first = body.messages && body.messages[0] && String(body.messages[0].content || "");
      if (first && first.includes("Summarize the following conversation")) return { __status: 500 };
      return undefined;
    },
  });
  try {
    freshServer();
    const { driveSession } = require("./driveSession");
    const { sessionId } = await driveSession({ client: fake.createClient(), turns: 8 });
    assert.equal(require("../chatService").getConversationSummaryForSession(sessionId), "");
    const row = sessionRow(table, sessionId);
    assert.ok(row);
    assert.equal(row.conversationSummariesJson, "null");
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
});
