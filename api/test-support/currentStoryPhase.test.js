"use strict";

/** `currentStoryPhase` advances on every user turn, attaché and detective alike. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { startFakeOpenAI } = require("./fakeOpenAI");
const { driveSession } = require("./driveSession");

function storyTurn(sessionId) {
  const chatService = require("../chatService");
  const snap = chatService.getCurrentStoryPhaseForSession(sessionId);
  return snap && snap.context ? snap.context.narrativeTurn : 0;
}

test("the story turn counts attaché turns and detective turns", async () => {
  const fake = await startFakeOpenAI({ replyChars: 200 });
  try {
    const client = fake.createClient();
    const first = await driveSession({ client, turns: 2 });
    assert.equal(storyTurn(first.sessionId), 2, "advanced on attaché turns");
    const more = await driveSession({ client, turns: 12, sessionId: first.sessionId, userId: first.userId });
    assert.deepEqual(more.results.map((r) => r.status), Array(12).fill(200));
    assert.equal(storyTurn(first.sessionId), 14, "keeps advancing through the handoff to the detective");
  } finally {
    await fake.close();
  }
});
