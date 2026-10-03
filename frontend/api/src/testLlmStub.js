"use strict";

/**
 * Minimal OpenAI client stand-in for tests. Every `chat.completions.create` call returns the
 * same JSON object (a superset of the keys attaché, detective and philosopher parsers read)
 * and increments `calls`.
 */
function createStubOpenAiClient() {
  const stub = {
    calls: 0,
    chat: {
      completions: {
        create: async () => {
          stub.calls += 1;
          return {
            id: "stub",
            model: "stub",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    user_response: "stub attache reply",
                    user_intends_explore: false,
                    user_intends_close: false,
                    asked_baseline_question: false,
                    detective_response: "stub detective reply",
                    suggest_existential_phase: "initial",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };
  return stub;
}

module.exports = { createStubOpenAiClient };
