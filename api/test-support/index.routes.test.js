"use strict";

/**
 * Loads the real Azure Functions entry (`api/index.js`) with a stubbed `@azure/functions` that
 * records `app.http(...)` registrations, then calls the handlers the way the Functions host would.
 */

process.env.MAX_REQUESTS_PER_MINUTE = "2";

require("./noDurable");
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const { startFakeOpenAI } = require("./fakeOpenAI");
const contract = require("../contracts/chat-http.contract.json");

/** @type {Record<string, { route: string, methods: string[], handler: Function }>} */
const registered = {};
let fake;

test.before(async () => {
  fake = await startFakeOpenAI();
  process.env.OPENAI_API_KEY = "sk-fake";
  process.env.OPENAI_BASE_URL = fake.baseURL;

  const resolved = require.resolve("@azure/functions");
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = {
    app: {
      http(name, opts) {
        registered[name] = { route: opts.route, methods: opts.methods, handler: opts.handler };
      },
    },
  };
  require.cache[resolved] = stub;
  require("../index.js");
});

test.after(async () => {
  await fake.close();
});

function request({ body, cookie, ip } = {}) {
  return {
    headers: {
      get: (k) => {
        const name = String(k).toLowerCase();
        if (name === "cookie") return cookie || null;
        if (name === "x-forwarded-for") return ip || null;
        return null;
      },
    },
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  };
}

function cookieHeaderFrom(response) {
  const set = response.headers && response.headers["Set-Cookie"];
  assert.ok(Array.isArray(set) && set.length >= 2, "expected identity cookies");
  return set.map((c) => c.split(";")[0]).join("; ");
}

test("registered routes are exactly the documented set", () => {
  const routes = Object.values(registered)
    .map((r) => `${r.methods.join("|")} /api/${r.route}`)
    .sort();
  assert.deepEqual(routes, [
    "GET /api/chat-state",
    "GET /api/config",
    "POST /api/chat",
    "POST /api/chat-sync",
    "POST /api/philosopher-dialog",
  ]);
});

test("every endpoint in the HTTP contract is registered with the same method and path", () => {
  const routes = new Set(Object.values(registered).map((r) => `${r.methods[0]} /api/${r.route}`));
  for (const key of Object.keys(contract.endpoints)) {
    assert.ok(routes.has(key), `contract endpoint not registered: ${key}`);
  }
});

test("no production route is registered for dev-only tooling", () => {
  for (const r of Object.values(registered)) {
    assert.ok(!/dev|lab|debug|seed/i.test(r.route), `dev route registered in Functions: ${r.route}`);
  }
});

test("config handler returns the client bootstrap fields", async () => {
  const res = await registered.config.handler(request());
  assert.equal(res.status, 200);
  for (const k of ["devMode", "lastNClientTranscriptTurns", "durableStorageMode"]) {
    assert.ok(k in res.jsonBody, `config missing ${k}`);
  }
});

test("philosopher-dialog is retired (410)", async () => {
  const res = await registered.philosopherDialog.handler(request());
  assert.equal(res.status, 410);
});

test("chat handler: sets identity cookies, answers with the contract body, and resumes the session", async () => {
  const first = await registered.chat.handler(request({ body: { message: "hello there" } }));
  assert.equal(first.status, 200);
  assert.equal(typeof first.jsonBody.reply, "string");
  assert.ok(first.jsonBody.envelope && first.jsonBody.envelope.active_agent);
  assert.equal(first.jsonBody.serverSeq, 1);
  const cookie = cookieHeaderFrom(first);
  assert.match(cookie, /sessionId=/);
  assert.match(cookie, /edaUserId=/);

  const second = await registered.chat.handler(request({ body: { message: "again" }, cookie }));
  assert.equal(second.status, 200);
  assert.equal(second.jsonBody.serverSeq, 2);

  const state = await registered.chatState.handler(request({ cookie }));
  assert.equal(state.status, 200);
  assert.equal(state.jsonBody.messages.length, 4);
  assert.equal(state.jsonBody.serverSeq, 2);
});

test("chat handler: a body that is not JSON is treated as an empty message, not a crash", async () => {
  const res = await registered.chat.handler(request());
  assert.equal(res.status, 200);
  assert.equal(typeof res.jsonBody.reply, "string");
});

test("POST chat answers 429 rate_limit once a client IP exceeds the per-minute limit", async () => {
  const statuses = [];
  let last;
  for (let i = 0; i < 4; i += 1) {
    last = await registered.chat.handler(request({ body: { message: "hello" }, ip: "203.0.113.20:5555" }));
    statuses.push(last.status);
  }
  assert.deepEqual(statuses, [200, 200, 429, 429]);
  assert.equal(last.jsonBody.errorKind, "rate_limit");
  const other = await registered.chat.handler(request({ body: { message: "hello" }, ip: "203.0.113.21" }));
  assert.equal(other.status, 200);
});

test("POST chat rejects an over-long message with 400 bad_request", async () => {
  const res = await registered.chat.handler(request({ body: { message: "x".repeat(5000) } }));
  assert.equal(res.status, 400);
  assert.equal(res.jsonBody.errorKind, "bad_request");
});
