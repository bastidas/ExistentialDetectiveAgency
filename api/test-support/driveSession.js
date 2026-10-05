"use strict";

const crypto = require("crypto");

/**
 * Drive `shared.handleChatRequest` for N user turns on one session.
 *
 * Requires `./fakeOpenAI` (or any client) and loads `../shared` lazily so callers can set
 * environment variables first (`shared.js` reads caps and storage mode at require time).
 *
 * @param {object} opts
 * @param {import("openai").default} opts.client
 * @param {number} opts.turns
 * @param {string} [opts.sessionId]
 * @param {string} [opts.userId]
 * @param {(i: number) => string} [opts.message]
 * @param {boolean} [opts.stopOnNon200] — stop and return when a turn is not HTTP 200.
 * @returns {Promise<{ sessionId: string, userId: string, results: Array<{ status: number, body: any, message: string }> }>}
 */
async function driveSession(opts) {
  const shared = require("../shared");
  const sessionId = opts.sessionId || crypto.randomUUID();
  const userId = opts.userId || crypto.randomUUID();
  const dailyUsageStore = opts.dailyUsageStore || shared.createMemoryDailyUsageStore();
  const messageFor = opts.message || ((i) => `turn ${i + 1}: I feel stuck about my work`);
  const results = [];
  for (let i = 0; i < opts.turns; i += 1) {
    const message = messageFor(i);
    const r = await shared.handleChatRequest(sessionId, message, {
      openaiClient: opts.client,
      dailyUsageStore,
      userId,
      debug: false,
    });
    results.push({ status: r.status, body: r.body, message });
    if (opts.stopOnNon200 && r.status !== 200) break;
  }
  return { sessionId, userId, results };
}

module.exports = { driveSession };
