"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildComposedPromptPreviewPayload,
  buildNonSystemMessagesPreview,
} = require("./llmPayloadPreview");

test("buildComposedPromptPreviewPayload maps composed fields", () => {
  const p = buildComposedPromptPreviewPayload({
    activeAgent: "detective",
    title: "T",
    composed: {
      content: "SYS",
      outputSchema: { type: "object" },
      llmSafeState: { existential_therapy_phase: "middle" },
    },
  });
  assert.equal(p.systemRoleExact, "SYS");
  assert.ok(p.outputSchemaJson.includes('"type"'));
  assert.ok(Array.isArray(p.additionalMessages));
  assert.equal(p.additionalMessages.length, 2);
  assert.equal(p.additionalMessages[0].label, "Conversation history");
  assert.equal(p.additionalMessages[1].label, "Current user message");
  assert.equal(p.labLlmSafeState && p.labLlmSafeState.existential_therapy_phase, "middle");
  assert.equal(p.turnInstructionsPreview, "");
});

test("buildComposedPromptPreviewPayload includes turnInstructionsPreview slice", () => {
  const sys = "intro\n# TURN INSTRUCTIONS\ndo this\n### sub\nmore\n# Identity\nx";
  const p = buildComposedPromptPreviewPayload({
    activeAgent: "detective",
    title: "T",
    composed: { content: sys },
  });
  assert.ok(p.turnInstructionsPreview.includes("# TURN INSTRUCTIONS"));
  assert.ok(p.turnInstructionsPreview.includes("do this"));
  assert.ok(!p.turnInstructionsPreview.includes("# Identity"));
});

test("buildNonSystemMessagesPreview: history and current user only", () => {
  const list = buildNonSystemMessagesPreview({
    historyNote: "H",
    userNote: "U",
  });
  assert.equal(list.length, 2);
  assert.equal(list[0].content, "H");
  assert.equal(list[1].content, "U");
});
