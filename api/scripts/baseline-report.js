"use strict";

/**
 * Prints the prompt/payload baseline table used to review prompt-envelope slices:
 * `npm run baseline` (optionally `TURNS=45 REPLY_CHARS=300 SEED=1 npm run baseline`).
 * Uses the fake OpenAI server; no network, no API key. `Math.random` is seeded because the attache
 * shuffles its baseline questions, which otherwise changes the handoff turn between runs.
 */

// The report measures prompt shape over a long conversation, so session and daily caps are lifted
// unless the caller sets them.
process.env.MAX_USER_EXCHANGES = process.env.MAX_USER_EXCHANGES || "1000000";
process.env.MAX_DAILY_USAGE = process.env.MAX_DAILY_USAGE || "1000000";

const { startFakeOpenAI } = require("../test-support/fakeOpenAI");
const { driveSession } = require("../test-support/driveSession");
const { summarizeCalls, formatReport } = require("../test-support/analyzeCalls");

function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  seedRandom(Number(process.env.SEED) || 1);
  const turns = Number(process.env.TURNS) || 45;
  const fake = await startFakeOpenAI({ replyChars: Number(process.env.REPLY_CHARS) || 40 });
  try {
    const log = { log: console.log, info: console.info, warn: console.warn };
    console.log = console.info = console.warn = () => {};
    let results;
    try {
      ({ results } = await driveSession({ client: fake.createClient(), turns }));
    } finally {
      Object.assign(console, log);
    }
    const agents = results.map((r) => (r.body && r.body.envelope ? r.body.envelope.active_agent : "-"));
    const handoff = agents.indexOf("detective");
    console.log(`Baseline: ${turns} user turns (attache until turn ${handoff}, detective after)\n`);
    console.log(formatReport(summarizeCalls(fake.requests), turns));
  } finally {
    await fake.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
