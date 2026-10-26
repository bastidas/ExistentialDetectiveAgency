"use strict";

/**
 * Every column the checkpoint writes is read back on hydrate and changes what the session does.
 * The real storage code runs against an in-memory table client, so no Azurite is needed.
 *
 *   baselineCompleted      -> routing is rebuilt when the orchestration blob is missing
 *   detectiveIntroSent     -> the detective's turn count is at least 1, and /api/chat-state reports it
 *   detectiveHistoryText   -> leftover column, no longer written or read
 *   the session log        -> attaché / detective counters, story turn, and detective history, rebuilt when the blob is gone
 *   degradedReason         -> durable health reports a reduced stored checkpoint
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

const storage = require("../storage/durableTableStorage");
const { createMemoryTableClient, freshServer } = require("./memoryTableClient");
const { startFakeOpenAI } = require("./fakeOpenAI");

const SUMMARY_TEXT = "EARLIER TALK SUMMARY: the querent keeps circling a stalled career.";

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
    assert.equal(row.detectiveHistoryText, "", "detective transcript is no longer stored on the row");
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
    const liveCounters = {
      attache: live.getAttacheExchangeCountForSession(sessionId),
      detective: live.getDetectiveTurnCountForSession(sessionId),
      storyTurn: live.getCurrentStoryPhaseForSession(sessionId),
    };
    assert.ok(liveCounters.attache > 0 && liveCounters.detective > 0, JSON.stringify(liveCounters));
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

    const keep = Math.max(require("../config").HISTORY_TAIL_TURNS, require("../config").LAST_N_MESSAGES_FOR_DOSSIER);
    assert.deepEqual(
      chatService.peekDetectiveHistory(sessionId),
      liveHistory.slice(-keep),
      "the detective transcript was rebuilt from the log (newest messages the models read)"
    );

    assert.equal(chatService.getConversationSummaryForSession(sessionId), SUMMARY_TEXT);

    assert.ok(
      restarted.getDurableHealth().lastReducedContent.includes("stored_checkpoint_orchestration_not_persisted"),
      "degradedReason is surfaced in durable health"
    );
    assert.ok(restarted.getMsSinceLastVisitForSession(sessionId) > 0, "last activity is seeded from the stored row");

    assert.equal(chatService.getAttacheExchangeCountForSession(sessionId), liveCounters.attache, "attaché exchanges come from the log");
    assert.equal(chatService.getDetectiveTurnCountForSession(sessionId), liveCounters.detective, "detective turns come from the log");
    assert.deepEqual(chatService.getCurrentStoryPhaseForSession(sessionId), liveCounters.storyTurn, "the story turn follows the detective turns");

    const state = await restarted.getChatStateForSession(sessionId, userId);
    assert.equal(state.detectiveIntroSent, true);
    assert.equal(state.userProgress.baselineCompleted, true);
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
});

test("the detective transcript has one source: the log; a leftover blob or column is ignored", () => {
  const chatService = require("../chatService");
  const events = [
    { kind: "user", text: "q1" },
    { kind: "detective", text: "a1" },
    { kind: "user", text: "q2" },
    { kind: "detective", text: "a2" },
  ];
  chatService.restoreSessionRuntimeFromDurable("from-log", { v: 2, detectiveChatHistory: [{ role: "user", content: "stale" }] });
  chatService.restoreSessionFromRowColumns("from-log", { detectiveHistoryText: "user\t\"col\"" });
  chatService.restoreDetectiveHistoryFromThread("from-log", events);
  assert.deepEqual(chatService.peekDetectiveHistory("from-log"), [
    { role: "user", content: "q1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
  ]);
});

test("the checkpoint blob no longer carries the detective history, and the column holds only what the models read", async () => {
  const table = createMemoryTableClient();
  const original = storage.getTableClient;
  storage.getTableClient = () => table;
  const fake = await summarizerAwareFake();
  try {
    freshServer();
    const { driveSession } = require("./driveSession");
    const { sessionId } = await driveSession({ client: fake.createClient(), turns: 14 });
    const row = sessionRow(table, sessionId);
    const hydrated = await storage.hydrateSession(table, sessionId);
    assert.ok(hydrated.orchestrationRuntime, "the blob was written");
    assert.equal("detectiveChatHistory" in hydrated.orchestrationRuntime, false);
    assert.equal("attacheSession" in hydrated.orchestrationRuntime, false, "the blob holds no attaché transcript or session");
    assert.equal("detectiveRuntime" in hydrated.orchestrationRuntime, false);
    assert.equal(row.detectiveHistoryText, "");
    const logHistory = require("../chatService").rebuildDetectiveHistory(hydrated.threadEvents);
    assert.ok(logHistory.length >= 2, "the log holds the detective transcript");
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
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

test("a bug while applying stored state is reported as restore_failed and does not loop the hydrate", async () => {
  const table = createMemoryTableClient();
  const original = storage.getTableClient;
  storage.getTableClient = () => table;
  const fake = await summarizerAwareFake();
  try {
    freshServer();
    const { driveSession } = require("./driveSession");
    const { sessionId } = await driveSession({ client: fake.createClient(), turns: 4 });

    const restarted = freshServer();
    const chatService = require("../chatService");
    const real = chatService.restoreCountersFromLog;
    chatService.restoreCountersFromLog = () => {
      throw new Error("boom");
    };
    try {
      const hydrated = await restarted.hydrateSessionFromDurable(sessionId);
      assert.ok(hydrated, "the session counts as hydrated, so checkpoints and the log can resume");
    } finally {
      chatService.restoreCountersFromLog = real;
    }
    assert.ok(restarted.getDurableHealth().lastReducedContent.includes("restore_failed"));
    assert.equal(await restarted.hydrateSessionFromDurable(sessionId), null, "and it is not retried");
  } finally {
    storage.getTableClient = original;
    await fake.close();
  }
});
