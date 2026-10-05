"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChatCompletionMessages } = require("./buildChatCompletionMessages");

test("buildChatCompletionMessages: system, native history, this-turn channel", () => {
  const messages = buildChatCompletionMessages({
    systemContent: "SYS\n\n# Response format\n\n{}",
    chatHistory: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
    userChannelContent: '{"packet_version":1}\n\n---QUERENT---\nnow',
  });
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[0], { role: "system", content: "SYS\n\n# Response format\n\n{}" });
  assert.deepEqual(messages[1], { role: "user", content: "hi" });
  assert.deepEqual(messages[2], { role: "assistant", content: "hello" });
  assert.deepEqual(messages[3], {
    role: "user",
    content: '{"packet_version":1}\n\n---QUERENT---\nnow',
  });
  assert.ok(!messages.some((m) => String(m.content).includes("Conversation history")));
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

test("buildChatCompletionMessages: current utterance is not taken from history", () => {
  const messages = buildChatCompletionMessages({
    systemContent: "S",
    chatHistory: [{ role: "user", content: "prior" }],
    userChannelContent: '{"packet_version":1}\n\n---QUERENT---\nlatest',
  });
  assert.equal(messages.filter((m) => m.content === "latest").length, 0);
  assert.ok(messages[messages.length - 1].content.includes("latest"));
});
