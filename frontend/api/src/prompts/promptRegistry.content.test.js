"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  PROMPT_REGISTRY,
  validatePromptRegistry,
  loadText,
  MIN_PERSONA_CHARS,
} = require("./promptRegistry");
const { composeAgentPrompt } = require("./promptComposer");

const AGENT_KEYS = ["attache", "detective", "lumen", "umbra"];

test("registry has no missing, stub, or placeholder persona/instruction files", () => {
  const { ok, errors } = validatePromptRegistry({ strict: false });
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});

test("validatePromptRegistry flags stub personas and unfinished-prompt markers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eda-registry-"));
  try {
    const stub = path.join(dir, "stub_persona.md");
    const marker = path.join(dir, "marker_instructions.md");
    fs.writeFileSync(stub, "You are the detective.");
    fs.writeFileSync(marker, "[mock custom lumen] voice=lumen\n" + "x".repeat(200));
    const real = PROMPT_REGISTRY.detective;
    const { ok, errors } = validatePromptRegistry({
      registry: {
        detective: { ...real, personaPath: stub, instructionsPath: marker },
      },
    });
    assert.equal(ok, false);
    assert.ok(errors.some((e) => /personaPath: only \d+ chars/.test(e)), errors.join("\n"));
    assert.ok(errors.some((e) => /instructionsPath: contains unfinished-prompt marker/.test(e)), errors.join("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const agentKey of AGENT_KEYS) {
  test(`composed ${agentKey} system prompt contains its full persona and no placeholder/mock text`, () => {
    const entry = PROMPT_REGISTRY[agentKey];
    const persona = loadText(entry.personaPath);
    assert.ok(persona.length >= MIN_PERSONA_CHARS, `${agentKey} persona too short`);

    const composed = composeAgentPrompt({ agentKey, session: {}, internalState: {} });
    assert.ok(composed.content.includes(persona), `${agentKey}: composed prompt must include the whole persona file`);
    assert.doesNotMatch(composed.content, /\[mock\b/i);
    assert.doesNotMatch(composed.content, /\bplaceholder\b/i);
  });
}
