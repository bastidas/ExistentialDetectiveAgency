"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("getDebugPromptsLevel parses DEBUG_PROMPTS_LEVEL", () => {
  const { getDebugPromptsLevel } = require("./logger");
  const saved = process.env.DEBUG_PROMPTS_LEVEL;
  const savedTypo = process.env.DEBUG_PROMPT_LEVEL;
  try {
    delete process.env.DEBUG_PROMPTS_LEVEL;
    delete process.env.DEBUG_PROMPT_LEVEL;
    assert.equal(getDebugPromptsLevel(), 0);

    process.env.DEBUG_PROMPTS_LEVEL = "3";
    assert.equal(getDebugPromptsLevel(), 3);

    process.env.DEBUG_PROMPTS_LEVEL = "2";
    assert.equal(getDebugPromptsLevel(), 2);

    process.env.DEBUG_PROMPTS_LEVEL = "yes";
    assert.equal(getDebugPromptsLevel(), 1);

    process.env.DEBUG_PROMPTS_LEVEL = "not-a-number";
    assert.equal(getDebugPromptsLevel(), 0);

    delete process.env.DEBUG_PROMPTS_LEVEL;
    process.env.DEBUG_PROMPT_LEVEL = "3";
    assert.equal(getDebugPromptsLevel(), 3);
  } finally {
    if (saved === undefined) delete process.env.DEBUG_PROMPTS_LEVEL;
    else process.env.DEBUG_PROMPTS_LEVEL = saved;
    if (savedTypo === undefined) delete process.env.DEBUG_PROMPT_LEVEL;
    else process.env.DEBUG_PROMPT_LEVEL = savedTypo;
  }
});

test("composeAgentPrompt logs turn instructions only when DEBUG_PROMPTS_LEVEL=2", () => {
  const saved = process.env.DEBUG_PROMPTS_LEVEL;
  const logs = [];
  const orig = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  try {
    process.env.DEBUG_PROMPTS_LEVEL = "2";
    const { composeAgentPrompt } = require("./prompts/promptComposer");
    composeAgentPrompt({
      agentKey: "attache",
      session: {},
      internalState: {},
      custom: "CUSTOM_TAIL_L2",
      debugContext: { activeAgent: "attache" },
    });
    const joined = logs.join("\n");
    assert.ok(joined.includes("[turnInstructions]"), "expected turnInstructions header");
    assert.ok(joined.includes("# TURN INSTRUCTIONS"), "expected turn instructions heading in body");
    assert.ok(joined.includes("CUSTOM_TAIL_L2"), "level 2 logs suffix after heading (custom tail in same slice)");
    assert.ok(joined.includes("agentKey=attache"), "expected agentKey");
    assert.ok(!joined.includes("exact system role string"), "level 2 must not dump full system prompt");
    assert.ok(!joined.includes("[composedPrompt]"), "level 2 must not dump composed full system");
  } finally {
    console.log = orig;
    if (saved === undefined) delete process.env.DEBUG_PROMPTS_LEVEL;
    else process.env.DEBUG_PROMPTS_LEVEL = saved;
  }
});

test("composeAgentPrompt logs full prompt when DEBUG_PROMPTS_LEVEL=3", () => {
  const saved = process.env.DEBUG_PROMPTS_LEVEL;
  const logs = [];
  const orig = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  try {
    process.env.DEBUG_PROMPTS_LEVEL = "3";
    const { composeAgentPrompt } = require("./prompts/promptComposer");
    const out = composeAgentPrompt({
      agentKey: "attache",
      session: {},
      internalState: {},
      custom: "CUSTOM_TAIL_DEBUG",
      debugContext: { activeAgent: "attache" },
    });
    assert.ok(typeof out.content === "string" && out.content.includes("CUSTOM_TAIL_DEBUG"));
    const joined = logs.join("\n");
    assert.ok(!joined.includes("[turnInstructions]"), "level 3 skips colored turn-only block (use level 2 for that)");
    assert.ok(joined.includes("[composedPrompt]"), "expected composedPrompt header");
    assert.ok(joined.includes("exact system role string"), "expected banner");
    assert.ok(joined.includes("agentKey=attache"), "expected agentKey");
    assert.ok(joined.includes("activeAgent=attache"), "expected activeAgent");
    assert.ok(joined.includes("CUSTOM_TAIL_DEBUG"), "expected body includes custom tail");
  } finally {
    console.log = orig;
    if (saved === undefined) delete process.env.DEBUG_PROMPTS_LEVEL;
    else process.env.DEBUG_PROMPTS_LEVEL = saved;
  }
});

test("formatStructuredAgentContextForDebug expands agent_context identity as plain text", () => {
  const { formatStructuredAgentContextForDebug } = require("./logger");
  const payload = {
    type: "agent_context",
    identity: "Line one\nLine two",
    other_agents: "peer note",
    conversation_state: { k: 1 },
    output_schema: { type: "object" },
  };
  const out = formatStructuredAgentContextForDebug(JSON.stringify(payload));
  assert.ok(out.includes("Line one\nLine two"));
  assert.ok(out.includes("--- identity"));
  assert.ok(out.includes("peer note"));
  assert.ok(out.includes('"k": 1'));
});

test("formatStructuredAgentContextForDebug omitEmptyConversationKeys drops empty strings", () => {
  const { formatStructuredAgentContextForDebug } = require("./logger");
  const payload = {
    type: "agent_context",
    identity: "Hi",
    other_agents: "",
    conversation_state: { opening_line_anchor: "", dossier_summary: "x" },
    output_schema: {},
  };
  const out = formatStructuredAgentContextForDebug(JSON.stringify(payload), {
    omitEmptyConversationKeys: true,
  });
  assert.ok(!out.includes("opening_line_anchor"));
  assert.ok(out.includes("dossier_summary"));
});

test("composeAgentPrompt detective plain string logs full system prompt when DEBUG_PROMPTS_LEVEL=3", () => {
  const saved = process.env.DEBUG_PROMPTS_LEVEL;
  const logs = [];
  const orig = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  try {
    process.env.DEBUG_PROMPTS_LEVEL = "3";
    const { composeAgentPrompt } = require("./prompts/promptComposer");
    const out = composeAgentPrompt({
      agentKey: "detective",
      session: {},
      internalState: {},
      custom: "DETECTIVE_CUSTOM_DEBUG_TAIL",
      debugContext: { activeAgent: "detective" },
    });
    assert.ok(typeof out.content === "string" && out.content.length > 0);
    assert.ok(!out.content.startsWith('{"type":"agent_context"'), "expected plain prompt, not agent_context JSON");
    assert.ok(
      typeof out.content === "string" && out.content.includes("# Response format"),
      "schema appendix is part of system content"
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[composedPrompt]"), "expected composedPrompt header");
    assert.ok(joined.includes("agentKey=detective"), "expected agentKey");
    assert.ok(joined.includes("DETECTIVE_CUSTOM_DEBUG_TAIL"), "expected custom tail in logged body");
    assert.ok(joined.includes("exact system role string"), "expected system banner");
    assert.ok(joined.includes("response format"), "expected composed system banner");
  } finally {
    console.log = orig;
    if (saved === undefined) delete process.env.DEBUG_PROMPTS_LEVEL;
    else process.env.DEBUG_PROMPTS_LEVEL = saved;
  }
});

test("composeAgentPrompt does not dump when DEBUG_PROMPTS_LEVEL is 0", () => {
  const saved = process.env.DEBUG_PROMPTS_LEVEL;
  const logs = [];
  const orig = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  try {
    process.env.DEBUG_PROMPTS_LEVEL = "0";
    const { composeAgentPrompt } = require("./prompts/promptComposer");
    composeAgentPrompt({
      agentKey: "attache",
      session: {},
      internalState: {},
      custom: "SHOULD_NOT_APPEAR_IN_LOGS",
    });
    const joined = logs.join("\n");
    assert.ok(!joined.includes("[composedPrompt]"));
    assert.ok(!joined.includes("[turnInstructions]"));
    assert.ok(!joined.includes("SHOULD_NOT_APPEAR_IN_LOGS"));
  } finally {
    console.log = orig;
    if (saved === undefined) delete process.env.DEBUG_PROMPTS_LEVEL;
    else process.env.DEBUG_PROMPTS_LEVEL = saved;
  }
});
