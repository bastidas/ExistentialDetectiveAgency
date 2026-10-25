"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cs = require("../dossier/conversationSummary");
const { renderDetectiveHistoryText, parseDetectiveHistoryText } = require("../storage/detectiveHistoryText");

const turn = (seq, text) => ({
  seq,
  events: [
    { kind: "user", text: `user ${seq}: ${text}` },
    { kind: "detective", text: `detective ${seq}` },
  ],
});

test("a column holding the literal null, junk, or another layout is no summary", () => {
  assert.equal(cs.parseSummaryJson("null"), null);
  assert.equal(cs.parseSummaryJson(""), null);
  assert.equal(cs.parseSummaryJson("{not json"), null);
  assert.equal(cs.parseSummaryJson(JSON.stringify({ v: 0, text: "old layout" })), null);
  assert.equal(cs.parseSummaryJson(JSON.stringify({ v: 1, text: "", fromSeq: 1, throughSeq: 1 })), null);
  assert.equal(cs.parseSummaryJson(JSON.stringify({ v: 1, text: "x", fromSeq: 5, throughSeq: 2 })), null);
  assert.equal(cs.summaryToJson(null), "null");
});

test("a record round-trips through the column value", () => {
  const record = { v: 1, userId: "u", sessionId: "s", fromSeq: 1, throughSeq: 6, text: "memory", createdAt: "2026-01-01T00:00:00.000Z" };
  assert.deepEqual(cs.parseSummaryJson(cs.summaryToJson(record)), record);
});

test("nothing is summarized until the uncovered tail passes the threshold", async () => {
  let calls = 0;
  const summarize = async () => {
    calls += 1;
    return "S";
  };
  const turns = [turn(1, "short"), turn(2, "short")];
  const none = await cs.extendSummary({ turns, previous: null, userId: "u", sessionId: "s", thresholdChars: 10_000, summarize });
  assert.equal(none, null);
  assert.equal(calls, 0);
});

test("a summary covers the log range it was built from and the next one starts after it", async () => {
  const inputs = [];
  const summarize = async (input) => {
    inputs.push(input);
    return `summary ${inputs.length}`;
  };
  const first = await cs.extendSummary({
    turns: [turn(1, "a".repeat(200)), turn(2, "b".repeat(200))],
    previous: null,
    userId: "u",
    sessionId: "s",
    thresholdChars: 300,
    summarize,
  });
  assert.equal(first.fromSeq, 1);
  assert.equal(first.throughSeq, 2);
  assert.equal(first.text, "summary 1");

  const turns = [turn(1, "a".repeat(200)), turn(2, "b".repeat(200)), turn(3, "c".repeat(400))];
  const second = await cs.extendSummary({ turns, previous: first, userId: "u", sessionId: "s", thresholdChars: 300, summarize });
  assert.equal(second.fromSeq, 1);
  assert.equal(second.throughSeq, 3);
  assert.match(inputs[1], /# EARLIER SUMMARY\nsummary 1/);
  assert.ok(!inputs[1].includes("user 1:"), "covered exchanges are not sent again");
  assert.ok(inputs[1].includes("user 3:"));

  const none = await cs.extendSummary({ turns, previous: second, userId: "u", sessionId: "s", thresholdChars: 1, summarize });
  assert.equal(none, null, "everything is covered");
});

test("a summary carried over from an earlier session seeds the first one of a new session", async () => {
  let seen = "";
  const record = await cs.extendSummary({
    turns: [turn(1, "x".repeat(400))],
    previous: null,
    priorText: "from last week",
    userId: "u",
    sessionId: "new",
    thresholdChars: 100,
    summarize: async (input) => {
      seen = input;
      return "merged";
    },
  });
  assert.match(seen, /# EARLIER SUMMARY\nfrom last week/);
  assert.equal(record.sessionId, "new");
  assert.equal(record.fromSeq, 1);
});

test("an empty summarizer result leaves the record alone", async () => {
  const r = await cs.extendSummary({
    turns: [turn(1, "x".repeat(400))],
    previous: null,
    userId: "u",
    sessionId: "s",
    thresholdChars: 100,
    summarize: async () => "   ",
  });
  assert.equal(r, null);
});

test("detective history text keeps newlines, tabs and quotes, and skips a line cut by truncation", () => {
  const history = [
    { role: "user", content: 'a "quoted"\nmulti\tline' },
    { role: "assistant", content: "reply" },
    { role: "user", content: "last" },
  ];
  const text = renderDetectiveHistoryText(history);
  assert.deepEqual(parseDetectiveHistoryText(text), history);
  const cut = text.slice(10);
  assert.deepEqual(parseDetectiveHistoryText(cut), history.slice(1));
  assert.deepEqual(parseDetectiveHistoryText(""), []);
  assert.deepEqual(parseDetectiveHistoryText(null), []);
});
