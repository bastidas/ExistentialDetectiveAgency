"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { CHAT_HTTP_CONTRACT } = require("./chatApiContract");

const apiRoot = path.join(__dirname, "..");

function azureRoutes() {
  const src = fs.readFileSync(path.join(apiRoot, "src", "index.js"), "utf8");
  return [...src.matchAll(/route:\s*"([^"]+)"/g)].map((m) => m[1]).sort();
}

test("contract documents the chat endpoints and the 204/429 statuses", () => {
  assert.deepEqual(Object.keys(CHAT_HTTP_CONTRACT.endpoints).sort(), [
    "GET /api/chat-state",
    "POST /api/chat",
  ]);
  const chat = CHAT_HTTP_CONTRACT.endpoints["POST /api/chat"];
  for (const status of ["200", "204", "400", "429"]) {
    assert.ok(chat.responses[status], `POST /api/chat should document ${status}`);
  }
  assert.ok(CHAT_HTTP_CONTRACT.definitions.ChatPostErrorBody.properties.errorKind.enum.includes("rate_limit"));
});

test("Azure Functions routes are exactly config, chat-state and chat (no philosopher-dialog)", () => {
  assert.deepEqual(azureRoutes(), ["chat", "chat-state", "config"]);
});

test("no source still refers to the removed philosopher-dialog endpoint", () => {
  const files = [
    path.join(apiRoot, "src", "index.js"),
    path.join(apiRoot, "..", "server.js"),
    path.join(apiRoot, "..", "public", "js", "chat.send.js"),
    path.join(apiRoot, "..", "public", "js", "chat.route.js"),
  ];
  for (const f of files) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /philosopher-dialog/, f);
  }
});
