"use strict";

const config = require("../config");
const logger = require("../logger");
const { buildChatCompletionMessages } = require("../agents/buildChatCompletionMessages");
const {
  extractAssistantRefusal,
  enigmaticRefusalUserLine,
  logLlmRefusalBackend,
  buildLlmRefusalClientPayload,
} = require("../agents/llmRefusal");

const EMPTY_OUTPUT = Object.freeze({
  user_response: "",
  user_intends_explore: false,
  user_intends_close: false,
  asked_baseline_question: false,
});

/**
 * @param {unknown} parsed
 * @returns {{ user_response: string, user_intends_explore: boolean, user_intends_close: boolean, asked_baseline_question: boolean }}
 */
function normalizeAttacheOutput(parsed) {
  const o = parsed && typeof parsed === "object" ? parsed : {};
  return {
    user_response: typeof o.user_response === "string" ? o.user_response : "",
    user_intends_explore: Boolean(o.user_intends_explore),
    user_intends_close: Boolean(o.user_intends_close),
    asked_baseline_question: Boolean(o.asked_baseline_question),
  };
}

/**
 * Factory for the per-request attaché LLM call. Wire OpenAI when online.
 * @param {import("openai").default | null} openaiClient
 * @param {{ userMessage?: string }} [opts]
 * @returns {(input: object) => Promise<object>}
 */
function createAttacheCall(openaiClient, opts) {
  return async function callAttache(input) {
    if (!openaiClient) {
      return { ...EMPTY_OUTPUT };
    }

    const systemContent = String(
      input && input.composed_system_prompt != null ? input.composed_system_prompt : ""
    );
    const userMessage =
      opts && typeof opts.userMessage === "string" ? opts.userMessage : "";

    const messages = buildChatCompletionMessages({
      systemContent,
      chatHistory: input && Array.isArray(input.chat_history) ? input.chat_history : [],
      userMessage,
    });

    const serviceTier = String(process.env.OPENAI_SERVICE_TIER || "").trim();

    const structuredFormat =
      input &&
      input.structured_outputs_response_format &&
      typeof input.structured_outputs_response_format === "object" &&
      input.structured_outputs_response_format.type === "json_schema"
        ? input.structured_outputs_response_format
        : null;

    /** @type {Record<string, unknown>} */
    const createPayload = {
      model: config.MODEL,
      messages,
      temperature: 0.2,
      response_format:
        structuredFormat ||
        /** @type {{ type: 'json_object' }} */ ({ type: "json_object" }),
    };
    if (serviceTier) {
      createPayload.service_tier = serviceTier;
    }

    logger.logLLMCall("attacheCall", {
      model: config.MODEL,
      messageCount: messages.length,
      historyTurns: Array.isArray(input?.chat_history) ? input.chat_history.length : 0,
      userMessageLength: userMessage.length,
      systemPromptLength: systemContent.length,
    });

    logger.logFullLlmMessages("attacheCall", "attache", messages);

    try {
      const response = await openaiClient.chat.completions.create(createPayload);
      const msg = response.choices?.[0]?.message;
      const refusal = extractAssistantRefusal(msg);
      if (refusal) {
        logLlmRefusalBackend({
          scope: "attacheCall",
          agentKey: "attache",
          refusalText: refusal,
          model: response.model,
          responseId: response.id,
          finishReason: response.choices?.[0]?.finish_reason,
        });
        return {
          ...EMPTY_OUTPUT,
          user_response: enigmaticRefusalUserLine("attache"),
          llmRefusal: buildLlmRefusalClientPayload("attache", refusal, response),
        };
      }
      const content = msg && typeof msg.content === "string" ? msg.content : "";
      if (!content || typeof content !== "string") {
        return { ...EMPTY_OUTPUT };
      }
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (_) {
        return { ...EMPTY_OUTPUT };
      }
      return normalizeAttacheOutput(parsed);
    } catch (err) {
      logger.warn(
        "attacheCall",
        err && err.message ? err.message : String(err)
      );
      return { ...EMPTY_OUTPUT };
    }
  };
}

module.exports = {
  createAttacheCall,
};
