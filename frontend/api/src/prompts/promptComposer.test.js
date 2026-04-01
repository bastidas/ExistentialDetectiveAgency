"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { composeAgentPrompt } = require("./promptComposer");

describe("promptComposer", () => {
  it("composes detective json context with whitelist-safe conversation_state", () => {
    const composed = composeAgentPrompt({
      agentKey: "detective",
      session: { lastReturnClassification: { returnCategory: "JUST_STEPPED_AWAY" } },
      internalState: {
        mainState: {
          detective: {
            therapyPhase: "MAPPING_INFLUENCE",
            existentialPhase: "VALUE_CONNECTION",
            mode: "closure",
          },
        },
      },
      otherAgentsSummary: "Other summary",
    });

    const parsed = JSON.parse(composed.content);
    assert.equal(parsed.type, "agent_context");
    assert.equal(parsed.other_agents, "Other summary");
    assert.ok(parsed.identity.includes("State note"));
    assert.ok(parsed.identity.includes("closure mode"));
    assert.ok(parsed.conversation_state);
    assert.ok(!("mode" in parsed.conversation_state));
    assert.ok(!("turn_count" in parsed.conversation_state));
    assert.ok("therapy_phase" in parsed.conversation_state);
    assert.ok("existential_phase" in parsed.conversation_state);
  });

  it("composes attache plain prompt with special + turn instructions", () => {
    const composed = composeAgentPrompt({
      agentKey: "attache",
      session: { lastReturnClassification: { returnCategory: "DAY_OR_SO" } },
      internalState: { mainState: { attache: { baselineCompleted: false } } },
      attacheTurnInstruction: {
        turnInstruction: "TURN_BODY",
        attachePromptFamilyKey: "start_from_null",
      },
    });

    assert.equal(composed.role, "system");
    assert.ok(composed.content.includes("Special return instruction"));
    assert.ok(composed.content.includes("Phase note"));
    assert.ok(composed.content.includes("TURN_BODY"));
  });
});

