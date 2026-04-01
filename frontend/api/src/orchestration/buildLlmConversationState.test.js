"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDossierSummaryForLlm,
  buildPrecedingConversationSummary,
  buildLlmConversationState,
} = require("./buildLlmConversationState");

describe("buildDossierSummaryForLlm", () => {
  it("keeps only medium-or-higher confidence inferred traits and explicit name", () => {
    const dossier = {
      explicit: { name: "  Sam  " },
      inferred: {
        interests: [
          { topic: "poetry", confidence: 0.8, evidence: "mentions poems" },
          { topic: "sports", confidence: 0.2, evidence: "unclear" },
        ],
        ageRange: [{ range: "25-34", confidence: 0.5 }],
      },
    };

    const summary = buildDossierSummaryForLlm(dossier);
    assert.equal(summary.explicitName, "Sam");
    assert.equal(summary.traits.length, 2);
    assert.deepEqual(
      summary.traits.map((t) => [t.traitName, t.displayValue]),
      [
        ["interests", "poetry"],
        ["ageRange", "25-34"],
      ]
    );
  });

  it("returns empty summary when dossier is missing", () => {
    const summary = buildDossierSummaryForLlm(null);
    assert.equal(summary.explicitName, null);
    assert.deepEqual(summary.traits, []);
  });
});

describe("buildPrecedingConversationSummary", () => {
  it("composes non-empty sections", () => {
    const text = buildPrecedingConversationSummary({
      baselineAttache: "B",
      userDetective: "D",
      philosophersInternal: "P",
    });
    assert.ok(text.includes("Baseline summary:"));
    assert.ok(text.includes("Detective summary:"));
    assert.ok(text.includes("Philosopher summary:"));
  });
});

describe("buildLlmConversationState", () => {
  it("builds detective-safe view and excludes internal fields", () => {
    const internalState = {
      mainState: {
        detective: {
          therapyPhase: "MAPPING_INFLUENCE",
          existentialPhase: "VALUE_CONNECTION",
        },
      },
    };
    const session = {
      dossier: { explicit: { name: "Ari" }, inferred: {} },
      conversationSummaries: { baselineAttache: "prior baseline" },
    };
    const view = buildLlmConversationState("detective", {
      internalState,
      session,
    });
    assert.equal(view.dossier_summary.explicitName, "Ari");
    assert.equal(view.therapy_phase, "Mapping the influence");
    assert.equal(view.existential_phase, "Value (Connection)");
    assert.ok(!("turn_count" in view));
    assert.ok(!("mode" in view));
    assert.ok(!("should_begin_closure" in view));
  });

  it("builds philosopher-safe view with agent-specific secrets", () => {
    const view = buildLlmConversationState("lumen", {
      internalState: {
        mainState: {
          philosophers: {
            narrativePhase: "CLIMAX",
            secretsRevealed: {
              lumen: ["mask"],
              umbra: ["abyss"],
            },
          },
        },
      },
      session: { dossier: null, conversationSummaries: null },
    });
    assert.equal(view.narrative_phase, "climax");
    assert.deepEqual(view.secrets_revealed, ["mask"]);
    assert.ok(!("turn_count" in view));
    assert.ok(!("mode" in view));
  });
});
