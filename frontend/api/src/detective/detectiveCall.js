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
const { normalizeExistentialTherapyPhaseId } = require("./existentialTherapyPhaseContent");

/**
 * @param {unknown} input
 * @param {{ defaultExistentialPhase?: unknown }} [factoryOpts]
 * @returns {"initial"|"middle"|"final"}
 */
function resolveDefaultExistentialPhase(input, factoryOpts) {
  const inp = input && typeof input === "object" ? input : {};
  const fromInput = inp.existential_therapy_phase ?? inp.existentialTherapyPhase;
  if (fromInput != null) return normalizeExistentialTherapyPhaseId(fromInput);
  const fromOpts =
    factoryOpts && factoryOpts.defaultExistentialPhase != null
      ? factoryOpts.defaultExistentialPhase
      : null;
  if (fromOpts != null) return normalizeExistentialTherapyPhaseId(fromOpts);
  return "initial";
}

/**
 * @param {unknown} parsed
 * @param {"initial"|"middle"|"final"} defaultPhase
 * @returns {{ detective_response: string, suggest_existential_phase: "initial"|"middle"|"final" }}
 */
function normalizeDetectiveOutput(parsed, defaultPhase) {
  const o = parsed && typeof parsed === "object" ? parsed : {};
  const d = normalizeExistentialTherapyPhaseId(defaultPhase);
  const sug = o.suggest_existential_phase;
  const valid =
    sug === "initial" || sug === "middle" || sug === "final";
  return {
    detective_response:
      typeof o.detective_response === "string" ? o.detective_response : "",
    suggest_existential_phase: valid ? sug : d,
  };
}

/**
 * Factory for per-request detective LLM calls.
 * @param {import("openai").default | null} openaiClient
 * @param {{ userMessage?: string, defaultExistentialPhase?: unknown }} [opts]
 * @returns {(input: object) => Promise<object>}
 */
function createDetectiveCall(openaiClient, opts) {
  return async function callDetective(input) {
    const defaultPhase = resolveDefaultExistentialPhase(input, opts);
    const emptyOut = () => ({
      detective_response: "",
      suggest_existential_phase: defaultPhase,
    });
    if (!openaiClient) {
      return emptyOut();
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

    logger.logLLMCall("detectiveCall", {
      model: config.MODEL,
      messageCount: messages.length,
      historyTurns: Array.isArray(input?.chat_history) ? input.chat_history.length : 0,
      userMessageLength: userMessage.length,
      systemPromptLength: systemContent.length,
    });

    logger.logFullLlmMessages("detectiveCall", "detective", messages);

    try {
      const response = await openaiClient.chat.completions.create(createPayload);
      const msg = response.choices?.[0]?.message;
      const refusal = extractAssistantRefusal(msg);
      if (refusal) {
        logLlmRefusalBackend({
          scope: "detectiveCall",
          agentKey: "detective",
          refusalText: refusal,
          model: response.model,
          responseId: response.id,
          finishReason: response.choices?.[0]?.finish_reason,
        });
        return {
          detective_response: enigmaticRefusalUserLine("detective"),
          suggest_existential_phase: defaultPhase,
          llmRefusal: buildLlmRefusalClientPayload("detective", refusal, response),
        };
      }
      const content = msg && typeof msg.content === "string" ? msg.content : "";
      if (!content || typeof content !== "string") {
        return emptyOut();
      }
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (_) {
        return emptyOut();
      }
      return normalizeDetectiveOutput(parsed, defaultPhase);
    } catch (err) {
      logger.warn(
        "detectiveCall",
        err && err.message ? err.message : String(err)
      );
      return emptyOut();
    }
  };
}

module.exports = {
  createDetectiveCall,
};
