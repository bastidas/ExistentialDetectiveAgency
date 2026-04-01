"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  threadEventsToMainChatMessages,
  threadEventsToPhilosopherMessages,
  threadEventsToPhilosopherTranscriptText,
  threadEventsToClientMessages,
} = require("./threadEvents");

const sampleEvents = [
  { kind: "user", text: "Hello", ts: "2025-01-01T00:00:00.000Z", phase: "baseline" },
  { kind: "attache", text: "Welcome.", ts: "2025-01-01T00:00:01.000Z", phase: "baseline" },
  { kind: "user", text: "Ready.", ts: "2025-01-01T00:00:02.000Z", phase: "detective" },
  { kind: "lumen_user", text: "Lumen to user", ts: "2025-01-01T00:00:03.000Z", phase: "detective" },
  { kind: "lumen_aside", text: "Lumen aside", ts: "2025-01-01T00:00:04.000Z", phase: "detective" },
  { kind: "umbra_user", text: "Umbra to user", ts: "2025-01-01T00:00:05.000Z", phase: "detective" },
  { kind: "umbra_aside", text: "Umbra aside", ts: "2025-01-01T00:00:06.000Z", phase: "detective" },
  { kind: "detective", text: "Detective reply", ts: "2025-01-01T00:00:07.000Z", phase: "detective" },
];

describe("rehydration transcript separation", () => {
  it("main chat messages exclude lumen and umbra kinds", () => {
    const main = threadEventsToMainChatMessages(sampleEvents);
    const agents = main.map((m) => m.agent).filter(Boolean);
    assert.deepEqual(agents, ["attache", "detective"]);
    assert.ok(!main.some((m) => m.agent === "lumen" || m.agent === "umbra"));
    assert.equal(main.length, 4);
  });

  it("philosopher messages contain only internal kinds", () => {
    const phil = threadEventsToPhilosopherMessages(sampleEvents);
    assert.equal(phil.length, 4);
    assert.ok(phil.every((m) => m.agent === "lumen" || m.agent === "umbra"));
    const kinds = phil.map((p) => p.kind).sort();
    assert.deepEqual(kinds, [
      "lumen_aside",
      "lumen_user",
      "umbra_aside",
      "umbra_user",
    ]);
  });

  it("philosopher transcript text labels each line", () => {
    const text = threadEventsToPhilosopherTranscriptText(sampleEvents);
    assert.match(text, /\[LUMEN_USER\]:/);
    assert.match(text, /\[UMBRA_ASIDE\]:/);
  });

  it("main + philosopher counts equal full client timeline message count", () => {
    const main = threadEventsToMainChatMessages(sampleEvents);
    const phil = threadEventsToPhilosopherMessages(sampleEvents);
    const full = threadEventsToClientMessages(sampleEvents);
    assert.equal(main.length + phil.length, full.length);
  });

  it("full client messages preserve chronological order of kinds", () => {
    const full = threadEventsToClientMessages(sampleEvents);
    const kinds = full.map((m) => m.kind);
    assert.deepEqual(kinds, [
      "user",
      "attache",
      "user",
      "lumen_user",
      "lumen_aside",
      "umbra_user",
      "umbra_aside",
      "detective",
    ]);
  });
});
