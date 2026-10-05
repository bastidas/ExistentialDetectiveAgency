"use strict";

/**
 * Fake OpenAI-compatible HTTP server for tests and manual runs.
 *
 * It speaks just enough of `POST /v1/chat/completions` for the real `openai` SDK: it records every
 * request body, builds a schema-valid reply from the request's `response_format`, and can inject
 * failures or refusals. Because the real SDK talks to it over HTTP, serialization, headers, and
 * `response_format` handling are exercised the same way as in production.
 *
 * Library use:
 *   const fake = await startFakeOpenAI();
 *   const client = fake.createClient();
 *   ...run code with `client`...
 *   fake.requests   // recorded request bodies, in order
 *   await fake.close();
 *
 * CLI use (for `OPENAI_BASE_URL=http://127.0.0.1:4999/v1 node server-dev.js`):
 *   FAKE_PORT=4999 REPLY_CHARS=300 node api/test-support/fakeOpenAI.js
 */

const http = require("http");

/**
 * Property values the fake pins regardless of schema defaults. A cooperative attaché asks the
 * baseline question every turn, so the conversation advances through the baseline.
 */
const DEFAULT_BOOLEAN_OVERRIDES = Object.freeze({ asked_baseline_question: true });

const FILLER = "A reply for the querent. ";

/**
 * @param {number} chars
 * @returns {string}
 */
function fillerText(chars) {
  const n = Math.max(1, Math.floor(chars));
  return FILLER.repeat(Math.ceil(n / FILLER.length)).slice(0, n);
}

/**
 * Build a value that satisfies a JSON Schema subset (object, array, string, enum, boolean, number).
 *
 * @param {object|null|undefined} schema
 * @param {{ replyChars: number, booleanOverrides: Record<string, boolean>, key?: string }} ctx
 * @returns {unknown}
 */
function generateFromSchema(schema, ctx) {
  if (!schema || typeof schema !== "object") return null;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "string":
      return fillerText(ctx.replyChars);
    case "boolean":
      return ctx.key && Object.prototype.hasOwnProperty.call(ctx.booleanOverrides, ctx.key)
        ? ctx.booleanOverrides[ctx.key]
        : false;
    case "integer":
    case "number":
      return 0;
    case "array":
      return [];
    case "object": {
      const out = {};
      const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
      for (const k of Object.keys(props)) {
        out[k] = generateFromSchema(props[k], { ...ctx, key: k });
      }
      return out;
    }
    default:
      return null;
  }
}

/**
 * @typedef {object} FakeOpenAIOptions
 * @property {number} [port] — 0 picks a free port (default).
 * @property {number} [replyChars] — length of every generated string (default 40).
 * @property {Record<string, boolean>} [booleanOverrides] — boolean property overrides by name.
 * @property {object} [jsonObjectReply] — reply for `response_format: json_object` calls (summarizer, dossier).
 * @property {(body: object, index: number) => (object|string|null|undefined)} [respond] — return an
 *   object to use as the assistant JSON, `{ __refusal: "text" }` to send a refusal, `{ __status: 500 }`
 *   to fail the HTTP call, or undefined to fall back to the generated reply.
 */

/**
 * @param {FakeOpenAIOptions} [options]
 */
async function startFakeOpenAI(options = {}) {
  const state = {
    replyChars: options.replyChars ?? 40,
    booleanOverrides: { ...DEFAULT_BOOLEAN_OVERRIDES, ...(options.booleanOverrides || {}) },
    jsonObjectReply: options.jsonObjectReply ?? { summary: "Short summary.", traits: [] },
    respond: options.respond || null,
  };
  /** @type {Array<object>} */
  const requests = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch (_) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "invalid json" } }));
        return;
      }
      if (!/\/chat\/completions$/.test(String(req.url || ""))) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: `fake openai: unsupported path ${req.url}` } }));
        return;
      }
      const index = requests.length;
      requests.push(body);

      const rf = body.response_format || {};
      const schema = rf.json_schema && rf.json_schema.schema;
      let content =
        schema != null
          ? generateFromSchema(schema, {
              replyChars: state.replyChars,
              booleanOverrides: state.booleanOverrides,
            })
          : state.jsonObjectReply;

      const custom = state.respond ? state.respond(body, index) : undefined;
      let refusal = null;
      if (custom && typeof custom === "object") {
        if (Object.prototype.hasOwnProperty.call(custom, "__status")) {
          res.statusCode = Number(custom.__status) || 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { message: "fake openai injected failure" } }));
          return;
        }
        if (Object.prototype.hasOwnProperty.call(custom, "__refusal")) {
          refusal = String(custom.__refusal);
        } else {
          content = custom;
        }
      }

      const message = refusal
        ? { role: "assistant", content: null, refusal }
        : { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `chatcmpl-fake-${index}`,
          object: "chat.completion",
          created: 1,
          model: body.model || "fake-model",
          choices: [{ index: 0, finish_reason: "stop", message }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const { port } = /** @type {import("net").AddressInfo} */ (server.address());
  const baseURL = `http://127.0.0.1:${port}/v1`;

  return {
    port,
    baseURL,
    requests,
    /** @param {Partial<{ replyChars: number, respond: Function|null, booleanOverrides: Record<string, boolean> }>} patch */
    configure(patch) {
      if (patch.replyChars != null) state.replyChars = patch.replyChars;
      if (patch.respond !== undefined) state.respond = patch.respond;
      if (patch.booleanOverrides) {
        state.booleanOverrides = { ...state.booleanOverrides, ...patch.booleanOverrides };
      }
    },
    reset() {
      requests.length = 0;
    },
    /** A real `openai` SDK client pointed at this server (no retries, short timeout). */
    createClient() {
      const OpenAI = require("openai");
      return new OpenAI({ apiKey: "sk-fake", baseURL, maxRetries: 0, timeout: 10_000 });
    },
    close() {
      return new Promise((resolve) => {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

module.exports = {
  startFakeOpenAI,
  generateFromSchema,
  fillerText,
  DEFAULT_BOOLEAN_OVERRIDES,
};

if (require.main === module) {
  startFakeOpenAI({
    port: Number(process.env.FAKE_PORT) || 4999,
    replyChars: Number(process.env.REPLY_CHARS) || 40,
  }).then((fake) => {
    console.log(`fake OpenAI listening: OPENAI_BASE_URL=${fake.baseURL}`);
  });
}
