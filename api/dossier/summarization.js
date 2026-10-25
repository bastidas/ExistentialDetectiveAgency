"use strict";

const config = require("../config");
const logger = require("../logger");

// ---------------------------------------------------------------------------
// Configuration knobs for memory & dossier triggers
// ---------------------------------------------------------------------------

// Keep a trailing slice of history so the model still sees recent dialogue
// after summarization.
const RECENT_HISTORY_TAIL_LENGTH = Math.min(
	2000,
	Math.floor(config.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY / 2)
);

function logInfo(...args) {
	logger.info("summarization", ...args);
}

// ---------------------------------------------------------------------------
// Conversation summarizer
// ---------------------------------------------------------------------------

/**
 * @param {import("openai").default} openai
 * @param {string} history
 * @param {{ fallbackToTruncation?: boolean }} [opts] — with `fallbackToTruncation: false`, a model error
 *   returns "" instead of the tail of the input, so a caller never stores raw transcript as a summary
 */
async function summarizeHistory(openai, history, opts) {
	const text = String(history || "");
	const fallbackToTruncation = !opts || opts.fallbackToTruncation !== false;

	// In OFFLINE mode, we cannot call the model; return a crude truncation.
	if (config.OFFLINE) {
		logInfo("OFFLINE=1: skipping summarizeHistory model call");
		if (text.length <= config.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY) return text;
		return text.slice(-config.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY);
	}

	const prompt = `
Summarize the following conversation into a compact memory that preserves:
- user goals
- emotional state
- key insights from each agent
- unresolved questions
- important philosophical tensions
- narrative arc progression

Do NOT include dialogue. Produce a neutral summary.

Conversation:
${text}

Summary:
`;

	try {
		const messages = [{ role: "user", content: prompt }];
		const createPayload = {
			model: config.MODEL,
			messages,
		};
		logger.logLLMCall("summarization", {
			label: "summarizeHistory",
			messages,
			params: { model: config.MODEL },
		});
		logger.logOpenAiChatCompletionCreatePayload(
			"summarizeHistory",
			"summarization",
			createPayload
		);
		const response = await openai.chat.completions.create(createPayload);

		const content = response.choices?.[0]?.message?.content || "";
		return String(content || "").trim();
	} catch (err) {
		logInfo("Error in summarizeHistory:", err.message || err);
		if (config.DEBUG_LOGS) logger.error("summarization", err);
		if (!fallbackToTruncation) return "";
		if (text.length <= config.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY) return text;
		return text.slice(-config.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY);
	}
}

async function maybeSummarize(
	openai,
	history,
	maxLength = config.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY
) {
	const text = String(history || "");
	if (!text || text.length < maxLength) return text;

	logInfo("History exceeds max length; summarizing.");
	const summary = await summarizeHistory(openai, text);
	const recentTail =
		text.length > RECENT_HISTORY_TAIL_LENGTH
			? text.slice(-RECENT_HISTORY_TAIL_LENGTH).trim()
			: text.trim();

	return `# MEMORY SUMMARY\n${summary}\n\n# RECENT HISTORY\n${recentTail}`;
}

module.exports = {
	RECENT_HISTORY_TAIL_LENGTH,
	summarizeHistory,
	maybeSummarize,
};

