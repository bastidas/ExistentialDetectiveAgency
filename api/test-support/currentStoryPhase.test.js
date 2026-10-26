"use strict";

/**
 * `currentStoryPhase` counts detective turns only. Attaché turns never move it. (How it should be
 * advanced is an open design question; see docs/phases.md. This test pins today's behavior.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { startFakeOpenAI } = require("./fakeOpenAI");
const { driveSession } = require("./driveSession");

function storyTurn(sessionId) {
  const chatService = require("../chatService");
  const snap = chatService.getCurrentStoryPhaseForSession(sessionId);
  return snap && snap.context ? snap.context.narrativeTurn : 0;
}

test("attaché turns do not move the story phase; each detective turn moves it by one", async () => {
  const fake = await startFakeOpenAI({ replyChars: 200 });
  try {
    const client = fake.createClient();
    const first = await driveSession({ client, turns: 2 });
    assert.equal(storyTurn(first.sessionId), 0, "still at the start after two attaché turns");

    const more = await driveSession({ client, turns: 14, sessionId: first.sessionId, userId: first.userId });
    assert.deepEqual(more.results.map((r) => r.status), Array(14).fill(200));
    const chatService = require("../chatService");
    const detectiveTurns = chatService.getDetectiveTurnCountForSession(first.sessionId);
    assert.ok(detectiveTurns >= 2, "the session reached the detective");
    assert.equal(storyTurn(first.sessionId), detectiveTurns, "story turn equals detective turns, not total turns");
    assert.ok(storyTurn(first.sessionId) < 16, "attaché turns were not counted");
  } finally {
    await fake.close();
  }
});
