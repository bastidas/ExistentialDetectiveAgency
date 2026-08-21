"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChatCompletionMessages } = require("./buildChatCompletionMessages");

test("buildChatCompletionMessages: system (includes schema), history, final user", () => {
  const messages = buildChatCompletionMessages({
    systemContent: "SYS\n\n# Response format\n\n{}",
    chatHistory: [{ role: "user", content: "hi" }],
    userMessage: "now",
  });
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[0], { role: "system", content: "SYS\n\n# Response format\n\n{}" });
  assert.ok(String(messages[1].content).includes("Conversation history"));
  assert.deepEqual(messages[2], { role: "user", content: "now" });
});

test("buildChatCompletionMessages: system + final user when no history", () => {
  const messages = buildChatCompletionMessages({
    systemContent: "S",
    chatHistory: [],
    userMessage: "u",
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: "S" });
  assert.deepEqual(messages[1], { role: "user", content: "u" });
});
