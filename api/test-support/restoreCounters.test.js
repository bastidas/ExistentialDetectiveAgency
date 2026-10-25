"use strict";

/**
 * Counter recovery from the session log. The log is written every turn, the checkpoint only every K turns
 * (and not at all when its blob was over budget), so the log is the better witness of how far a session got.
 */

process.env.ENABLE_RETURN_POLICY = "0";

const test = require("node:test");
const assert = require("node:assert/strict");

const chatService = require("../chatService");

const replies = (kinds) => kinds.split("").map((k) => ({ kind: k === "a" ? "attache" : "detective", text: "x" }));
const withUser = (events) => events.flatMap((e) => [{ kind: "user", text: "q" }, e]);

test("deriveCountsFromLog counts replies, ignoring user and other events", () => {
  assert.deepEqual(chatService.deriveCountsFromLog([]), { attacheExchangeCount: 0, detectiveTurnCount: 0 });
  assert.deepEqual(chatService.deriveCountsFromLog(null), { attacheExchangeCount: 0, detectiveTurnCount: 0 });
  assert.deepEqual(chatService.deriveCountsFromLog(withUser(replies("aaadd"))), { attacheExchangeCount: 3, detectiveTurnCount: 2 });
  assert.deepEqual(chatService.deriveCountsFromLog([...replies("a"), { kind: "lumen" }, { kind: "umbra" }]), {
    attacheExchangeCount: 1,
    detectiveTurnCount: 0,
  });
});

test("deriveCountsFromLog applies the rebaseline reset: only the latest attaché run and what follows it count", () => {
  assert.deepEqual(chatService.deriveCountsFromLog(replies("aaddaadd")), { attacheExchangeCount: 2, detectiveTurnCount: 2 });
  assert.deepEqual(chatService.deriveCountsFromLog(replies("aaddaad")), { attacheExchangeCount: 2, detectiveTurnCount: 1 });
  assert.deepEqual(chatService.deriveCountsFromLog(replies("dddd")), { attacheExchangeCount: 0, detectiveTurnCount: 4 });
});

test("restoreCountersFromLog raises counters and the story turn, and never lowers them", () => {
  const id = "counters-raise";
  const first = chatService.restoreCountersFromLog(id, replies("aaaddd"));
  assert.deepEqual(first, { attacheExchangeCount: 3, detectiveTurnCount: 3, storyTurn: 3 });
  assert.equal(chatService.getAttacheExchangeCountForSession(id), 3);
  assert.equal(chatService.getDetectiveTurnCountForSession(id), 3);

  const fromShorterLog = chatService.restoreCountersFromLog(id, replies("ad"));
  assert.deepEqual(fromShorterLog, { attacheExchangeCount: 3, detectiveTurnCount: 3, storyTurn: 3 });
});

test("a checkpoint that is ahead of the log keeps its values", () => {
  const id = "counters-ahead";
  chatService.restoreSessionRuntimeFromDurable(id, { v: 2, detectiveTurnCount: 9, attacheExchangeCount: 4 });
  const result = chatService.restoreCountersFromLog(id, replies("aadd"));
  assert.equal(result.detectiveTurnCount, 9);
  assert.equal(result.attacheExchangeCount, 4);
  assert.equal(result.storyTurn, 9);
});

test("an empty log and a missing session id change nothing", () => {
  assert.deepEqual(chatService.restoreCountersFromLog("counters-empty", []), { attacheExchangeCount: 0, detectiveTurnCount: 0, storyTurn: 0 });
  assert.deepEqual(chatService.restoreCountersFromLog("", replies("ad")), { attacheExchangeCount: 0, detectiveTurnCount: 0, storyTurn: 0 });
});
