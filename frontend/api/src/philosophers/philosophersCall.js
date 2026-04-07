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

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (x == null ? "" : String(x))).filter((s) => s.length > 0);
}

/**
 * @param {unknown} v
 * @returns {unknown[]}
 */
function asCalloutArray(v) {
  if (!Array.isArray(v)) return [];
  return v;
}

/**
 * @returns {{ lumenUserResponse: string, lumenOtherResponse: string, lumenNotes: string[], lumenCallouts: unknown[] }}
 */
function emptyLumenWire() {
  return {
    lumenUserResponse: "",
    lumenOtherResponse: "",
    lumenNotes: [],
    lumenCallouts: [],
  };
}

/**
 * @returns {{ umbraUserResponse: string, umbraOtherResponse: string, umbraNotes: string[], umbraCallouts: unknown[] }}
 */
function emptyUmbraWire() {
  return {
    umbraUserResponse: "",
    umbraOtherResponse: "",
    umbraNotes: [],
    umbraCallouts: [],
  };
}

/**
 * @param {unknown} parsed
 * @returns {{ lumenUserResponse: string, lumenOtherResponse: string, lumenNotes: string[], lumenCallouts: unknown[] }}
 */
function normalizeLumenOutput(parsed) {
  const o = parsed && typeof parsed === "object" ? parsed : {};
  return {
    lumenUserResponse:
      typeof o.lumen_philosopher_user_response === "string"
        ? o.lumen_philosopher_user_response
        : "",
    lumenOtherResponse:
      typeof o.lumen_philosopher_other_response === "string"
        ? o.lumen_philosopher_other_response
        : "",
    lumenNotes: asStringArray(o.lumen_philosopher_notes),
    lumenCallouts: asCalloutArray(o.lumen_philosopher_callouts),
  };
}

/**
 * @param {unknown} parsed
 * @returns {{ umbraUserResponse: string, umbraOtherResponse: string, umbraNotes: string[], umbraCallouts: unknown[] }}
 */
function normalizeUmbraOutput(parsed) {
  const o = parsed && typeof parsed === "object" ? parsed : {};
  return {
    umbraUserResponse:
      typeof o.umbra_philosopher_user_response === "string"
        ? o.umbra_philosopher_user_response
        : "",
    umbraOtherResponse:
      typeof o.umbra_philosopher_other_response === "string"
        ? o.umbra_philosopher_other_response
        : "",
    umbraNotes: asStringArray(o.umbra_philosopher_notes),
    umbraCallouts: asCalloutArray(o.umbra_philosopher_callouts),
  };
}

/**
 * @param {import("openai").default | null} openaiClient
 * @param {{ userMessage?: string, agentKey: "lumen"|"umbra" }} opts
 */
function createPhilosopherCall(openaiClient, opts) {
  const agentKey = opts && opts.agentKey === "umbra" ? "umbra" : "lumen";

  return async function callPhilosopher(input) {
    const empty = agentKey === "umbra" ? emptyUmbraWire() : emptyLumenWire();
    if (!openaiClient) {
      return empty;
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

    logger.logLLMCall("philosopherCall", {
      agentKey,
      model: config.MODEL,
      messages,
      messageCount: messages.length,
      historyTurns: Array.isArray(input?.chat_history) ? input.chat_history.length : 0,
      userMessageLength: userMessage.length,
      systemPromptLength: systemContent.length,
    });

    logger.logOpenAiChatCompletionCreatePayload("philosopherCall", agentKey, createPayload);

    try {
      const response = await openaiClient.chat.completions.create(createPayload);
      const msg = response.choices?.[0]?.message;
      const refusal = extractAssistantRefusal(msg);
      if (refusal) {
        logLlmRefusalBackend({
          scope: "philosopherCall",
          agentKey,
          refusalText: refusal,
          model: response.model,
          responseId: response.id,
          finishReason: response.choices?.[0]?.finish_reason,
        });
        const line = enigmaticRefusalUserLine(agentKey);
        const meta = buildLlmRefusalClientPayload(agentKey, refusal, response);
        if (agentKey === "umbra") {
          return { ...emptyUmbraWire(), umbraUserResponse: line, llmRefusal: meta };
        }
        return { ...emptyLumenWire(), lumenUserResponse: line, llmRefusal: meta };
      }
      const content = msg && typeof msg.content === "string" ? msg.content : "";
      if (!content || typeof content !== "string") {
        return empty;
      }
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (_) {
        return empty;
      }
      return agentKey === "umbra"
        ? normalizeUmbraOutput(parsed)
        : normalizeLumenOutput(parsed);
    } catch (err) {
      logger.warn(
        "philosopherCall",
        agentKey,
        err && err.message ? err.message : String(err)
      );
      return empty;
    }
  };
}

module.exports = {
  createPhilosopherCall,
  normalizeLumenOutput,
  normalizeUmbraOutput,
  emptyLumenWire,
  emptyUmbraWire,
};
