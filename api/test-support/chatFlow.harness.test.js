"use strict";

/**
 * End-to-end checks of the chat flow with the real OpenAI SDK talking to the fake server:
 * `shared.handleChatRequest` -> `chatService` -> agent calls -> HTTP -> recorded request bodies.
 *
 * These assert properties that must hold before and after the prompt-envelope slices (payload
 * shape, call counts, wire contract). Known defects live in `knownDefects*.test.js`.
 */

require("./noDurable");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { startFakeOpenAI } = require("./fakeOpenAI");
const { classifyCall } = require("./analyzeCalls");
const { driveSession } = require("./driveSession");
const contract = require("../contracts/chat-http.contract.json");

const AGENT_CALLS = new Set([
  "attache_turn",
  "detective_turn",
  "lumen_philosopher_turn",
  "umbra_philosopher_turn",
]);

/**
 * Run `turns` user turns one at a time, returning for each the response and the upstream requests
 * it caused.
 */
async function runTurns(fake, turns, sessionId = crypto.randomUUID()) {
  const client = fake.createClient();
  const out = [];
  for (let i = 0; i < turns; i += 1) {
    const before = fake.requests.length;
    const token = `T${i + 1}_${crypto.randomBytes(3).toString("hex")}`;
    const { results } = await driveSession({
      client,
      turns: 1,
      sessionId,
      message: () => `${token} I feel stuck about my work`,
    });
    out.push({
      token,
      status: results[0].status,
      body: results[0].body,
      calls: fake.requests.slice(before),
    });
  }
  return { sessionId, turns: out };
}

test("session hands off from attache to detective and never goes back", async () => {
  const fake = await startFakeOpenAI();
  try {
    const { turns } = await runTurns(fake, 14);
    assert.ok(turns.every((t) => t.status === 200));
    const agents = turns.map((t) => t.body.envelope.active_agent);
    const firstDetective = agents.indexOf("detective");
    assert.ok(firstDetective > 0, `expected a handoff, got ${agents.join(",")}`);
    assert.ok(agents.slice(0, firstDetective).every((a) => a === "attache"));
    assert.ok(agents.slice(firstDetective).every((a) => a === "detective"));
    assert.equal(turns[firstDetective].body.envelope.baseline_completed, true);
  } finally {
    await fake.close();
  }
});

test("200 bodies match the HTTP contract (required keys, no unknown keys, envelope keys)", async () => {
  const fake = await startFakeOpenAI();
  try {
    const { turns } = await runTurns(fake, 10);
    const def = contract.definitions.ChatPostSuccessBody;
    const envDef = contract.definitions.ChatEnvelope;
    const known = new Set(Object.keys(def.properties));
    for (const t of turns) {
      for (const k of def.required) assert.ok(k in t.body, `missing ${k}`);
      for (const k of Object.keys(t.body)) {
        assert.ok(known.has(k) || k === "llmRefusal", `key not in contract: ${k}`);
      }
      for (const k of envDef.required) assert.ok(k in t.body.envelope, `envelope missing ${k}`);
      assert.equal(typeof t.body.reply, "string");
      assert.ok(t.body.reply.length > 0);
    }
    const seqs = turns.map((t) => t.body.serverSeq);
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), "serverSeq increments by one per turn");
  } finally {
    await fake.close();
  }
});

test("every upstream payload is well formed", async () => {
  const fake = await startFakeOpenAI();
  try {
    await runTurns(fake, 12);
    assert.ok(fake.requests.length > 12);
    for (const body of fake.requests) {
      const name = classifyCall(body);
      assert.equal(typeof body.model, "string");
      assert.ok(Array.isArray(body.messages) && body.messages.length >= 2, `${name}: messages`);
      assert.equal(body.messages[0].role, "system", `${name}: first message is system`);
      assert.ok(String(body.messages[0].content).trim().length > 0, `${name}: system not empty`);
      assert.equal(body.messages[body.messages.length - 1].role, "user", `${name}: last is user`);
      for (const m of body.messages) {
        assert.ok(["system", "user", "assistant"].includes(m.role), `${name}: role ${m.role}`);
        assert.equal(typeof m.content, "string", `${name}: content is a string`);
      }
      if (AGENT_CALLS.has(name)) {
        assert.equal(body.response_format.type, "json_schema");
        assert.equal(body.response_format.json_schema.strict, true, `${name}: strict schema`);
        assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
      } else {
        assert.equal(name, "json_object", `unexpected helper call ${name}`);
      }
    }
  } finally {
    await fake.close();
  }
});

test("the current utterance is the last message and is not repeated in the history message", async () => {
  const fake = await startFakeOpenAI();
  try {
    const { turns } = await runTurns(fake, 12);
    let checked = 0;
    for (const t of turns) {
      for (const body of t.calls) {
        if (!AGENT_CALLS.has(classifyCall(body))) continue;
        const last = body.messages[body.messages.length - 1].content;
        assert.ok(last.includes(t.token), `${classifyCall(body)}: last message carries the utterance`);
        const earlier = body.messages.slice(1, -1).map((m) => m.content).join("\n");
        assert.ok(!earlier.includes(t.token), `${classifyCall(body)}: utterance duplicated in history`);
        checked += 1;
      }
    }
    assert.ok(checked >= 12);
  } finally {
    await fake.close();
  }
});

test("a detective turn makes exactly one detective, one Lumen and one Umbra call", async () => {
  const fake = await startFakeOpenAI();
  try {
    const { turns } = await runTurns(fake, 14);
    const detectiveTurns = turns.filter((t) => t.body.envelope.active_agent === "detective");
    assert.ok(detectiveTurns.length >= 3);
    for (const t of detectiveTurns) {
      const names = t.calls.map(classifyCall);
      const count = (n) => names.filter((x) => x === n).length;
      assert.equal(count("detective_turn"), 1, names.join(","));
      assert.equal(count("lumen_philosopher_turn"), 1, names.join(","));
      assert.equal(count("umbra_philosopher_turn"), 1, names.join(","));
      assert.ok(count("json_object") <= 2, `helper calls: ${names.join(",")}`);
      assert.equal(count("attache_turn"), 0);
    }
  } finally {
    await fake.close();
  }
});

test("an attache turn makes exactly one agent call", async () => {
  const fake = await startFakeOpenAI();
  try {
    const { turns } = await runTurns(fake, 3);
    for (const t of turns) {
      assert.equal(t.body.envelope.active_agent, "attache");
      const agentCalls = t.calls.map(classifyCall).filter((n) => AGENT_CALLS.has(n));
      assert.deepEqual(agentCalls, ["attache_turn"]);
    }
  } finally {
    await fake.close();
  }
});

test("a model refusal becomes an in-character reply with llmRefusal attached", async () => {
  const fake = await startFakeOpenAI({
    respond: (body) => (classifyCall(body) === "attache_turn" ? { __refusal: "no" } : undefined),
  });
  try {
    const { turns } = await runTurns(fake, 1);
    assert.equal(turns[0].status, 200);
    assert.ok(turns[0].body.reply.length > 0);
    assert.ok(!/\[Mock LLM\]/.test(turns[0].body.reply));
    assert.equal(turns[0].body.llmRefusal.refusalText, "no");
  } finally {
    await fake.close();
  }
});

test("GET chat-state reflects the transcript after a few turns", async () => {
  const fake = await startFakeOpenAI();
  try {
    const shared = require("../shared");
    const { sessionId, turns } = await runTurns(fake, 4);
    const state = await shared.getChatStateForSession(sessionId, "u1");
    const def = contract.definitions.ChatStateSnapshotBody;
    for (const k of def.required) assert.ok(k in state, `chat-state missing ${k}`);
    assert.equal(state.messages.length, turns.length * 2);
    assert.deepEqual(
      state.messages.map((m) => m.role),
      turns.flatMap(() => ["user", "assistant"])
    );
    assert.equal(state.serverSeq, turns.length);
  } finally {
    await fake.close();
  }
});

test("long replies stay inside the stored transcript caps (history does not grow without bound)", async () => {
  const fake = await startFakeOpenAI({ replyChars: 1500 });
  try {
    const { turns } = await runTurns(fake, 30);
    const lastDetective = [...turns].reverse().find((t) => t.body.envelope.active_agent === "detective");
    assert.ok(lastDetective);
    const sizes = lastDetective.calls
      .filter((b) => AGENT_CALLS.has(classifyCall(b)))
      .map((b) => b.messages.reduce((n, m) => n + m.content.length, 0));
    for (const n of sizes) {
      assert.ok(n < 60_000, `payload grew to ${n} chars`);
    }
  } finally {
    await fake.close();
  }
});
