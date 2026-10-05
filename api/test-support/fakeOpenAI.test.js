"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startFakeOpenAI, generateFromSchema } = require("./fakeOpenAI");
const { summarizeCalls, classifyCall } = require("./analyzeCalls");

const SCHEMA_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "demo_turn",
    strict: true,
    schema: {
      type: "object",
      properties: {
        user_response: { type: "string" },
        asked_baseline_question: { type: "boolean" },
        flag: { type: "boolean" },
        notes: { type: "array", items: { type: "string" } },
        mode: { type: "string", enum: ["a", "b"] },
        nested: { type: "object", properties: { n: { type: "integer" } } },
      },
      required: ["user_response"],
    },
  },
};

test("generateFromSchema: strings, enums, booleans, arrays, nested objects", () => {
  const out = generateFromSchema(SCHEMA_FORMAT.json_schema.schema, {
    replyChars: 12,
    booleanOverrides: { asked_baseline_question: true },
  });
  assert.equal(out.user_response.length, 12);
  assert.equal(out.asked_baseline_question, true);
  assert.equal(out.flag, false);
  assert.deepEqual(out.notes, []);
  assert.equal(out.mode, "a");
  assert.deepEqual(out.nested, { n: 0 });
});

test("fake server: real SDK round-trip returns schema-valid JSON and records the request", async () => {
  const fake = await startFakeOpenAI({ replyChars: 20 });
  try {
    const client = fake.createClient();
    const res = await client.chat.completions.create({
      model: "m",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
      ],
      response_format: SCHEMA_FORMAT,
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    assert.equal(parsed.user_response.length, 20);
    assert.equal(fake.requests.length, 1);
    assert.equal(classifyCall(fake.requests[0]), "demo_turn");
    assert.equal(fake.requests[0].messages[1].content, "hello");
  } finally {
    await fake.close();
  }
});

test("fake server: json_object calls get the configurable helper reply", async () => {
  const fake = await startFakeOpenAI({ jsonObjectReply: { summary: "x", traits: ["t"] } });
  try {
    const res = await fake.createClient().chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "u" }],
      response_format: { type: "json_object" },
    });
    assert.deepEqual(JSON.parse(res.choices[0].message.content), { summary: "x", traits: ["t"] });
    assert.equal(classifyCall(fake.requests[0]), "json_object");
  } finally {
    await fake.close();
  }
});

test("fake server: respond() can override content, inject a refusal, and fail the call", async () => {
  const fake = await startFakeOpenAI({
    respond: (_body, i) => {
      if (i === 0) return { user_response: "custom" };
      if (i === 1) return { __refusal: "I cannot help with that." };
      if (i === 2) return { __status: 500 };
      return undefined;
    },
  });
  try {
    const client = fake.createClient();
    const call = () =>
      client.chat.completions.create({
        model: "m",
        messages: [{ role: "user", content: "u" }],
        response_format: SCHEMA_FORMAT,
      });
    const a = await call();
    assert.equal(JSON.parse(a.choices[0].message.content).user_response, "custom");
    const b = await call();
    assert.equal(b.choices[0].message.refusal, "I cannot help with that.");
    assert.equal(b.choices[0].message.content, null);
    await assert.rejects(call(), (err) => err && err.status === 500);
    const d = await call();
    assert.equal(typeof JSON.parse(d.choices[0].message.content).user_response, "string");
  } finally {
    await fake.close();
  }
});

test("fake server: rejects unsupported paths", async () => {
  const fake = await startFakeOpenAI();
  try {
    const r = await fetch(`http://127.0.0.1:${fake.port}/v1/models`);
    assert.equal(r.status, 404);
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
  }
});

test("summarizeCalls: groups by call name and detects changing system prompts and mock text", () => {
  const mk = (name, system, extra = []) => ({
    response_format: { type: "json_schema", json_schema: { name } },
    messages: [{ role: "system", content: system }, ...extra, { role: "user", content: "q" }],
  });
  const summary = summarizeCalls([
    mk("a_turn", "one"),
    mk("a_turn", "two [mock custom a]"),
    mk("b_turn", "same", [{ role: "user", content: "h" }]),
    mk("b_turn", "same", [{ role: "user", content: "h" }]),
  ]);
  assert.equal(summary.totalCalls, 4);
  assert.equal(summary.byCall.a_turn.distinctSystemPrompts, 2);
  assert.equal(summary.byCall.a_turn.systemHasMockText, true);
  assert.equal(summary.byCall.b_turn.distinctSystemPrompts, 1);
  assert.deepEqual(summary.byCall.b_turn.rolePatterns, ["suu"]);
});
